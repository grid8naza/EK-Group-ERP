import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { BomLineInput, CreateProductDto, UpdateProductDto } from './product.dto';

// Products are returned with their masters + company links flattened + the two
// BOMs split out of the single bomLines table.
const withRelations = {
  category: { select: { id: true, code: true, name: true } },
  group: { select: { id: true, code: true, name: true } },
  unit: { select: { id: true, code: true, name: true } },
  boxUnit: { select: { id: true, code: true, name: true } },
  yieldUnit: { select: { id: true, code: true, name: true } },
  hsnCode: { select: { id: true, code: true, description: true } },
  companies: { select: { companyId: true } },
  bomLines: {
    orderBy: { sequence: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true } },
      unit: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof withRelations }>;

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number | undefined, search?: string) {
    const scopeFilter: Prisma.ProductWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };
    const rows = await this.prisma.product.findMany({
      where: {
        AND: [
          scopeFilter,
          search
            ? {
                OR: [
                  { code: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      include: withRelations,
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.flatten(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!product || !this.isVisible(product, companyId)) {
      throw new NotFoundException('Product not found');
    }
    return this.flatten(product);
  }

  async create(dto: CreateProductDto) {
    await this.assertRefs(dto);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    try {
      const created = await this.prisma.product.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId ?? null,
          groupId: dto.groupId ?? null,
          unitId: dto.unitId,
          wholesalePrice: dto.wholesalePrice ?? 0,
          intercompanyPrice: dto.intercompanyPrice ?? 0,
          retailPrice: dto.retailPrice ?? 0,
          boxQty: dto.boxQty ?? 0,
          boxUnitId: dto.boxUnitId ?? null,
          hsnCodeId: dto.hsnCodeId ?? null,
          shelfLife: dto.shelfLife ?? 0,
          yieldQty: dto.yieldQty ?? 1,
          yieldUnitId: dto.yieldUnitId ?? null,
          allCompanies,
          isActive: dto.isActive ?? true,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
          bomLines: { create: this.bomCreate(dto.recipe, dto.packing) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async update(companyId: number | undefined, id: number, dto: UpdateProductDto) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'product', 'editing');
    await this.assertRefs(dto);

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existing.companyIds)
      : null;

    // Only touch the BOM when the caller sends recipe/packing (Production
    // screen); the Inventory master screen omits them and leaves it intact.
    const wantsBomChange = dto.recipe !== undefined || dto.packing !== undefined;
    const recipe = (dto.recipe ?? existing.recipe).map(this.lineData);
    const packing = (dto.packing ?? existing.packing).map(this.lineData);

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          code: dto.code !== undefined ? dto.code.trim().toUpperCase() : undefined,
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          categoryId: dto.categoryId,
          groupId: dto.groupId,
          unitId: dto.unitId,
          wholesalePrice: dto.wholesalePrice,
          intercompanyPrice: dto.intercompanyPrice,
          retailPrice: dto.retailPrice,
          boxQty: dto.boxQty,
          boxUnitId: dto.boxUnitId,
          hsnCodeId: dto.hsnCodeId,
          shelfLife: dto.shelfLife,
          yieldQty: dto.yieldQty,
          yieldUnitId: dto.yieldUnitId,
          allCompanies,
          isActive: dto.isActive,
          ...(companyIds
            ? {
                companies: {
                  deleteMany: {},
                  create: companyIds.map((cid) => ({ companyId: cid })),
                },
              }
            : {}),
          ...(wantsBomChange
            ? {
                bomLines: {
                  deleteMany: {},
                  create: this.bomCreate(recipe, packing),
                },
              }
            : {}),
        },
        include: withRelations,
      });
      return this.flatten(updated);
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'product', 'deleting');
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private flatten(row: ProductRow) {
    const { companies, bomLines, ...rest } = row;
    const toLine = (l: ProductRow['bomLines'][number]) => ({
      id: l.id,
      itemId: l.itemId,
      quantity: l.quantity,
      unitId: l.unitId,
      sequence: l.sequence,
      item: l.item,
      unit: l.unit,
    });
    return {
      ...rest,
      companyIds: companies.map((c) => c.companyId),
      recipe: bomLines.filter((l) => l.kind === BomKind.RECIPE).map(toLine),
      packing: bomLines.filter((l) => l.kind === BomKind.PACKING).map(toLine),
    };
  }

  private lineData(l: { itemId: number; quantity: number; unitId: number }) {
    return { itemId: l.itemId, quantity: l.quantity, unitId: l.unitId };
  }

  /** Build ProductBomLine create rows from the two BOM arrays. */
  private bomCreate(
    recipe: BomLineInput[] | undefined,
    packing: BomLineInput[] | undefined,
  ): Prisma.ProductBomLineUncheckedCreateWithoutProductInput[] {
    const rows = (lines: BomLineInput[] | undefined, kind: BomKind) =>
      (lines ?? []).map((l, i) => ({
        kind,
        sequence: i,
        itemId: l.itemId,
        quantity: l.quantity,
        unitId: l.unitId,
      }));
    return [
      ...rows(recipe, BomKind.RECIPE),
      ...rows(packing, BomKind.PACKING),
    ];
  }

  private isVisible(
    product: { allCompanies: boolean; companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    if (product.allCompanies) return true;
    return companyId != null
      ? product.companies.some((c) => c.companyId === companyId)
      : false;
  }

  /** Verify every referenced master id (incl. each BOM line item/unit) exists. */
  private async assertRefs(dto: CreateProductDto | UpdateProductDto) {
    const exists = async (
      model: 'unit' | 'category' | 'group' | 'hsnCode' | 'item',
      id: number,
    ): Promise<boolean> => {
      const sel = { select: { id: true }, where: { id } };
      switch (model) {
        case 'unit':
          return !!(await this.prisma.unit.findUnique(sel));
        case 'category':
          return !!(await this.prisma.category.findUnique(sel));
        case 'group':
          return !!(await this.prisma.group.findUnique(sel));
        case 'hsnCode':
          return !!(await this.prisma.hsnCode.findUnique(sel));
        case 'item':
          return !!(await this.prisma.item.findUnique(sel));
      }
    };

    if (dto.unitId != null && !(await exists('unit', dto.unitId))) {
      throw new BadRequestException('Selected unit does not exist.');
    }
    if (dto.boxUnitId != null && !(await exists('unit', dto.boxUnitId))) {
      throw new BadRequestException('Selected box unit does not exist.');
    }
    if (dto.yieldUnitId != null && !(await exists('unit', dto.yieldUnitId))) {
      throw new BadRequestException('Selected yield unit does not exist.');
    }
    if (dto.categoryId != null && !(await exists('category', dto.categoryId))) {
      throw new BadRequestException('Selected category does not exist.');
    }
    if (dto.groupId != null && !(await exists('group', dto.groupId))) {
      throw new BadRequestException('Selected group does not exist.');
    }
    if (dto.hsnCodeId != null && !(await exists('hsnCode', dto.hsnCodeId))) {
      throw new BadRequestException('Selected HSN code does not exist.');
    }
    for (const l of [...(dto.recipe ?? []), ...(dto.packing ?? [])]) {
      if (!(await exists('item', l.itemId))) {
        throw new BadRequestException('A BOM line references an item that does not exist.');
      }
      if (!(await exists('unit', l.unitId))) {
        throw new BadRequestException('A BOM line references a unit that does not exist.');
      }
    }
  }

  private resolveCompanies(
    allCompanies: boolean,
    companyIds: number[] | undefined,
  ): number[] {
    if (allCompanies) return [];
    const ids = Array.from(new Set(companyIds ?? [])).filter((n) => n > 0);
    if (ids.length === 0) {
      throw new BadRequestException(
        'Select at least one company, or choose "All companies".',
      );
    }
    return ids;
  }

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`Product code "${code}" already exists.`);
    }
    return e;
  }
}
