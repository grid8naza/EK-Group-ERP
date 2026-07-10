import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateSupplierDto, UpdateSupplierDto } from './supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: number | undefined, search?: string) {
    return this.prisma.supplier.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async create(companyId: number | undefined, dto: CreateSupplierDto) {
    if (!companyId) {
      throw new BadRequestException('Select a company before adding a supplier.');
    }
    // SUP-#### per company, retrying on a unique clash.
    for (let i = 0; ; i++) {
      const n = await this.prisma.supplier.count({ where: { companyId } });
      const code = `SUP-${String(n + 1 + i).padStart(4, '0')}`;
      try {
        return await this.prisma.supplier.create({
          data: {
            companyId,
            code,
            name: dto.name.trim(),
            contactPerson: dto.contactPerson?.trim() || null,
            phone: dto.phone?.trim() || null,
            email: dto.email?.trim() || null,
            gstNumber: dto.gstNumber?.trim() || null,
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

  async update(id: number, dto: UpdateSupplierDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'supplier', 'editing');
    const norm = (v?: string | null) =>
      v !== undefined ? v?.trim() || null : undefined;
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        contactPerson: norm(dto.contactPerson),
        phone: norm(dto.phone),
        email: norm(dto.email),
        gstNumber: norm(dto.gstNumber),
        address: norm(dto.address),
        isActive: dto.isActive,
      },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'supplier', 'deleting');
    const used = await this.prisma.stockTransaction.count({
      where: { supplierId: id },
    });
    if (used > 0) {
      throw new BadRequestException(
        'This supplier is used on goods receipts and cannot be deleted.',
      );
    }
    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
  }
}
