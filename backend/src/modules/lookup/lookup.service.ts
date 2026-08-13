import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
          include: {
            parent: { select: { id: true, value: true, label: true } },
          },
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
    await this.assertParentLookup(null, dto.parentLookupId);
    return this.prisma.lookup.create({ data: { ...dto, code } });
  }

  /**
   * The list this one may hang from.
   *
   * Two levels, and only two: the parent must itself be flat. A subtype under a
   * subtype is a tree, and every screen that reads these — a type picker and a
   * subtype picker narrowed by it — is written for exactly two levels, so a
   * third would simply go unread.
   */
  private async assertParentLookup(
    id: number | null,
    parentLookupId: number | null | undefined,
  ): Promise<void> {
    if (parentLookupId == null) return;
    if (id != null && parentLookupId === id) {
      throw new BadRequestException('A list cannot sit under itself.');
    }
    const parent = await this.prisma.lookup.findUnique({
      where: { id: parentLookupId },
      select: { name: true, parentLookupId: true },
    });
    if (!parent) throw new NotFoundException('That list does not exist.');
    if (parent.parentLookupId) {
      throw new BadRequestException(
        `${parent.name} already sits under another list — these are read two ` +
          `levels deep, not three.`,
      );
    }
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
    if (dto.parentLookupId !== undefined) {
      await this.assertParentLookup(id, dto.parentLookupId);
      // Clearing the pairing would orphan every value already filed under a
      // parent, so it is refused while any of them exists.
      if (dto.parentLookupId === null && existing.parentLookupId !== null) {
        const filed = await this.prisma.lookupValue.count({
          where: { lookupId: id, parentValueId: { not: null } },
        });
        if (filed > 0) {
          throw new BadRequestException(
            `${filed} value${filed === 1 ? ' is' : 's are'} filed under that ` +
              `list — clear them before unpairing.`,
          );
        }
      }
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
    const lookup = await this.ensureLookup(lookupId);
    const parentValueId = await this.resolveParentValue(
      lookup,
      dto.parentValueId,
    );
    const value = dto.value?.trim()
      ? dto.value.trim()
      : await this.uniqueValueKey(lookupId, dto.label);
    return this.prisma.lookupValue.create({
      data: { ...dto, lookupId, value, parentValueId },
    });
  }

  // ---- LookupValue CRUD ----
  async createValue(dto: CreateLookupValueDto) {
    const lookup = await this.ensureLookup(dto.lookupId);
    const parentValueId = await this.resolveParentValue(
      lookup,
      dto.parentValueId,
    );
    const value = dto.value?.trim()
      ? dto.value.trim()
      : await this.uniqueValueKey(dto.lookupId, dto.label);
    return this.prisma.lookupValue.create({
      data: { ...dto, value, parentValueId },
    });
  }

  /**
   * Which value this one sits under — checked against the lookup it is being
   * added to, not merely accepted.
   *
   * A lookup that declares a `parentLookupId` is one half of a two-level list,
   * and the half that is nothing on its own: "B2C Sale" means nothing until it
   * is under "Sale". So the parent is REQUIRED there, and must be a value of
   * the declared parent lookup — pointing a transaction subtype at an icon or
   * at another subtype would produce a list that no picker can filter and no
   * voucher can pass. A flat lookup takes none: silently storing one would
   * leave a link nothing reads and nothing maintains.
   */
  private async resolveParentValue(
    lookup: { id: number; name: string; parentLookupId: number | null },
    parentValueId: number | null | undefined,
  ): Promise<number | null> {
    if (!lookup.parentLookupId) return null;
    if (parentValueId == null) {
      const parent = await this.prisma.lookup.findUnique({
        where: { id: lookup.parentLookupId },
        select: { name: true },
      });
      throw new BadRequestException(
        `Every ${lookup.name} value sits under a ${parent?.name ?? 'parent'} ` +
          `value — choose which one.`,
      );
    }
    const parentValue = await this.prisma.lookupValue.findUnique({
      where: { id: parentValueId },
      select: { lookupId: true, label: true, isActive: true },
    });
    if (!parentValue || parentValue.lookupId !== lookup.parentLookupId) {
      throw new BadRequestException(
        'That is not a value of the list this one sits under.',
      );
    }
    if (!parentValue.isActive) {
      throw new BadRequestException(
        `${parentValue.label} is no longer in use, so nothing new can be put under it.`,
      );
    }
    return parentValueId;
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
    const lookup = await this.ensureLookup(existing.lookupId);
    // Re-checked on every patch, including one that leaves the parent out: a
    // value may not be moved out from under its type, and a form that omits
    // the field is saying "leave it", not "clear it".
    const parentValueId = await this.resolveParentValue(
      lookup,
      dto.parentValueId === undefined
        ? existing.parentValueId
        : dto.parentValueId,
    );
    return this.prisma.lookupValue.update({
      where: { id },
      data: { ...dto, parentValueId },
    });
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
