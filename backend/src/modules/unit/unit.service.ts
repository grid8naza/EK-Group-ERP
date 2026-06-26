import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, UnitType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { backfillInventoryScaffold } from './inventory-provisioning';
import { CreateUnitDto, UpdateUnitDto } from './unit.dto';

@Injectable()
export class UnitService implements OnModuleInit {
  private readonly logger = new Logger(UnitService.name);

  constructor(private prisma: PrismaService) {}

  // Enable Inventory + provision its menu (and default units) for every
  // company on boot. Idempotent — a no-op once everything is in place.
  async onModuleInit() {
    try {
      await backfillInventoryScaffold(this.prisma);
    } catch (e) {
      this.logger.error(
        `Inventory scaffold back-fill failed: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }

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
      include: { baseUnit: { select: { id: true, code: true, name: true } } },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(id: number) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: { baseUnit: { select: { id: true, code: true, name: true } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(dto: CreateUnitDto) {
    await this.validateCompound(dto.type, dto.baseUnitId, dto.conversionFactor);
    const isCompound = dto.type === UnitType.COMPOUND;
    try {
      return await this.prisma.unit.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          symbol: dto.symbol?.trim() || null,
          type: dto.type,
          baseUnitId: isCompound ? dto.baseUnitId! : null,
          conversionFactor: isCompound ? dto.conversionFactor! : null,
          decimalPlaces: dto.decimalPlaces ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
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

    const isCompound = type === UnitType.COMPOUND;
    const data: Prisma.UnitUncheckedUpdateInput = { type };
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.symbol !== undefined) data.symbol = dto.symbol?.trim() || null;
    if (dto.decimalPlaces !== undefined) data.decimalPlaces = dto.decimalPlaces;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // Keep base/factor consistent with the effective type.
    data.baseUnitId = isCompound ? baseUnitId! : null;
    data.conversionFactor = isCompound ? conversionFactor! : null;

    try {
      return await this.prisma.unit.update({ where: { id }, data });
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
    const derived = await this.prisma.unit.count({
      where: { baseUnitId: id },
    });
    if (derived > 0) {
      throw new ConflictException(
        `This unit is the base of ${derived} compound unit(s). Remove or reassign them first.`,
      );
    }
    await this.prisma.unit.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

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
