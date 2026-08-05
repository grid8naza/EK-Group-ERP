import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';

/**
 * Customer master — who the company sells to, and what details a receivable
 * control account down to a name.
 *
 * The mirror of SupplierService on purpose: the two masters are the same thing
 * seen from opposite sides, and the statement and ageing reports read them the
 * same way.
 */
@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: number | undefined, search?: string) {
    return this.prisma.customer.findMany({
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
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(companyId: number | undefined, dto: CreateCustomerDto) {
    if (!companyId) {
      throw new BadRequestException('Select a company before adding a customer.');
    }
    // CUS-#### per company, derived MAX + 1 rather than a row count: deleting a
    // customer from the middle must not hand the next one a code already taken.
    for (let i = 0; ; i++) {
      const code = `CUS-${String((await this.maxCode(companyId)) + 1 + i).padStart(4, '0')}`;
      try {
        return await this.prisma.customer.create({
          data: {
            companyId,
            code,
            name: dto.name.trim(),
            contactPerson: dto.contactPerson?.trim() || null,
            phone: dto.phone?.trim() || null,
            email: dto.email?.trim() || null,
            gstNumber: dto.gstNumber?.trim() || null,
            address: dto.address?.trim() || null,
            creditDays: dto.creditDays ?? null,
            creditLimit: dto.creditLimit ?? null,
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

  /** The highest CUS-#### issued to this company, or 0 when none. */
  private async maxCode(companyId: number): Promise<number> {
    const rows = await this.prisma.customer.findMany({
      where: { companyId, code: { startsWith: 'CUS-' } },
      select: { code: true },
      orderBy: { code: 'desc' },
      take: 1,
    });
    const n = Number(rows[0]?.code.slice(4));
    return Number.isSafeInteger(n) ? n : 0;
  }

  async update(id: number, dto: UpdateCustomerDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'customer', 'editing');
    const norm = (v?: string | null) =>
      v !== undefined ? v?.trim() || null : undefined;
    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        contactPerson: norm(dto.contactPerson),
        phone: norm(dto.phone),
        email: norm(dto.email),
        gstNumber: norm(dto.gstNumber),
        address: norm(dto.address),
        creditDays: dto.creditDays !== undefined ? dto.creditDays : undefined,
        creditLimit: dto.creditLimit !== undefined ? dto.creditLimit : undefined,
        isActive: dto.isActive,
      },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'customer', 'deleting');
    // A customer named on a posting is part of the books — the ledger says whose
    // balance moved, and deleting the name would leave a line that no longer
    // says whose.
    const posted = await this.prisma.voucherLine.count({
      where: { partyKind: 'CUSTOMER', partyId: id },
    });
    if (posted > 0) {
      throw new BadRequestException(
        'This customer has entries in the books and cannot be deleted. Make them inactive instead.',
      );
    }
    await this.prisma.customer.delete({ where: { id } });
    return { success: true };
  }
}
