import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateRackDto, UpdateRackDto } from './rack.dto';

@Injectable()
export class RackService {
  constructor(private prisma: PrismaService) {}

  findAll(
    companyId: number | undefined,
    storeId?: number,
    search?: string,
  ) {
    return this.prisma.rack.findMany({
      // Racks live inside a store, so they inherit the store's company scope; an
      // optional storeId narrows to a single store (the Product form picker).
      where: {
        ...(companyId ? { companyId } : {}),
        ...(storeId ? { storeId } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ storeId: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(id: number) {
    const rack = await this.prisma.rack.findUnique({ where: { id } });
    if (!rack) throw new NotFoundException('Rack not found');
    return rack;
  }

  async create(companyId: number | undefined, dto: CreateRackDto) {
    if (!companyId) {
      throw new BadRequestException('Select a company before adding a rack.');
    }
    // The rack inherits its company from the parent store — which must belong to
    // the active company.
    const store = await this.prisma.store.findUnique({
      where: { id: dto.storeId },
      select: { id: true, companyId: true },
    });
    if (!store || store.companyId !== companyId) {
      throw new BadRequestException('Choose a store in the active company.');
    }
    // RK-#### per store, retrying on a unique clash.
    for (let i = 0; ; i++) {
      const n = await this.prisma.rack.count({
        where: { storeId: dto.storeId },
      });
      const code = `RK-${String(n + 1 + i).padStart(4, '0')}`;
      try {
        const rack = await this.prisma.rack.create({
          data: {
            companyId,
            storeId: dto.storeId,
            code,
            name: dto.name.trim(),
            isDefault: dto.isDefault ?? false,
            isActive: dto.isActive ?? true,
          },
        });
        if (rack.isDefault) {
          await this.clearOtherDefaults(rack.storeId, rack.id);
        }
        return rack;
      } catch (e) {
        if (
          i < 5 &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  async update(id: number, dto: UpdateRackDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'rack', 'editing');
    // A rack cannot move to another company's store; only within its own company.
    if (dto.storeId !== undefined && dto.storeId !== existing.storeId) {
      const store = await this.prisma.store.findUnique({
        where: { id: dto.storeId },
        select: { companyId: true },
      });
      if (!store || store.companyId !== existing.companyId) {
        throw new BadRequestException(
          'A rack can only move to a store in the same company.',
        );
      }
    }
    const updated = await this.prisma.rack.update({
      where: { id },
      data: {
        storeId: dto.storeId,
        name: dto.name?.trim(),
        isDefault: dto.isDefault,
        isActive: dto.isActive,
      },
    });
    if (dto.isDefault) {
      await this.clearOtherDefaults(updated.storeId, updated.id);
    }
    return updated;
  }

  /** Only one rack per store may be the default; clear the others. */
  private async clearOtherDefaults(
    storeId: number,
    exceptId: number,
  ): Promise<void> {
    await this.prisma.rack.updateMany({
      where: { storeId, isDefault: true, NOT: { id: exceptId } },
      data: { isDefault: false },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.rack.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'rack', 'deleting');
    // Don't strand a product's put-away location: block deleting a rack that is
    // still assigned as a default on any product's branch stock.
    const used = await this.prisma.productBranchStock.count({
      where: { defaultRackId: id },
    });
    if (used > 0) {
      throw new BadRequestException(
        'This rack is a default location for some products and cannot be deleted.',
      );
    }
    await this.prisma.rack.delete({ where: { id } });
    return { success: true };
  }
}
