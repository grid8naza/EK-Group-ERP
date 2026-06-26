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
  CategoryScope,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './category.dto';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Categories visible in the active company: global ones (companyId null) plus
   * any scoped to this company. Company-scoped categories from other companies
   * are never returned.
   */
  findAll(companyId: number | undefined, search?: string) {
    const scopeFilter: Prisma.CategoryWhereInput = companyId
      ? { OR: [{ companyId: null }, { companyId }] }
      : { companyId: null };
    return this.prisma.category.findMany({
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
      orderBy: [{ companyId: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(companyId: number | undefined, id: number) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || !this.isVisible(category, companyId)) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async create(companyId: number | undefined, dto: CreateCategoryDto) {
    const targetCompanyId = this.resolveScope(dto.scope, companyId);
    const forItem = dto.forItem ?? true;
    const forProduct = dto.forProduct ?? false;
    this.assertAppliesToSomething(forItem, forProduct);

    const code = dto.code.trim().toUpperCase();
    await this.assertCodeFree(targetCompanyId, code);
    try {
      return await this.prisma.category.create({
        data: {
          companyId: targetCompanyId,
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          forItem,
          forProduct,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, code);
    }
  }

  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateCategoryDto,
  ) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'category', 'editing');

    const targetCompanyId =
      dto.scope !== undefined
        ? this.resolveScope(dto.scope, companyId)
        : existing.companyId;
    const forItem = dto.forItem ?? existing.forItem;
    const forProduct = dto.forProduct ?? existing.forProduct;
    this.assertAppliesToSomething(forItem, forProduct);

    const code =
      dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    if (code !== existing.code || targetCompanyId !== existing.companyId) {
      await this.assertCodeFree(targetCompanyId, code, id);
    }

    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          companyId: targetCompanyId,
          code,
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          forItem,
          forProduct,
          isActive: dto.isActive,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, code);
    }
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    return this.prisma.category.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'category', 'deleting');
    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private isVisible(
    category: { companyId: number | null },
    companyId: number | undefined,
  ): boolean {
    return category.companyId === null || category.companyId === companyId;
  }

  /** Map a scope to the stored companyId; COMPANY needs an active company. */
  private resolveScope(
    scope: CategoryScope,
    companyId: number | undefined,
  ): number | null {
    if (scope === 'GLOBAL') return null;
    if (!companyId) {
      throw new BadRequestException(
        'No active company selected for a company-specific category.',
      );
    }
    return companyId;
  }

  private assertAppliesToSomething(forItem: boolean, forProduct: boolean) {
    if (!forItem && !forProduct) {
      throw new BadRequestException(
        'A category must apply to Item, Product, or both.',
      );
    }
  }

  /** Enforce code uniqueness within the scope (handles null companyId too). */
  private async assertCodeFree(
    companyId: number | null,
    code: string,
    excludeId?: number,
  ) {
    const clash = await this.prisma.category.findFirst({
      where: {
        companyId,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `Category code "${code}" already exists in this ${
          companyId === null ? 'global list' : 'company'
        }.`,
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
