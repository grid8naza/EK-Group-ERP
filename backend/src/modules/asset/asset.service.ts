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
  itemCode,
  itemSeqOf,
  lowestFree,
  MAX_ITEM_SEQ,
} from '../../common/hierarchy-code';
import { CreateAssetDto, UpdateAssetDto } from './asset.dto';

// Assets are returned with their category + leaf group and company links
// flattened. Unit references (capacityUnitId / perUnitId) are plain ids — the
// Unit master lives in another domain, so the frontend resolves their names.
const withRelations = {
  category: { select: { id: true, code: true, name: true } },
  group: { select: { id: true, code: true, name: true } },
  companies: { select: { companyId: true } },
} satisfies Prisma.AssetInclude;

@Injectable()
export class AssetService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number | undefined, search?: string) {
    const scopeFilter: Prisma.AssetWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };
    const rows = await this.prisma.asset.findMany({
      where: {
        AND: [
          scopeFilter,
          search
            ? {
                OR: [
                  { code: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                  { serialNumber: { contains: search, mode: 'insensitive' } },
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
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!asset || !this.isVisible(asset, companyId)) {
      throw new NotFoundException('Asset not found');
    }
    return this.flatten(asset);
  }

  async create(dto: CreateAssetDto) {
    await this.assertUnitRefs(dto);
    // Every asset lives under a leaf asset group; its category comes from that
    // group, and its code is generated (manual codes are not accepted).
    const group = await this.assertLeafGroup(dto.groupId);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    return this.withCodeRetry(async () => {
      const seq = await this.nextLeafSeq(dto.groupId);
      const created = await this.prisma.asset.create({
        data: {
          code: itemCode(group.code, seq),
          categoryId: group.categoryId,
          groupId: dto.groupId,
          name: dto.name.trim(),
          capacity: dto.capacity ?? 0,
          capacityUnitId: dto.capacityUnitId ?? null,
          perUnitId: dto.perUnitId ?? null,
          brand: dto.brand?.trim() || null,
          model: dto.model?.trim() || null,
          serialNumber: dto.serialNumber?.trim() || null,
          lifeSpanYears: dto.lifeSpanYears ?? 0,
          purchasedFrom: dto.purchasedFrom?.trim() || null,
          purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
          purchasePrice: dto.purchasePrice ?? 0,
          warrantyPeriod: dto.warrantyPeriod?.trim() || null,
          allCompanies,
          isActive: dto.isActive ?? true,
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    });
  }

  /**
   * The group an asset attaches to must be a leaf (no sub-groups). Returns its
   * category + code for building the asset's code.
   */
  private async assertLeafGroup(groupId: number) {
    const group = await this.prisma.assetGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        categoryId: true,
        code: true,
        subGroupApplicable: true,
        isActive: true,
      },
    });
    if (!group) {
      throw new BadRequestException('Selected asset group does not exist.');
    }
    if (!group.isActive) {
      throw new BadRequestException(
        'The selected asset group is inactive. Assets cannot be added under it.',
      );
    }
    if (group.subGroupApplicable) {
      throw new BadRequestException(
        'Assets cannot be added under a group that has sub-groups. Choose a leaf group.',
      );
    }
    return group;
  }

  /** Lowest free 5-digit sequence under a leaf asset group. */
  private async nextLeafSeq(groupId: number): Promise<number> {
    const assets = await this.prisma.asset.findMany({
      where: { groupId },
      select: { code: true },
    });
    const used = assets.map((r) => itemSeqOf(r.code));
    const n = lowestFree(used, MAX_ITEM_SEQ);
    if (n == null) {
      throw new BadRequestException(
        `Maximum of ${MAX_ITEM_SEQ} assets reached under this group.`,
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

  async update(companyId: number | undefined, id: number, dto: UpdateAssetDto) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'asset', 'editing');
    await this.assertUnitRefs(dto);

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existing.companyIds)
      : null;

    try {
      const updated = await this.prisma.asset.update({
        where: { id },
        data: {
          // code, categoryId and groupId are part of the hierarchy code and are
          // immutable after creation.
          name: dto.name?.trim(),
          capacity: dto.capacity,
          capacityUnitId: dto.capacityUnitId,
          perUnitId: dto.perUnitId,
          brand: dto.brand !== undefined ? dto.brand?.trim() || null : undefined,
          model: dto.model !== undefined ? dto.model?.trim() || null : undefined,
          serialNumber:
            dto.serialNumber !== undefined
              ? dto.serialNumber?.trim() || null
              : undefined,
          lifeSpanYears: dto.lifeSpanYears,
          purchasedFrom:
            dto.purchasedFrom !== undefined
              ? dto.purchasedFrom?.trim() || null
              : undefined,
          purchaseDate:
            dto.purchaseDate !== undefined
              ? dto.purchaseDate
                ? new Date(dto.purchaseDate)
                : null
              : undefined,
          purchasePrice: dto.purchasePrice,
          warrantyPeriod:
            dto.warrantyPeriod !== undefined
              ? dto.warrantyPeriod?.trim() || null
              : undefined,
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
    const updated = await this.prisma.asset.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'asset', 'deleting');
    await this.prisma.asset.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private flatten<T extends { companies: { companyId: number }[] }>(row: T) {
    const { companies, ...rest } = row;
    return { ...rest, companyIds: companies.map((c) => c.companyId) };
  }

  private isVisible(
    asset: { allCompanies: boolean; companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    if (asset.allCompanies) return true;
    return companyId != null
      ? asset.companies.some((c) => c.companyId === companyId)
      : false;
  }

  /** Verify the referenced capacity / per units exist (when provided). */
  private async assertUnitRefs(dto: CreateAssetDto | UpdateAssetDto) {
    const ids = [dto.capacityUnitId, dto.perUnitId].filter(
      (v): v is number => v != null,
    );
    for (const unitId of ids) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true },
      });
      if (!unit) {
        throw new BadRequestException('Selected unit does not exist.');
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
      return new ConflictException(`Asset code "${code}" already exists.`);
    }
    return e;
  }
}
