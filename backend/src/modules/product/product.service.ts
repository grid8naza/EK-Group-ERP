import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  itemCode,
  itemSeqOf,
  lowestFree,
  MAX_ITEM_SEQ,
} from '../../common/hierarchy-code';
import { extname } from 'path';
import { rename as renameFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { join } from 'path';
import {
  BomLineInput,
  CreateProductDto,
  PackSourceInput,
  ProcessInput,
  ProductBranchStockInput,
  UpdateProductDto,
} from './product.dto';
import { PRODUCT_UPLOAD_DIR, PRODUCT_URL_PREFIX } from './product.constants';

interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
}

// Products are returned with their masters + company links flattened + the two
// BOMs split out of the single bomLines table.
const withRelations = {
  category: { select: { id: true, code: true, name: true } },
  group: { select: { id: true, code: true, name: true } },
  unit: { select: { id: true, code: true, name: true, symbol: true } },
  boxUnit: { select: { id: true, code: true, name: true, symbol: true } },
  yieldUnit: { select: { id: true, code: true, name: true, symbol: true } },
  hsnCode: { select: { id: true, code: true, description: true } },
  companies: { select: { companyId: true } },
  deliveryTrips: { select: { lookupValueId: true } },
  packSources: {
    orderBy: { sequence: 'asc' },
    select: { id: true, sourceProductId: true, quantity: true, sequence: true },
  },
  branchStocks: {
    orderBy: { branchId: 'asc' },
    select: {
      id: true,
      branchId: true,
      minStock: true,
      maxStock: true,
      reorderLevel: true,
      leadTimeDays: true,
    },
  },
  bomLines: {
    orderBy: { sequence: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true } },
      unit: { select: { id: true, code: true, name: true, symbol: true } },
    },
  },
  processes: {
    orderBy: { sequence: 'asc' },
    include: { manpower: true },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof withRelations }>;

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  /** Store an uploaded product picture and return its public URL. */
  async uploadImage(file: UploadedFile): Promise<{ url: string }> {
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    const ext = extname(file.originalname) || extMap[file.mimetype] || '';
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await renameFile(file.path, join(PRODUCT_UPLOAD_DIR, name));
    return { url: `${PRODUCT_URL_PREFIX}/${name}` };
  }

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
    // Every product lives under a leaf group; category comes from that group and
    // the code is generated (manual codes are not accepted).
    const group = await this.assertLeafGroup(dto.groupId);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    return this.withCodeRetry(async () => {
      const seq = await this.nextLeafSeq(dto.groupId);
      const created = await this.prisma.product.create({
        data: {
          code: itemCode(group.code, seq),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          imageUrl: dto.imageUrl?.trim() || null,
          categoryId: group.categoryId,
          groupId: dto.groupId,
          unitId: dto.unitId,
          unpacked: dto.unpacked ?? false,
          packed: dto.packed ?? false,
          canSell: dto.canSell ?? true,
          costPrice: dto.costPrice ?? 0,
          wholesalePrice: dto.wholesalePrice ?? 0,
          wholesaleProfitPct: dto.wholesaleProfitPct ?? 0,
          intercompanyPrice: dto.intercompanyPrice ?? 0,
          intercompanyProfitPct: dto.intercompanyProfitPct ?? 0,
          retailPrice: dto.retailPrice ?? 0,
          retailProfitPct: dto.retailProfitPct ?? 0,
          boxQty: dto.boxQty ?? 0,
          boxUnitId: dto.boxUnitId ?? null,
          hsnCodeId: dto.hsnCodeId ?? null,
          shelfLife: dto.shelfLife ?? 0,
          yieldQty: dto.yieldQty ?? 1,
          yieldUnitId: dto.yieldUnitId ?? null,
          labourCost: dto.labourCost ?? 0,
          fuelCost: dto.fuelCost ?? 0,
          overheadCost: dto.overheadCost ?? 0,
          bomMarginPct: dto.bomMarginPct ?? 0,
          actualCostPrice: dto.actualCostPrice ?? 0,
          actualSalesPrice: dto.actualSalesPrice ?? 0,
          hasRecipe: dto.hasRecipe ?? false,
          hasPacking: dto.hasPacking ?? false,
          isIngredient: dto.isIngredient ?? false,
          prodSun: dto.prodSun ?? false,
          prodMon: dto.prodMon ?? false,
          prodTue: dto.prodTue ?? false,
          prodWed: dto.prodWed ?? false,
          prodThu: dto.prodThu ?? false,
          prodFri: dto.prodFri ?? false,
          prodSat: dto.prodSat ?? false,
          prodOccasional: dto.prodOccasional ?? false,
          allCompanies,
          isActive: dto.isActive ?? true,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
          deliveryTrips: {
            create: (dto.deliveryTripIds ?? []).map((lookupValueId) => ({
              lookupValueId,
            })),
          },
          bomLines: { create: this.bomCreate(dto.recipe, dto.packing) },
          processes: { create: this.processCreate(dto.processes) },
          packSources: { create: this.packSourceCreate(dto.packSources) },
          branchStocks: { create: this.branchStockCreate(dto.branchStocks) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    });
  }

  /**
   * The group a product attaches to must be a leaf (no sub-groups) that applies
   * to products. Returns its category + code for building the product's code.
   */
  private async assertLeafGroup(groupId: number) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        categoryId: true,
        code: true,
        subGroupApplicable: true,
        forProduct: true,
        isActive: true,
      },
    });
    if (!group) {
      throw new BadRequestException('Selected group does not exist.');
    }
    if (!group.isActive) {
      throw new BadRequestException(
        'The selected group is inactive. Products cannot be added under it.',
      );
    }
    if (group.subGroupApplicable) {
      throw new BadRequestException(
        'Products cannot be added under a group that has sub-groups. Choose a leaf group.',
      );
    }
    if (!group.forProduct) {
      throw new BadRequestException(
        'The selected group does not apply to products.',
      );
    }
    return group;
  }

  /** Lowest free 3-digit sequence under a leaf group (items + products share it). */
  private async nextLeafSeq(groupId: number): Promise<number> {
    const [items, products] = await Promise.all([
      this.prisma.item.findMany({ where: { groupId }, select: { code: true } }),
      this.prisma.product.findMany({ where: { groupId }, select: { code: true } }),
    ]);
    const used = [...items, ...products].map((r) => itemSeqOf(r.code));
    const n = lowestFree(used, MAX_ITEM_SEQ);
    if (n == null) {
      throw new BadRequestException(
        `Maximum of ${MAX_ITEM_SEQ} items/products reached under this group.`,
      );
    }
    return n;
  }

  private async withCodeRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (
          i < attempts &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
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

    // Only touch the BOM / process flow when the caller sends them (Production
    // screen); the Inventory master screen omits them and leaves them intact.
    const wantsBomChange = dto.recipe !== undefined || dto.packing !== undefined;
    const recipe = (dto.recipe ?? existing.recipe).map(this.lineData);
    const packing = (dto.packing ?? existing.packing).map(this.lineData);
    const wantsProcessChange = dto.processes !== undefined;

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          // code, categoryId and groupId are part of the hierarchy code and are
          // immutable after creation.
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          imageUrl:
            dto.imageUrl !== undefined ? dto.imageUrl?.trim() || null : undefined,
          unitId: dto.unitId,
          unpacked: dto.unpacked,
          packed: dto.packed,
          canSell: dto.canSell,
          costPrice: dto.costPrice,
          wholesalePrice: dto.wholesalePrice,
          wholesaleProfitPct: dto.wholesaleProfitPct,
          intercompanyPrice: dto.intercompanyPrice,
          intercompanyProfitPct: dto.intercompanyProfitPct,
          retailPrice: dto.retailPrice,
          retailProfitPct: dto.retailProfitPct,
          boxQty: dto.boxQty,
          boxUnitId: dto.boxUnitId,
          hsnCodeId: dto.hsnCodeId,
          shelfLife: dto.shelfLife,
          yieldQty: dto.yieldQty,
          yieldUnitId: dto.yieldUnitId,
          labourCost: dto.labourCost,
          fuelCost: dto.fuelCost,
          overheadCost: dto.overheadCost,
          bomMarginPct: dto.bomMarginPct,
          actualCostPrice: dto.actualCostPrice,
          actualSalesPrice: dto.actualSalesPrice,
          hasRecipe: dto.hasRecipe,
          hasPacking: dto.hasPacking,
          isIngredient: dto.isIngredient,
          prodSun: dto.prodSun,
          prodMon: dto.prodMon,
          prodTue: dto.prodTue,
          prodWed: dto.prodWed,
          prodThu: dto.prodThu,
          prodFri: dto.prodFri,
          prodSat: dto.prodSat,
          prodOccasional: dto.prodOccasional,
          allCompanies,
          isActive: dto.isActive,
          // Only rewrite the trips when the caller sent them: omitting the field
          // must leave the schedule alone, not silently clear it.
          ...(dto.deliveryTripIds !== undefined
            ? {
                deliveryTrips: {
                  deleteMany: {},
                  create: dto.deliveryTripIds.map((lookupValueId) => ({
                    lookupValueId,
                  })),
                },
              }
            : {}),
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
          ...(wantsProcessChange
            ? {
                processes: {
                  deleteMany: {},
                  create: this.processCreate(dto.processes),
                },
              }
            : {}),
          ...(dto.packSources !== undefined
            ? {
                packSources: {
                  deleteMany: {},
                  create: this.packSourceCreate(dto.packSources),
                },
              }
            : {}),
          ...(dto.branchStocks !== undefined
            ? {
                branchStocks: {
                  deleteMany: {},
                  create: this.branchStockCreate(dto.branchStocks),
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
    const { companies, deliveryTrips, bomLines, ...rest } = row;
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
      deliveryTripIds: deliveryTrips.map((t) => t.lookupValueId),
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

  /** Build ProductPackSource create rows from the packing sources array. */
  private packSourceCreate(
    sources: PackSourceInput[] | undefined,
  ): Prisma.ProductPackSourceUncheckedCreateWithoutProductInput[] {
    return (sources ?? []).map((s, i) => ({
      sequence: i,
      sourceProductId: s.sourceProductId,
      quantity: s.quantity,
    }));
  }

  /** Build ProductBranchStock create rows. Rows whose levels are all zero are
   *  dropped so the table only holds branches the user actually configured. */
  private branchStockCreate(
    rows: ProductBranchStockInput[] | undefined,
  ): Prisma.ProductBranchStockUncheckedCreateWithoutProductInput[] {
    const seen = new Set<number>();
    return (rows ?? [])
      .filter((r) => {
        // Guard against duplicate branchIds (unique on [productId, branchId]).
        if (seen.has(r.branchId)) return false;
        seen.add(r.branchId);
        return (
          (r.minStock ?? 0) > 0 ||
          (r.maxStock ?? 0) > 0 ||
          (r.reorderLevel ?? 0) > 0 ||
          (r.leadTimeDays ?? 0) > 0
        );
      })
      .map((r) => ({
        branchId: r.branchId,
        minStock: r.minStock ?? 0,
        maxStock: r.maxStock ?? 0,
        reorderLevel: r.reorderLevel ?? 0,
        leadTimeDays: r.leadTimeDays ?? 0,
      }));
  }

  /** Build ProductProcess create rows from the process-flow array. */
  private processCreate(
    processes: ProcessInput[] | undefined,
  ): Prisma.ProductProcessUncheckedCreateWithoutProductInput[] {
    return (processes ?? []).map((p, i) => ({
      sequence: i,
      name: p.name.trim(),
      description: p.description?.trim() || null,
      timeValue: p.timeValue ?? 0,
      timeUnit: p.timeUnit ?? 'MIN',
      machineId: p.machineId ?? null,
      manpower: {
        create: (p.manpower ?? []).map((m) => ({
          designationId: m.designationId,
          workerCount: m.workerCount,
        })),
      },
    }));
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
