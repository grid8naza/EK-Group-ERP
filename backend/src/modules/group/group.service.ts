import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  categoryCode,
  groupCode,
  groupNumberAt,
  lowestFree,
  MAX_GROUP,
  MAX_LEVEL,
  primaryPrefix,
} from '../../common/hierarchy-code';
import { CreateGroupDto, UpdateGroupDto } from './group.dto';

// Group rows are returned with their parent category, parent group, and company
// links flattened.
const withRelations = {
  companies: { select: { companyId: true } },
  category: { select: { id: true, code: true, name: true } },
  parent: { select: { id: true, code: true, name: true } },
} satisfies Prisma.GroupInclude;

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  /**
   * Groups available in the active company, optionally narrowed to a primary
   * group's whole subtree and/or to the direct children of a parent group.
   * Ordered by code, which (being a positional hierarchy code) yields correct
   * tree order: parent, then its children, then the next sibling.
   */
  async findAll(
    companyId: number | undefined,
    opts: { search?: string; primaryGroupId?: number; parentGroupId?: number } = {},
  ) {
    const scopeFilter: Prisma.GroupWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };

    // "Primary group" filter → every group whose code shares that primary's
    // CC+L1 prefix (the primary itself and all its descendants).
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
    const forItem = dto.forItem ?? true;
    const forProduct = dto.forProduct ?? false;
    this.assertAppliesToSomething(forItem, forProduct);
    const subGroupApplicable = dto.subGroupApplicable ?? false;

    // Resolve where this group sits in the tree.
    let categoryId = dto.categoryId;
    let parentCode: string;
    let level = 1;
    const parentGroupId = dto.parentGroupId ?? null;

    if (parentGroupId != null) {
      const parent = await this.prisma.group.findUnique({
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
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { code: true },
      });
      if (!category) {
        throw new BadRequestException('Selected category does not exist.');
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
    const productStage = await this.resolveStage(
      dto.productStage ?? null,
      { level, forProduct },
      null,
    );

    return this.withCodeRetry(async () => {
      const n = await this.nextGroupNumber(categoryId, parentGroupId, level);
      const created = await this.prisma.group.create({
        data: {
          categoryId,
          parentGroupId,
          level,
          subGroupApplicable,
          code: groupCode(parentCode, level, n),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          allCompanies,
          forItem,
          forProduct,
          productStage,
          isActive: dto.isActive ?? true,
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

    // Category / parent / level / code are part of the immutable hierarchy code
    // and cannot be changed after creation.

    const forItem = dto.forItem ?? existing.forItem;
    const forProduct = dto.forProduct ?? existing.forProduct;
    this.assertAppliesToSomething(forItem, forProduct);

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

    // The stage tag: taken from the payload when sent, otherwise carried over.
    // Re-validated either way, since toggling Product changes whether a stage is
    // required or forbidden — an edit that leaves a primary product group
    // untagged is rejected. Dropping Product drops the tag with it, rather than
    // stranding it on an item-only group.
    const requestedStage = !forProduct
      ? null
      : dto.productStage !== undefined
        ? dto.productStage
        : existing.productStage;
    const productStage = await this.resolveStage(
      requestedStage,
      { level: existing.level, forProduct },
      id,
    );

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const existingCompanyIds = existing.companies.map((c) => c.companyId);
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existingCompanyIds)
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
        forItem,
        forProduct,
        productStage,
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

  /** Lowest free 2-digit number for a group at `level` under a given parent. */
  private async nextGroupNumber(
    categoryId: number,
    parentGroupId: number | null,
    level: number,
  ): Promise<number> {
    const sibs = await this.prisma.group.findMany({
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

  /**
   * Re-run an allocate+insert if it loses the CODE-uniqueness race. Other unique
   * columns (productStage) must not be retried — the second attempt would fail
   * the same way and then surface as a raw P2002, so they are rethrown at once.
   */
  private async withCodeRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
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

  /**
   * Validate a production-stage tag. It marks the one primary product group a
   * product screen lists, so it is MANDATORY on a level-1 group that applies to
   * products, forbidden anywhere else, and at most one group may hold each
   * stage. Nothing sets it implicitly — the user chooses. The unique index is
   * the real guard on the last rule; this check exists to fail with a message
   * naming the group that already holds it. `selfId` is the row being updated.
   */
  private async resolveStage(
    stage: ProductStage | null,
    group: { level: number; forProduct: boolean },
    selfId: number | null,
  ): Promise<ProductStage | null> {
    const applicable = group.forProduct && group.level === 1;
    if (stage == null) {
      if (applicable) {
        throw new BadRequestException(
          'Select a production stage (Semi-finished or Finished) — a primary group that applies to Products must declare one.',
        );
      }
      return null;
    }
    if (!group.forProduct) {
      throw new BadRequestException(
        'Only a group that applies to Products can hold a production stage.',
      );
    }
    if (group.level !== 1) {
      throw new BadRequestException(
        'Only a primary (level 1) group can hold a production stage — its sub-groups inherit it.',
      );
    }
    const holder = await this.prisma.group.findUnique({
      where: { productStage: stage },
      select: { id: true, name: true },
    });
    if (holder && holder.id !== selfId) {
      throw new ConflictException(
        `“${holder.name}” already holds that production stage. Clear it there first.`,
      );
    }
    return stage;
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

  private assertAppliesToSomething(forItem: boolean, forProduct: boolean) {
    if (!forItem && !forProduct) {
      throw new BadRequestException(
        'A group must apply to Item, Product, or both.',
      );
    }
  }
}
