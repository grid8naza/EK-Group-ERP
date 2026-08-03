import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RECOST, RecostPort } from '../../contracts/recost.port';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  itemCode,
  itemSeqOf,
  lowestFree,
  MAX_ITEM_SEQ,
} from '../../common/hierarchy-code';
import {
  CreateHrDesignationDto,
  UpdateHrDesignationDto,
} from './hr-designation.dto';

// Designations are returned with their category + leaf group and company links
// flattened.
const withRelations = {
  category: { select: { id: true, code: true, name: true } },
  group: { select: { id: true, code: true, name: true } },
  companies: { select: { companyId: true } },
} satisfies Prisma.HrDesignationInclude;

@Injectable()
export class HrDesignationService {
  private readonly logger = new Logger(HrDesignationService.name);

  constructor(
    private prisma: PrismaService,
    // A designation's rate/hour is the manpower cost in every recipe process
    // that uses it, so a change here has to reach product costing. The product
    // module owns that; this one only announces the change through the port.
    @Inject(RECOST) private readonly recost: RecostPort,
  ) {}

  /**
   * Tell product costing that this designation's rate has moved, so every
   * recipe employing it — and everything packed from those products — is
   * recosted.
   *
   * Runs after the save has committed and never throws: the designation edit is
   * the user's action and must stand on its own. Only the COST follows; selling
   * prices and their targets are left for Price Review to raise with a human.
   */
  private async recostAfterRateChange(designationId: number): Promise<void> {
    try {
      const changed = await this.recost.recostForRateChange({
        designationIds: [designationId],
      });
      for (const c of changed) {
        this.logger.log(`Recosted ${c.name}: ${c.from} → ${c.to}`);
      }
    } catch (e) {
      this.logger.error(
        `Designation saved, but dependent product costs could not be refreshed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async findAll(companyId: number | undefined, search?: string) {
    const scopeFilter: Prisma.HrDesignationWhereInput = companyId
      ? { OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] }
      : { allCompanies: true };
    const rows = await this.prisma.hrDesignation.findMany({
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
    const designation = await this.prisma.hrDesignation.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!designation || !this.isVisible(designation, companyId)) {
      throw new NotFoundException('Designation not found');
    }
    return this.flatten(designation);
  }

  async create(dto: CreateHrDesignationDto) {
    // Every designation lives under a leaf HR group; its category comes from
    // that group, and its code is generated (manual codes are not accepted).
    const group = await this.assertLeafGroup(dto.groupId);
    const allCompanies = dto.allCompanies ?? false;
    const companyIds = this.resolveCompanies(allCompanies, dto.companyIds);

    return this.withCodeRetry(async () => {
      const seq = await this.nextLeafSeq(dto.groupId);
      const created = await this.prisma.hrDesignation.create({
        data: {
          code: itemCode(group.code, seq),
          categoryId: group.categoryId,
          groupId: dto.groupId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          ratePerHour: dto.ratePerHour ?? 0,
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
   * The group a designation attaches to must be a leaf (no sub-groups). Returns
   * its category + code for building the designation's code.
   */
  private async assertLeafGroup(groupId: number) {
    const group = await this.prisma.hrGroup.findUnique({
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
      throw new BadRequestException('Selected manpower group does not exist.');
    }
    if (!group.isActive) {
      throw new BadRequestException(
        'The selected manpower group is inactive. Designations cannot be added under it.',
      );
    }
    if (group.subGroupApplicable) {
      throw new BadRequestException(
        'Designations cannot be added under a group that has sub-groups. Choose a leaf group.',
      );
    }
    return group;
  }

  /** Lowest free 5-digit sequence under a leaf HR group. */
  private async nextLeafSeq(groupId: number): Promise<number> {
    const rows = await this.prisma.hrDesignation.findMany({
      where: { groupId },
      select: { code: true },
    });
    const used = rows.map((r) => itemSeqOf(r.code));
    const n = lowestFree(used, MAX_ITEM_SEQ);
    if (n == null) {
      throw new BadRequestException(
        `Maximum of ${MAX_ITEM_SEQ} designations reached under this group.`,
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

  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateHrDesignationDto,
  ) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'designation', 'editing');

    const allCompanies = dto.allCompanies ?? existing.allCompanies;
    const wantsLinkChange =
      dto.allCompanies !== undefined || dto.companyIds !== undefined;
    const companyIds = wantsLinkChange
      ? this.resolveCompanies(allCompanies, dto.companyIds ?? existing.companyIds)
      : null;

    try {
      const updated = await this.prisma.hrDesignation.update({
        where: { id },
        data: {
          // code, categoryId and groupId are part of the hierarchy code and are
          // immutable after creation.
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          ratePerHour: dto.ratePerHour,
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
      // Only when the rate actually moved — renaming a designation or changing
      // its company links must not touch a single product cost.
      if (
        dto.ratePerHour !== undefined &&
        dto.ratePerHour !== existing.ratePerHour
      ) {
        await this.recostAfterRateChange(id);
      }
      return this.flatten(updated);
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.hrDesignation.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'designation', 'deleting');
    await this.prisma.hrDesignation.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private flatten<T extends { companies: { companyId: number }[] }>(row: T) {
    const { companies, ...rest } = row;
    return { ...rest, companyIds: companies.map((c) => c.companyId) };
  }

  private isVisible(
    designation: { allCompanies: boolean; companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    if (designation.allCompanies) return true;
    return companyId != null
      ? designation.companies.some((c) => c.companyId === companyId)
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

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`Designation code "${code}" already exists.`);
    }
    return e;
  }
}
