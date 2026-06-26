import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateItemDto, UpdateItemDto } from './item.dto';

// Items are returned with their masters (for display) + company links flattened.
const withRelations = {
  category: { select: { id: true, code: true, name: true } },
  group: { select: { id: true, code: true, name: true } },
  unit: { select: { id: true, code: true, name: true } },
  boxUnit: { select: { id: true, code: true, name: true } },
  hsnCode: { select: { id: true, code: true, description: true } },
  companies: { select: { companyId: true } },
} satisfies Prisma.ItemInclude;

@Injectable()
export class ItemService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number | undefined, search?: string) {
    const scopeFilter: Prisma.ItemWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };
    const rows = await this.prisma.item.findMany({
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
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!item || !this.isVisible(item, companyId)) {
      throw new NotFoundException('Item not found');
    }
    return this.flatten(item);
  }

  async create(dto: CreateItemDto) {
    await this.assertRefs(dto);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    try {
      const created = await this.prisma.item.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId ?? null,
          groupId: dto.groupId ?? null,
          unitId: dto.unitId,
          unitPrice: dto.unitPrice ?? 0,
          boxQty: dto.boxQty ?? 0,
          boxUnitId: dto.boxUnitId ?? null,
          hsnCodeId: dto.hsnCodeId ?? null,
          minimumStock: dto.minimumStock ?? 0,
          maximumStock: dto.maximumStock ?? 0,
          reorderLevel: dto.reorderLevel ?? 0,
          leadTime: dto.leadTime ?? 0,
          allCompanies,
          isActive: dto.isActive ?? true,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async update(companyId: number | undefined, id: number, dto: UpdateItemDto) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'item', 'editing');
    await this.assertRefs(dto);

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existing.companyIds)
      : null;

    try {
      const updated = await this.prisma.item.update({
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
          unitPrice: dto.unitPrice,
          boxQty: dto.boxQty,
          boxUnitId: dto.boxUnitId,
          hsnCodeId: dto.hsnCodeId,
          minimumStock: dto.minimumStock,
          maximumStock: dto.maximumStock,
          reorderLevel: dto.reorderLevel,
          leadTime: dto.leadTime,
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
    const updated = await this.prisma.item.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'item', 'deleting');
    await this.prisma.item.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private flatten<T extends { companies: { companyId: number }[] }>(row: T) {
    const { companies, ...rest } = row;
    return { ...rest, companyIds: companies.map((c) => c.companyId) };
  }

  private isVisible(
    item: { allCompanies: boolean; companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    if (item.allCompanies) return true;
    return companyId != null
      ? item.companies.some((c) => c.companyId === companyId)
      : false;
  }

  /** Verify every referenced master id (when present) actually exists. */
  private async assertRefs(dto: CreateItemDto | UpdateItemDto) {
    const exists = async (
      model: 'unit' | 'category' | 'group' | 'hsnCode',
      id: number,
    ): Promise<boolean> => {
      const where = { id };
      const sel = { select: { id: true }, where };
      switch (model) {
        case 'unit':
          return !!(await this.prisma.unit.findUnique(sel));
        case 'category':
          return !!(await this.prisma.category.findUnique(sel));
        case 'group':
          return !!(await this.prisma.group.findUnique(sel));
        case 'hsnCode':
          return !!(await this.prisma.hsnCode.findUnique(sel));
      }
    };

    if (dto.unitId != null && !(await exists('unit', dto.unitId))) {
      throw new BadRequestException('Selected unit does not exist.');
    }
    if (dto.boxUnitId != null && !(await exists('unit', dto.boxUnitId))) {
      throw new BadRequestException('Selected box unit does not exist.');
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
      return new ConflictException(`Item code "${code}" already exists.`);
    }
    return e;
  }
}
