import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLookupDto,
  CreateLookupValueDto,
  UpdateLookupDto,
  UpdateLookupValueDto,
} from './lookup.dto';

@Injectable()
export class LookupService {
  constructor(private prisma: PrismaService) {}

  // ---- Lookups ----
  findAll() {
    return this.prisma.lookup.findMany({
      include: { _count: { select: { values: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const lookup = await this.prisma.lookup.findUnique({
      where: { id },
      include: { values: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!lookup) throw new NotFoundException('Lookup not found');
    return lookup;
  }

  create(dto: CreateLookupDto) {
    return this.prisma.lookup.create({ data: dto });
  }

  async update(id: number, dto: UpdateLookupDto) {
    const existing = await this.ensureLookup(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This lookup is locked. Unlock it before editing.',
      );
    }
    return this.prisma.lookup.update({ where: { id }, data: dto });
  }

  async setLock(id: number, locked: boolean) {
    await this.ensureLookup(id);
    return this.prisma.lookup.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.ensureLookup(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This lookup is locked. Unlock it before deleting.',
      );
    }
    await this.prisma.lookup.delete({ where: { id } });
    return { success: true };
  }

  // ---- Values of a lookup ----
  async findValues(lookupId: number) {
    await this.ensureLookup(lookupId);
    return this.prisma.lookupValue.findMany({
      where: { lookupId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createValueForLookup(
    lookupId: number,
    dto: Omit<CreateLookupValueDto, 'lookupId'> & { lookupId?: number },
  ) {
    await this.ensureLookup(lookupId);
    return this.prisma.lookupValue.create({
      data: { ...dto, lookupId },
    });
  }

  // ---- LookupValue CRUD ----
  createValue(dto: CreateLookupValueDto) {
    return this.prisma.lookupValue.create({ data: dto });
  }

  async findOneValue(id: number) {
    const value = await this.prisma.lookupValue.findUnique({ where: { id } });
    if (!value) throw new NotFoundException('Lookup value not found');
    return value;
  }

  async updateValue(id: number, dto: UpdateLookupValueDto) {
    const existing = await this.findOneValue(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This lookup value is locked. Unlock it before editing.',
      );
    }
    return this.prisma.lookupValue.update({ where: { id }, data: dto });
  }

  async setLockValue(id: number, locked: boolean) {
    await this.findOneValue(id);
    return this.prisma.lookupValue.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async removeValue(id: number) {
    const existing = await this.findOneValue(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This lookup value is locked. Unlock it before deleting.',
      );
    }
    await this.prisma.lookupValue.delete({ where: { id } });
    return { success: true };
  }

  private async ensureLookup(id: number) {
    const lookup = await this.prisma.lookup.findUnique({ where: { id } });
    if (!lookup) throw new NotFoundException('Lookup not found');
    return lookup;
  }
}
