import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateLookupDto,
  CreateLookupValueDto,
  UpdateLookupDto,
  UpdateLookupValueDto,
} from './lookup.dto';

/** Normalize free text into an UPPER_SNAKE key (letters/digits only). */
function slugKey(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

@Injectable()
export class LookupService {
  constructor(private prisma: PrismaService) {}

  // ---- Lookups ----
  // When `moduleId` is given, scope to that module — PLUS the global lookups
  // (moduleId null), which belong to no one module and are meant to be reachable
  // from every module's Lookups screen. Without them a global list would exist
  // in the database with no screen able to edit it. No filter at all = every
  // lookup, used by consumers that resolve one by code (e.g. Object Master
  // Author).
  findAll(moduleId?: number) {
    return this.prisma.lookup.findMany({
      where:
        moduleId !== undefined
          ? { OR: [{ moduleId }, { moduleId: null }] }
          : undefined,
      include: {
        _count: { select: { values: true } },
        module: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const lookup = await this.prisma.lookup.findUnique({
      where: { id },
      include: {
        values: {
          orderBy: { label: 'asc' },
          // The type a subtype sits under, so a two-level list can be shown and
          // filtered without a second round trip.
          include: { parent: { select: { id: true, value: true, label: true } } },
        },
      },
    });
    if (!lookup) throw new NotFoundException('Lookup not found');
    return lookup;
  }

  async create(dto: CreateLookupDto) {
    // Code is system-generated (the UI never asks for one). Seeds may still pass
    // a fixed code — honour it. Otherwise derive a stable, unique key from name.
    const code = dto.code?.trim()
      ? dto.code.trim()
      : await this.uniqueLookupCode(dto.name);
    return this.prisma.lookup.create({ data: { ...dto, code } });
  }

  // Turn a name into a stable UPPER_SNAKE key and disambiguate against existing
  // lookup codes (they are globally unique). e.g. "Asset Brands" -> ASSET_BRANDS,
  // then ASSET_BRANDS_2 if taken.
  private async uniqueLookupCode(name: string): Promise<string> {
    const base = slugKey(name) || 'LOOKUP';
    let code = base;
    for (let n = 2; ; n++) {
      const clash = await this.prisma.lookup.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!clash) return code;
      code = `${base}_${n}`;
    }
  }

  async update(id: number, dto: UpdateLookupDto) {
    const existing = await this.ensureLookup(id);
    assertUnlocked(existing, 'lookup', 'editing');
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
    assertUnlocked(existing, 'lookup', 'deleting');
    await this.prisma.lookup.delete({ where: { id } });
    return { success: true };
  }

  // ---- Values of a lookup ----
  async findValues(lookupId: number) {
    await this.ensureLookup(lookupId);
    return this.prisma.lookupValue.findMany({
      where: { lookupId },
      // sortOrder first: a seeded taxonomy is ordered deliberately (Sale before
      // Sale Return), and alphabetical would scatter it.
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: { parent: { select: { id: true, value: true, label: true } } },
    });
  }

  async createValueForLookup(
    lookupId: number,
    dto: Omit<CreateLookupValueDto, 'lookupId'> & { lookupId?: number },
  ) {
    await this.ensureLookup(lookupId);
    const value = dto.value?.trim()
      ? dto.value.trim()
      : await this.uniqueValueKey(lookupId, dto.label);
    return this.prisma.lookupValue.create({
      data: { ...dto, lookupId, value },
    });
  }

  // ---- LookupValue CRUD ----
  async createValue(dto: CreateLookupValueDto) {
    await this.ensureLookup(dto.lookupId);
    const value = dto.value?.trim()
      ? dto.value.trim()
      : await this.uniqueValueKey(dto.lookupId, dto.label);
    return this.prisma.lookupValue.create({ data: { ...dto, value } });
  }

  // Derive a stable key from a value's label, unique within its lookup so the
  // label stays freely renamable without disturbing what was stored elsewhere.
  private async uniqueValueKey(
    lookupId: number,
    label: string,
  ): Promise<string> {
    const base = slugKey(label) || 'VALUE';
    let value = base;
    for (let n = 2; ; n++) {
      const clash = await this.prisma.lookupValue.findFirst({
        where: { lookupId, value },
        select: { id: true },
      });
      if (!clash) return value;
      value = `${base}_${n}`;
    }
  }

  async findOneValue(id: number) {
    const value = await this.prisma.lookupValue.findUnique({ where: { id } });
    if (!value) throw new NotFoundException('Lookup value not found');
    return value;
  }

  async updateValue(id: number, dto: UpdateLookupValueDto) {
    const existing = await this.findOneValue(id);
    assertUnlocked(existing, 'lookup value', 'editing');
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
    assertUnlocked(existing, 'lookup value', 'deleting');
    await this.prisma.lookupValue.delete({ where: { id } });
    return { success: true };
  }

  private async ensureLookup(id: number) {
    const lookup = await this.prisma.lookup.findUnique({ where: { id } });
    if (!lookup) throw new NotFoundException('Lookup not found');
    return lookup;
  }
}
