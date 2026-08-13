import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CategoryKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  groupCode,
  groupNumberAt,
  GROUP_ROOT_CODE,
  lowestFree,
  MAX_GROUP,
  MAX_LEVEL,
  primaryPrefix,
} from '../../common/hierarchy-code';
import { CreateGroupDto, UpdateGroupDto } from './group.dto';

// Group rows are returned with their categories, parent group and company links
// flattened.
const withRelations = {
  companies: { select: { companyId: true } },
  categories: {
    select: {
      category: { select: { id: true, code: true, name: true, kind: true } },
    },
  },
  parent: { select: { id: true, code: true, name: true } },
} satisfies Prisma.GroupInclude;

/** The two kinds an ITEM may be classified under; the rest belong to products. */
const ITEM_KINDS: CategoryKind[] = ['INGREDIENT', 'PACKING_MATERIAL'];

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  /**
   * Groups available in the active company, optionally narrowed to one category
   * (or one category KIND — how the product screens scope themselves), to a
   * primary group's whole subtree and/or to the direct children of a parent
   * group. Ordered by code, which (being a positional hierarchy code) yields
   * correct tree order: parent, then its children, then the next sibling.
   */
  async findAll(
    companyId: number | undefined,
    opts: {
      search?: string;
      categoryId?: number;
      kind?: CategoryKind;
      primaryGroupId?: number;
      parentGroupId?: number;
    } = {},
  ) {
    const scopeFilter: Prisma.GroupWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };

    // "Primary group" filter → every group whose code shares that primary's
    // L1 prefix (the primary itself and all its descendants).
    let primaryFilter: Prisma.GroupWhereInput = {};
    if (opts.primaryGroupId) {
      const primary = await this.prisma.group.findUnique({
        where: { id: opts.primaryGroupId },
        select: { code: true },
      });
      primaryFilter = primary
        ? { code: { startsWith: primaryPrefix(primary.code) } }
        : { id: -1 }; // unknown id → match nothing
    }

    const rows = await this.prisma.group.findMany({
      where: {
        AND: [
          scopeFilter,
          primaryFilter,
          opts.categoryId
            ? { categories: { some: { categoryId: opts.categoryId } } }
            : {},
          opts.kind
            ? { categories: { some: { category: { kind: opts.kind } } } }
            : {},
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
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!group || !this.isVisible(group, companyId)) {
      throw new NotFoundException('Group not found');
    }
    return this.flatten(group);
  }

  async create(dto: CreateGroupDto) {
    const subGroupApplicable = dto.subGroupApplicable ?? false;

    // Resolve where this group sits in the tree. Levels 2+ hang off a parent
    // group; level 1 starts from the all-zero root, since a group carries no
    // category segment in its code.
    let parentCode = GROUP_ROOT_CODE;
    let level = 1;
    const parentGroupId = dto.parentGroupId ?? null;

    if (parentGroupId != null) {
      const parent = await this.prisma.group.findUnique({
        where: { id: parentGroupId },
        select: {
          level: true,
          code: true,
          subGroupApplicable: true,
          categories: { select: { categoryId: true } },
        },
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
      this.assertSubsetOfParent(
        dto.categoryIds,
        parent.categories.map((c) => c.categoryId),
      );
      level = parent.level + 1;
      parentCode = parent.code;
    }

    // The deepest level cannot itself contain sub-groups.
    if (subGroupApplicable && level >= MAX_LEVEL) {
      throw new BadRequestException(
        `A level-${MAX_LEVEL} group cannot have sub-groups.`,
      );
    }

    const categoryIds = await this.resolveCategories(dto.categoryIds);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    return this.withCodeRetry(async () => {
      const n = await this.nextGroupNumber(parentGroupId, level);
      const created = await this.prisma.group.create({
        data: {
          parentGroupId,
          level,
          subGroupApplicable,
          code: groupCode(parentCode, level, n),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          allCompanies,
          isActive: dto.isActive ?? true,
          categories: {
            create: categoryIds.map((categoryId) => ({ categoryId })),
          },
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    });
  }

  async update(companyId: number | undefined, id: number, dto: UpdateGroupDto) {
    const existing = await this.prisma.group.findUnique({
      where: { id },
      include: {
        ...withRelations,
        _count: { select: { children: true, items: true, products: true } },
      },
    });
    if (!existing || !this.isVisible(existing, companyId)) {
      throw new NotFoundException('Group not found');
    }
    assertUnlocked(existing, 'group', 'editing');

    // Parent / level / code are part of the immutable hierarchy code and cannot
    // be changed after creation. The CATEGORIES can — they are a link table, not
    // part of the code — but only to a set that still covers everything below.
    const categoryIds =
      dto.categoryIds !== undefined
        ? await this.resolveCategories(dto.categoryIds)
        : null;
    if (categoryIds)
      await this.assertCategoriesStillCover(existing, categoryIds);

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
        if (existing._count.items > 0 || existing._count.products > 0) {
          throw new BadRequestException(
            'This group already has items/products, so it cannot be turned into a sub-group container.',
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
      ? this.resolveCompanies(
          allCompanies,
          dto.companyIds ?? existingCompanyIds,
        )
      : null;

    const updated = await this.prisma.group.update({
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
        ...(categoryIds
          ? {
              categories: {
                deleteMany: {},
                create: categoryIds.map((cid) => ({ categoryId: cid })),
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
      },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.group.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'group', 'deleting');
    try {
      await this.prisma.group.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'This group has sub-groups or items/products under it. Remove those first.',
        );
      }
      throw e;
    }
    return { success: true };
  }

  // --- helpers ---

  /**
   * Lowest free 2-digit number for a group at `level` under a given parent.
   * Level-1 numbering is a single global namespace (parentGroupId = null),
   * because groups are no longer partitioned by category.
   */
  private async nextGroupNumber(
    parentGroupId: number | null,
    level: number,
  ): Promise<number> {
    const sibs = await this.prisma.group.findMany({
      where: { parentGroupId },
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

  /**
   * Re-run an allocate+insert if it loses the CODE-uniqueness race. Other unique
   * columns must not be retried — the second attempt would fail the same way and
   * then surface as a raw P2002, so they are rethrown at once.
   */
  private async withCodeRetry<T>(
    fn: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (
          i < attempts &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          String(e.meta?.target ?? '').includes('code')
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  /** Every id must name a real category; duplicates are collapsed. */
  private async resolveCategories(ids: number[]): Promise<number[]> {
    const wanted = Array.from(new Set(ids)).filter((n) => n > 0);
    if (wanted.length === 0) {
      throw new BadRequestException('Select at least one category.');
    }
    const found = await this.prisma.category.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
    });
    if (found.length !== wanted.length) {
      throw new BadRequestException(
        'One of the selected categories does not exist.',
      );
    }
    return wanted;
  }

  /**
   * A sub-group may only serve categories its parent serves. Without this a
   * product could sit in a category via a group whose parent is not in that
   * category at all, leaving a hole in the tree.
   */
  private assertSubsetOfParent(childIds: number[], parentIds: number[]) {
    const parent = new Set(parentIds);
    if (!childIds.every((id) => parent.has(id))) {
      throw new BadRequestException(
        'A sub-group can only be placed in categories its parent group belongs to.',
      );
    }
  }

  /**
   * Guard a change to an existing group's categories: the new set must still be
   * a subset of the parent's, still cover every child sub-group, and still
   * include the category each item/product under this group was filed in.
   */
  private async assertCategoriesStillCover(
    existing: { id: number; parentGroupId: number | null },
    categoryIds: number[],
  ) {
    if (existing.parentGroupId != null) {
      const parent = await this.prisma.group.findUnique({
        where: { id: existing.parentGroupId },
        select: { categories: { select: { categoryId: true } } },
      });
      if (parent) {
        this.assertSubsetOfParent(
          categoryIds,
          parent.categories.map((c) => c.categoryId),
        );
      }
    }

    const orphanedChild = await this.prisma.group.findFirst({
      where: {
        parentGroupId: existing.id,
        categories: { some: { categoryId: { notIn: categoryIds } } },
      },
      select: { name: true },
    });
    if (orphanedChild) {
      throw new BadRequestException(
        `Sub-group “${orphanedChild.name}” is in a category you are removing. Change it first.`,
      );
    }

    const [item, product] = await Promise.all([
      this.prisma.item.findFirst({
        where: { groupId: existing.id, categoryId: { notIn: categoryIds } },
        select: { name: true },
      }),
      this.prisma.product.findFirst({
        where: { groupId: existing.id, categoryId: { notIn: categoryIds } },
        select: { name: true },
      }),
    ]);
    const stranded = item ?? product;
    if (stranded) {
      throw new BadRequestException(
        `“${stranded.name}” is filed in a category you are removing. Change it first.`,
      );
    }
  }

  private flatten<
    T extends {
      companies: { companyId: number }[];
      categories: {
        category: {
          id: number;
          code: string;
          name: string;
          kind: CategoryKind;
        };
      }[];
    },
  >(row: T) {
    const { companies, categories, ...rest } = row;
    const cats = categories.map((c) => c.category);
    const kinds = new Set(cats.map((c) => c.kind));
    return {
      ...rest,
      companyIds: companies.map((c) => c.companyId),
      categories: cats,
      categoryIds: cats.map((c) => c.id),
      // What the group applies to is derived, not stored: it follows from the
      // kinds of the categories it serves.
      forItem: ITEM_KINDS.some((k) => kinds.has(k)),
      forProduct: kinds.has('SEMI_FINISHED') || kinds.has('FINISHED'),
    };
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
