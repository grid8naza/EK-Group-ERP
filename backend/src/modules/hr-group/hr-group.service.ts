import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  groupCode,
  groupNumberAt,
  lowestFree,
  MAX_GROUP,
  MAX_LEVEL,
  primaryPrefix,
} from '../../common/hierarchy-code';
import { CreateHrGroupDto, UpdateHrGroupDto } from './hr-group.dto';

// HR group rows are returned with their parent category, parent group, and
// company links flattened.
const withRelations = {
  companies: { select: { companyId: true } },
  category: { select: { id: true, code: true, name: true } },
  parent: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HrGroupInclude;

@Injectable()
export class HrGroupService {
  constructor(private prisma: PrismaService) {}

  /**
   * HR groups available in the active company, optionally narrowed to a primary
   * group's whole subtree and/or to the direct children of a parent group.
   * Ordered by code, which (being a positional hierarchy code) yields correct
   * tree order.
   */
  async findAll(
    companyId: number | undefined,
    opts: { search?: string; primaryGroupId?: number; parentGroupId?: number } = {},
  ) {
    const scopeFilter: Prisma.HrGroupWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };

    // "Primary group" filter → every group whose code shares that primary's
    // CC+L1 prefix (the primary itself and all its descendants).
    let primaryFilter: Prisma.HrGroupWhereInput = {};
    if (opts.primaryGroupId) {
      const primary = await this.prisma.hrGroup.findUnique({
        where: { id: opts.primaryGroupId },
        select: { code: true },
      });
      primaryFilter = primary
        ? { code: { startsWith: primaryPrefix(primary.code) } }
        : { id: -1 }; // unknown id → match nothing
    }

    const rows = await this.prisma.hrGroup.findMany({
      where: {
        AND: [
          scopeFilter,
          primaryFilter,
          opts.parentGroupId ? { parentGroupId: opts.parentGroupId } : {},
          opts.search
            ? {
                OR: [
                  { code: { contains: opts.search, mode: 'insensitive' } },
                  { name: { contains: opts.search, mode: 'insensitive' } },
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
    const group = await this.prisma.hrGroup.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!group || !this.isVisible(group, companyId)) {
      throw new NotFoundException('Manpower group not found');
    }
    return this.flatten(group);
  }

  async create(dto: CreateHrGroupDto) {
    const subGroupApplicable = dto.subGroupApplicable ?? false;

    // Resolve where this group sits in the tree.
    let categoryId = dto.categoryId;
    let parentCode: string;
    let level = 1;
    const parentGroupId = dto.parentGroupId ?? null;

    if (parentGroupId != null) {
      const parent = await this.prisma.hrGroup.findUnique({
        where: { id: parentGroupId },
        select: { categoryId: true, level: true, code: true, subGroupApplicable: true },
      });
      if (!parent) {
        throw new BadRequestException('Selected parent group does not exist.');
      }
      if (!parent.subGroupApplicable) {
        throw new BadRequestException(
          'The chosen parent group does not allow sub-groups. Set “Sub-group applicable” on it first.',
        );
      }
      if (parent.level >= MAX_LEVEL) {
        throw new BadRequestException(
          `Groups can be nested at most ${MAX_LEVEL} levels deep.`,
        );
      }
      categoryId = parent.categoryId; // a sub-group inherits its parent's category
      level = parent.level + 1;
      parentCode = parent.code;
    } else {
      const category = await this.prisma.hrCategory.findUnique({
        where: { id: categoryId },
        select: { code: true },
      });
      if (!category) {
        throw new BadRequestException('Selected manpower category does not exist.');
      }
      parentCode = category.code;
    }

    // The deepest level cannot itself contain sub-groups.
    if (subGroupApplicable && level >= MAX_LEVEL) {
      throw new BadRequestException(
        `A level-${MAX_LEVEL} group cannot have sub-groups.`,
      );
    }

    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    return this.withCodeRetry(async () => {
      const n = await this.nextGroupNumber(categoryId, parentGroupId, level);
      const created = await this.prisma.hrGroup.create({
        data: {
          categoryId,
          parentGroupId,
          level,
          subGroupApplicable,
          code: groupCode(parentCode, level, n),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          allCompanies,
          isActive: dto.isActive ?? true,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    });
  }

  async update(companyId: number | undefined, id: number, dto: UpdateHrGroupDto) {
    const existing = await this.prisma.hrGroup.findUnique({
      where: { id },
      include: {
        ...withRelations,
        _count: { select: { children: true } },
      },
    });
    if (!existing || !this.isVisible(existing, companyId)) {
      throw new NotFoundException('Manpower group not found');
    }
    assertUnlocked(existing, 'manpower group', 'editing');

    // Category / parent / level / code are part of the immutable hierarchy code
    // and cannot be changed after creation.

    // Validate any change to whether this group holds sub-groups.
    let subGroupApplicable = existing.subGroupApplicable;
    if (
      dto.subGroupApplicable !== undefined &&
      dto.subGroupApplicable !== existing.subGroupApplicable
    ) {
      subGroupApplicable = dto.subGroupApplicable;
      if (subGroupApplicable) {
        if (existing.level >= MAX_LEVEL) {
          throw new BadRequestException(
            `A level-${MAX_LEVEL} group cannot have sub-groups.`,
          );
        }
      } else if (existing._count.children > 0) {
        throw new BadRequestException(
          'This group still has sub-groups, so “Sub-group applicable” cannot be turned off.',
        );
      }
    }

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const existingCompanyIds = existing.companies.map((c) => c.companyId);
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existingCompanyIds)
      : null;

    const updated = await this.prisma.hrGroup.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description !== undefined
            ? dto.description?.trim() || null
            : undefined,
        subGroupApplicable,
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
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.hrGroup.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'manpower group', 'deleting');
    try {
      await this.prisma.hrGroup.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'This manpower group has sub-groups or designations under it. Remove those first.',
        );
      }
      throw e;
    }
    return { success: true };
  }

  // --- helpers ---

  /** Lowest free 2-digit number for a group at `level` under a given parent. */
  private async nextGroupNumber(
    categoryId: number,
    parentGroupId: number | null,
    level: number,
  ): Promise<number> {
    const sibs = await this.prisma.hrGroup.findMany({
      where: { categoryId, parentGroupId },
      select: { code: true },
    });
    const used = sibs.map((s) => groupNumberAt(s.code, level));
    const n = lowestFree(used, MAX_GROUP);
    if (n == null) {
      throw new BadRequestException(
        `Maximum of ${MAX_GROUP} groups reached under this parent.`,
      );
    }
    return n;
  }

  /** Re-run an allocate+insert if it loses the code-uniqueness race. */
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

  private flatten<
    T extends {
      companies: { companyId: number }[];
    },
  >(row: T) {
    const { companies, ...rest } = row;
    return { ...rest, companyIds: companies.map((c) => c.companyId) };
  }

  private isVisible(
    group: { allCompanies: boolean; companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    if (group.allCompanies) return true;
    return companyId != null
      ? group.companies.some((c) => c.companyId === companyId)
      : false;
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
}
