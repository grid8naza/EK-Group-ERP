import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { gstStateCode, gstStateName } from '../../common/gst-states';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CONTROL_ACCOUNT_SELECT,
  resolveControlAccount,
} from '../../common/control-account';
import { CreateSupplierDto, UpdateSupplierDto } from './supplier.dto';

/**
 * The 2-digit GST state code for a party, from whatever the form gave.
 *
 * The GSTIN first — its opening two characters ARE the code, so a registered
 * party is never asked twice and the code cannot disagree with the number the
 * return quotes. Then an explicit code, then a state name. Null when nothing
 * says, which is honest: a bill refuses to be raised rather than guessing, and
 * guessing here means charging the wrong tax.
 */
function resolveState(dto: {
  gstNumber?: string | null;
  state?: string | null;
  stateCode?: string | null;
}): string | null {
  return (
    gstStateCode(dto.gstNumber, dto.stateCode) ??
    gstStateCode(null, dto.state) ??
    null
  );
}

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
      // The main ledger comes with the list: a voucher screen filters its party
      // picker on it, and the master listing names it in a column.
      include: { controlAccount: CONTROL_ACCOUNT_SELECT },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { controlAccount: CONTROL_ACCOUNT_SELECT },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async create(companyId: number | undefined, dto: CreateSupplierDto) {
    if (!companyId) {
      throw new BadRequestException(
        'Select a company before adding a supplier.',
      );
    }
    const controlAccountId = await resolveControlAccount(
      this.prisma,
      companyId,
      dto.controlAccountId,
      'SUPPLIER',
    );
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
            state: gstStateName(resolveState(dto)) ?? dto.state?.trim() ?? null,
            stateCode: resolveState(dto),
            address: dto.address?.trim() || null,
            creditDays: dto.creditDays ?? null,
            creditLimit: dto.creditLimit ?? null,
            controlAccountId,
            isActive: dto.isActive ?? true,
          },
          include: { controlAccount: CONTROL_ACCOUNT_SELECT },
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
    // Checked against the company that OWNS the supplier, not the active one:
    // the main ledger belongs to the party's own books.
    const controlAccountId =
      dto.controlAccountId !== undefined
        ? await resolveControlAccount(
            this.prisma,
            existing.companyId,
            dto.controlAccountId,
            'SUPPLIER',
          )
        : undefined;
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        contactPerson: norm(dto.contactPerson),
        phone: norm(dto.phone),
        email: norm(dto.email),
        gstNumber: norm(dto.gstNumber),
        state: gstStateName(resolveState(dto)) ?? norm(dto.state),
        stateCode: resolveState(dto),
        address: norm(dto.address),
        creditDays: dto.creditDays !== undefined ? dto.creditDays : undefined,
        creditLimit:
          dto.creditLimit !== undefined ? dto.creditLimit : undefined,
        controlAccountId,
        isActive: dto.isActive,
      },
      include: { controlAccount: CONTROL_ACCOUNT_SELECT },
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
