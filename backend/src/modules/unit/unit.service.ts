import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateUnitDto, ChainLinkInput, UpdateUnitDto } from './unit.dto';

// Shared shape: the base unit summary plus the resolved chaining ladder (rungs
// ordered top → bottom, each with its referenced unit's summary).
const UNIT_INCLUDE = {
  baseUnit: { select: { id: true, code: true, name: true, symbol: true } },
  chainLinks: {
    orderBy: { sequence: 'asc' },
    include: {
      linkUnit: { select: { id: true, code: true, name: true, symbol: true } },
    },
  },
} satisfies Prisma.UnitInclude;

@Injectable()
export class UnitService {
  constructor(private prisma: PrismaService) {}

  findAll(search?: string) {
    return this.prisma.unit.findMany({
      where: search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: UNIT_INCLUDE,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(id: number) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: UNIT_INCLUDE,
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(dto: CreateUnitDto) {
    await this.validateCompound(dto.type, dto.baseUnitId, dto.conversionFactor);
    const chain = await this.validateChaining(dto.type, dto.chainLinks);
    // Resolve base/factor: explicit for COMPOUND, computed for CHAINING, null else.
    const resolved = chain ?? this.compoundResolved(dto);
    // Code is system-generated (the UI never asks for one). Seeds may still pass
    // a fixed code — honour it. Otherwise derive a stable, unique key from name.
    const code = dto.code?.trim()
      ? dto.code.trim().toUpperCase()
      : await this.uniqueUnitCode(dto.name);
    try {
      return await this.prisma.unit.create({
        data: {
          code,
          name: dto.name.trim(),
          symbol: dto.symbol?.trim() || null,
          type: dto.type,
          baseUnitId: resolved.baseUnitId,
          conversionFactor: resolved.conversionFactor,
          decimalPlaces: dto.decimalPlaces ?? 0,
          isActive: dto.isActive ?? true,
          chainLinks: chain ? { create: chain.links } : undefined,
        },
        include: UNIT_INCLUDE,
      });
    } catch (e) {
      throw this.asDuplicate(e, code);
    }
  }

  // Turn a name into a stable UPPER_SNAKE key and disambiguate against existing
  // unit codes (globally unique). e.g. "Pieces" -> PIECES, then PIECES_2 if taken.
  private async uniqueUnitCode(name: string): Promise<string> {
    const base =
      name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'UNIT';
    let code = base;
    for (let n = 2; ; n++) {
      const clash = await this.prisma.unit.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!clash) return code;
      code = `${base}_${n}`;
    }
  }

  async update(id: number, dto: UpdateUnitDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'unit', 'editing');

    // Resolve the effective type/base/factor from the patch + current row, then
    // validate the combination as a whole.
    const type = dto.type ?? existing.type;
    const baseUnitId =
      dto.baseUnitId !== undefined ? dto.baseUnitId : existing.baseUnitId;
    const conversionFactor =
      dto.conversionFactor !== undefined
        ? dto.conversionFactor
        : existing.conversionFactor;
    await this.validateCompound(type, baseUnitId, conversionFactor, id);

    // For CHAINING, take the rungs from the patch if present, else keep the
    // existing ladder; resolve base/factor from it.
    const chainLinks: ChainLinkInput[] | undefined =
      type === UnitType.CHAINING
        ? (dto.chainLinks ??
          existing.chainLinks.map((l) => ({
            unitId: l.linkUnitId,
            quantity: l.quantity,
          })))
        : undefined;
    const chain = await this.validateChaining(type, chainLinks, id);

    const data: Prisma.UnitUncheckedUpdateInput = { type };
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.symbol !== undefined) data.symbol = dto.symbol?.trim() || null;
    if (dto.decimalPlaces !== undefined) data.decimalPlaces = dto.decimalPlaces;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // Keep base/factor consistent with the effective type.
    if (chain) {
      data.baseUnitId = chain.baseUnitId;
      data.conversionFactor = chain.conversionFactor;
    } else if (type === UnitType.COMPOUND) {
      data.baseUnitId = baseUnitId!;
      data.conversionFactor = conversionFactor!;
    } else {
      data.baseUnitId = null;
      data.conversionFactor = null;
    }

    try {
      // Replace the ladder when switching to / editing a chaining unit, and
      // clear it whenever the effective type is not CHAINING. Wrapped in a
      // transaction so the rungs and the resolved base/factor stay consistent.
      return await this.prisma.$transaction(async (tx) => {
        if (chain) {
          await tx.unitChainLink.deleteMany({ where: { unitId: id } });
          await tx.unitChainLink.createMany({
            data: chain.links.map((l) => ({ ...l, unitId: id })),
          });
        } else if (existing.chainLinks.length > 0) {
          await tx.unitChainLink.deleteMany({ where: { unitId: id } });
        }
        return tx.unit.update({ where: { id }, data, include: UNIT_INCLUDE });
      });
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.unit.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'unit', 'deleting');
    // Block deletion while this unit is a compound's base OR a rung of some
    // chaining ladder. (Deleting cascades only the ladder this unit OWNS, not
    // the rungs that reference it.)
    const [derived, usedInChain] = await Promise.all([
      this.prisma.unit.count({ where: { baseUnitId: id } }),
      this.prisma.unitChainLink.count({ where: { linkUnitId: id } }),
    ]);
    const refs = derived + usedInChain;
    if (refs > 0) {
      throw new ConflictException(
        `This unit is referenced by ${refs} compound/chaining definition(s). Remove or reassign them first.`,
      );
    }
    await this.prisma.unit.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  /** Base/factor for a non-chaining unit: explicit for COMPOUND, null otherwise. */
  private compoundResolved(dto: { type: UnitType; baseUnitId?: number | null; conversionFactor?: number | null }) {
    const isCompound = dto.type === UnitType.COMPOUND;
    return {
      baseUnitId: isCompound ? dto.baseUnitId! : null,
      conversionFactor: isCompound ? dto.conversionFactor! : null,
    };
  }

  /**
   * Enforce the chaining rules and resolve the ladder. A CHAINING unit owns an
   * ordered list of rungs (top → bottom); each rung references an existing,
   * non-chaining unit with a positive quantity, the last rung's unit must be
   * SIMPLE (the base the ladder bottoms out at), and no rung may reference the
   * unit itself. Returns the resolved base (last rung's unit), the conversion
   * factor (product of all quantities), and the rung rows to persist — or null
   * when the unit is not CHAINING.
   */
  private async validateChaining(
    type: UnitType,
    chainLinks?: ChainLinkInput[],
    selfId?: number,
  ) {
    if (type !== UnitType.CHAINING) return null;
    if (!chainLinks || chainLinks.length === 0) {
      throw new BadRequestException('A chaining unit needs at least one rung.');
    }
    for (const l of chainLinks) {
      if (!l.unitId) {
        throw new BadRequestException('Each rung needs a unit.');
      }
      if (!l.quantity || l.quantity <= 0) {
        throw new BadRequestException('Each rung needs a positive quantity.');
      }
      if (selfId && l.unitId === selfId) {
        throw new BadRequestException('A unit cannot reference itself in its chain.');
      }
    }

    const units = await this.prisma.unit.findMany({
      where: { id: { in: chainLinks.map((l) => l.unitId) } },
      select: { id: true, type: true },
    });
    const byId = new Map(units.map((u) => [u.id, u]));
    for (const l of chainLinks) {
      const u = byId.get(l.unitId);
      if (!u) throw new BadRequestException('A rung references a unit that does not exist.');
      if (u.type === UnitType.CHAINING) {
        throw new BadRequestException('A rung cannot reference another chaining unit.');
      }
    }
    const last = chainLinks[chainLinks.length - 1];
    if (byId.get(last.unitId)!.type !== UnitType.SIMPLE) {
      throw new BadRequestException('The last rung must reference a simple unit.');
    }

    return {
      baseUnitId: last.unitId,
      conversionFactor: chainLinks.reduce((acc, l) => acc * l.quantity, 1),
      links: chainLinks.map((l, i) => ({
        sequence: i,
        linkUnitId: l.unitId,
        quantity: l.quantity,
      })),
    };
  }

  /**
   * Enforce the simple/compound rules: a compound unit must point at an existing
   * SIMPLE base unit (not itself) and carry a positive conversion factor.
   */
  private async validateCompound(
    type: UnitType,
    baseUnitId?: number | null,
    conversionFactor?: number | null,
    selfId?: number,
  ) {
    if (type !== UnitType.COMPOUND) return;
    if (!baseUnitId) {
      throw new BadRequestException('A compound unit needs a base unit.');
    }
    if (!conversionFactor || conversionFactor <= 0) {
      throw new BadRequestException(
        'A compound unit needs a positive conversion factor.',
      );
    }
    if (selfId && baseUnitId === selfId) {
      throw new BadRequestException('A unit cannot be its own base unit.');
    }
    const base = await this.prisma.unit.findUnique({
      where: { id: baseUnitId },
    });
    if (!base) throw new BadRequestException('Base unit not found.');
    if (base.type !== UnitType.SIMPLE) {
      throw new BadRequestException('The base unit must be a simple unit.');
    }
  }

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`Unit code "${code}" already exists.`);
    }
    return e;
  }
}
