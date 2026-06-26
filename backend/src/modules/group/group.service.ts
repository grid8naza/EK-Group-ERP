import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateGroupDto, UpdateGroupDto } from './group.dto';

// Group rows are returned with their parent category + company links flattened.
const withRelations = {
  companies: { select: { companyId: true } },
  category: { select: { id: true, code: true, name: true } },
} satisfies Prisma.GroupInclude;

@Injectable()
export class GroupService {
  constructor(private prisma: PrismaService) {}

  /**
   * Groups available in the active company: ones flagged for all companies plus
   * any explicitly linked to this company. With no active company, only the
   * all-companies ones are returned.
   */
  async findAll(companyId: number | undefined, search?: string) {
    const scopeFilter: Prisma.GroupWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };
    const rows = await this.prisma.group.findMany({
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
    await this.assertCategoryExists(dto.categoryId);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);
    const forItem = dto.forItem ?? true;
    const forProduct = dto.forProduct ?? false;
    this.assertAppliesToSomething(forItem, forProduct);

    try {
      const created = await this.prisma.group.create({
        data: {
          categoryId: dto.categoryId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          allCompanies,
          forItem,
          forProduct,
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

  async update(companyId: number | undefined, id: number, dto: UpdateGroupDto) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'group', 'editing');
    if (dto.categoryId !== undefined && dto.categoryId !== existing.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existing.companyIds)
      : null;

    const forItem = dto.forItem ?? existing.forItem;
    const forProduct = dto.forProduct ?? existing.forProduct;
    this.assertAppliesToSomething(forItem, forProduct);

    try {
      const updated = await this.prisma.group.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          code: dto.code !== undefined ? dto.code.trim().toUpperCase() : undefined,
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          allCompanies,
          forItem,
          forProduct,
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
    await this.prisma.group.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

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

  private async assertCategoryExists(categoryId: number) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException('Selected category does not exist.');
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

  private assertAppliesToSomething(forItem: boolean, forProduct: boolean) {
    if (!forItem && !forProduct) {
      throw new BadRequestException(
        'A group must apply to Item, Product, or both.',
      );
    }
  }

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`Group code "${code}" already exists.`);
    }
    return e;
  }
}
