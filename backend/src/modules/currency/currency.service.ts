import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateCurrencyDto, UpdateCurrencyDto } from './currency.dto';

@Injectable()
export class CurrencyService {
  constructor(private prisma: PrismaService) {}

  findAll(search?: string) {
    return this.prisma.currency.findMany({
      where: search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: number) {
    const currency = await this.prisma.currency.findUnique({ where: { id } });
    if (!currency) throw new NotFoundException('Currency not found');
    return currency;
  }

  create(dto: CreateCurrencyDto) {
    return this.prisma.currency.create({ data: dto });
  }

  async update(id: number, dto: UpdateCurrencyDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'currency', 'editing');
    return this.prisma.currency.update({ where: { id }, data: dto });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.currency.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'currency', 'deleting');
    await this.prisma.currency.delete({ where: { id } });
    return { success: true };
  }
}
