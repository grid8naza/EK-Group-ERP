import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateProductionDivisionDto,
  UpdateProductionDivisionDto,
} from './production-division.dto';

const withGroups = {
  groups: { select: { id: true, primaryGroupId: true } },
};

/**
 * Production Divisions — org units of the manufacturing company (Bakery, Pastry,
 * Sweets, Savories …). Each primary product group is assigned to exactly one
 * division, so the Production Plan can group demand by division and per-division
 * performance can be traced.
 */
@Injectable()
export class ProductionDivisionService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: number | undefined, search?: string) {
    if (!companyId) return [];
    return this.prisma.productionDivision.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
      include: withGroups,
    });
  }

  async findOne(id: number) {
    const div = await this.prisma.productionDivision.findUnique({
      where: { id },
      include: withGroups,
    });
    if (!div) throw new NotFoundException('Production division not found.');
    return div;
  }

  async create(
    companyId: number | undefined,
    dto: CreateProductionDivisionDto,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before adding a division.');
    }
    const groupIds = uniq(dto.primaryGroupIds);
    await this.assertGroupsFree(companyId, groupIds, null);
    // DIV-### per company, retrying on a code clash.
    for (let i = 0; ; i++) {
      const n = await this.prisma.productionDivision.count({
        where: { companyId },
      });
      const code = `DIV-${String(n + 1 + i).padStart(3, '0')}`;
      try {
        return await this.prisma.productionDivision.create({
          data: {
            companyId,
            code,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            isActive: dto.isActive ?? true,
            groups: {
              create: groupIds.map((primaryGroupId) => ({
                companyId,
                primaryGroupId,
              })),
            },
          },
          include: withGroups,
        });
      } catch (e) {
        if (
          i < 5 &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          codeClash(e)
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  async update(id: number, dto: UpdateProductionDivisionDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'production division', 'editing');
    const groupIds =
      dto.primaryGroupIds !== undefined ? uniq(dto.primaryGroupIds) : undefined;
    if (groupIds) {
      await this.assertGroupsFree(existing.companyId, groupIds, existing.id);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionDivision.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          isActive: dto.isActive,
        },
      });
      if (groupIds) {
        await tx.productionDivisionGroup.deleteMany({
          where: { productionDivisionId: id },
        });
        if (groupIds.length) {
          await tx.productionDivisionGroup.createMany({
            data: groupIds.map((primaryGroupId) => ({
              companyId: existing.companyId,
              productionDivisionId: id,
              primaryGroupId,
            })),
          });
        }
      }
    });
    return this.findOne(id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.productionDivision.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'production division', 'deleting');
    // Group mappings cascade; the division carries no downstream postings yet.
    await this.prisma.productionDivision.delete({ where: { id } });
    return { success: true };
  }

  /** No primary group may belong to two divisions in the same company. */
  private async assertGroupsFree(
    companyId: number,
    primaryGroupIds: number[],
    exceptDivisionId: number | null,
  ): Promise<void> {
    if (!primaryGroupIds.length) return;
    const clash = await this.prisma.productionDivisionGroup.findFirst({
      where: {
        companyId,
        primaryGroupId: { in: primaryGroupIds },
        ...(exceptDivisionId
          ? { productionDivisionId: { not: exceptDivisionId } }
          : {}),
      },
    });
    if (clash) {
      throw new BadRequestException(
        'A selected primary group is already assigned to another division.',
      );
    }
  }
}

function uniq(ids: number[] | undefined): number[] {
  return Array.from(new Set(ids ?? []));
}

/** A P2002 on the division code (vs the group mapping), so we only retry codes. */
function codeClash(e: Prisma.PrismaClientKnownRequestError): boolean {
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return fields.includes('code');
}
