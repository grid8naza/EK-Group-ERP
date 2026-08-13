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
  categoryCode,
  categoryNumberOf,
  lowestFree,
  MAX_CATEGORY,
} from '../../common/hierarchy-code';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

// A category row with its company links, flattened to companyIds for the API.
const withCompanies = {
  companies: { select: { companyId: true } },
} satisfies Prisma.CategoryInclude;

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Categories available in the active company: ones flagged for all companies
   * plus any explicitly linked to this company. With no active company, only
   * the all-companies ones are returned. `kind` narrows to one of the four
   * kinds — that is how each master screen finds the categories it owns.
   */
  async findAll(
    companyId: number | undefined,
    search?: string,
    kind?: CategoryKind,
  ) {
    const scopeFilter: Prisma.CategoryWhereInput = companyId
      ? {
          OR: [{ allCompanies: true }, { companies: { some: { companyId } } }],
        }
      : { allCompanies: true };
    const rows = await this.prisma.category.findMany({
      where: {
        AND: [
          scopeFilter,
          kind ? { kind } : {},
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
      include: withCompanies,
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.flatten(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: withCompanies,
    });
    if (!category || !this.isVisible(category, companyId)) {
      throw new NotFoundException('Category not found');
    }
    return this.flatten(category);
  }

  async create(dto: CreateCategoryDto) {
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    // The code is system-generated (2-digit category segment); manual codes are
    // not accepted. Retry on the rare race where two categories grab the same
    // number at once (the unique code constraint catches it).
    return this.withCodeRetry(async () => {
      const code = categoryCode(await this.nextCategoryNumber());
      const created = await this.prisma.category.create({
        data: {
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          allCompanies,
          kind: dto.kind,
          isActive: dto.isActive ?? true,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
        include: withCompanies,
      });
      return this.flatten(created);
    });
  }

  /** Lowest free 2-digit category number (1..99). */
  private async nextCategoryNumber(): Promise<number> {
    const rows = await this.prisma.category.findMany({
      select: { code: true },
    });
    const used = rows.map((r) => categoryNumberOf(r.code));
    const n = lowestFree(used, MAX_CATEGORY);
    if (n == null) {
      throw new BadRequestException(
        `Maximum of ${MAX_CATEGORY} categories reached.`,
      );
    }
    return n;
  }

  /** Re-run an allocate+insert if it loses the code-uniqueness race. */
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
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateCategoryDto,
  ) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'category', 'editing');

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    // Only recompute the links when the caller sent new availability data.
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(
          allCompanies,
          dto.companyIds ?? existing.companyIds,
        )
      : null;

    const kind = dto.kind ?? existing.kind;
    if (kind !== existing.kind) await this.assertKindChangeable(id);

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data: {
          // code is system-generated and immutable — never updated here.
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          allCompanies,
          kind,
          isActive: dto.isActive,
          // Replace the link set when availability changed.
          ...(companyIds
            ? {
                companies: {
                  deleteMany: {},
                  create: companyIds.map((cid) => ({ companyId: cid })),
                },
              }
            : {}),
        },
        include: withCompanies,
      });
      return this.flatten(updated);
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.category.update({
      where: { id },
      data: { isLocked: locked },
      include: withCompanies,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'category', 'deleting');
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new ConflictException(
          'This category still has groups, items or products under it. Remove those first.',
        );
      }
      throw e;
    }
    return { success: true };
  }

  // --- helpers ---

  private flatten<T extends { companies: { companyId: number }[] }>(row: T) {
    const { companies, ...rest } = row;
    return { ...rest, companyIds: companies.map((c) => c.companyId) };
  }

  private isVisible(
    category: { allCompanies: boolean; companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    if (category.allCompanies) return true;
    return companyId != null
      ? category.companies.some((c) => c.companyId === companyId)
      : false;
  }

  /** Validate + normalise the company selection for the chosen availability. */
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

  /**
   * The kind decides which master a category holds, so re-pointing it once
   * anything hangs off the category would strand those rows on the wrong screen
   * — and, for items/products, invalidate the CC digits of their codes. It stays
   * editable only while the category is still empty.
   */
  private async assertKindChangeable(id: number) {
    const [groups, items, products] = await Promise.all([
      this.prisma.groupCategory.count({ where: { categoryId: id } }),
      this.prisma.item.count({ where: { categoryId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);
    if (groups || items || products) {
      throw new BadRequestException(
        'This category already has groups, items or products under it, so what it applies to cannot be changed. Move or remove those first.',
      );
    }
  }

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`Category code "${code}" already exists.`);
    }
    return e;
  }
}
