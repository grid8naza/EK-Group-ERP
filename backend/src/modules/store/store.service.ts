import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateStoreDto, UpdateStoreDto } from './store.dto';

@Injectable()
export class StoreService {
  constructor(private prisma: PrismaService) {}

  findAll(
    companyId: number | undefined,
    branchId: number | undefined,
    search?: string,
  ) {
    return this.prisma.store.findMany({
      // Stores are company- AND branch-scoped: with an active branch, only that
      // branch's stores are listed (companies without branches send no branch).
      where: {
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
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
    });
  }

  async findOne(id: number) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async create(
    companyId: number | undefined,
    branchId: number | undefined,
    dto: CreateStoreDto,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before adding a store.');
    }
    // The store belongs to the active branch (falls back to an explicit one, or
    // none for companies without branches).
    const storeBranchId = branchId ?? dto.branchId ?? null;
    // ST-#### per company, retrying on a unique clash.
    for (let i = 0; ; i++) {
      const n = await this.prisma.store.count({ where: { companyId } });
      const code = `ST-${String(n + 1 + i).padStart(4, '0')}`;
      try {
        return await this.prisma.store.create({
          data: {
            companyId,
            code,
            name: dto.name.trim(),
            branchId: storeBranchId,
            address: dto.address?.trim() || null,
            isActive: dto.isActive ?? true,
          },
        });
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

  async update(id: number, dto: UpdateStoreDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'store', 'editing');
    return this.prisma.store.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        branchId: dto.branchId !== undefined ? dto.branchId : undefined,
        address:
          dto.address !== undefined ? dto.address?.trim() || null : undefined,
        isActive: dto.isActive,
      },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.store.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'store', 'deleting');
    const used = await this.prisma.stockLedger.count({
      where: { storeId: id },
    });
    if (used > 0) {
      throw new BadRequestException(
        'This store has stock movements and cannot be deleted.',
      );
    }
    await this.prisma.store.delete({ where: { id } });
    return { success: true };
  }
}
