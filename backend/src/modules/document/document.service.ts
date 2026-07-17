import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateDocumentDto, UpdateDocumentDto } from './document.dto';

/** System documents wired to a real numbered flow (seeded on boot). */
const SYSTEM_DOCUMENTS: { code: string; name: string }[] = [
  { code: 'OPENING_STOCK', name: 'Opening Stock' },
  // Code stays *_IC (numbering rules key on its id; the seeder upserts by code).
  { code: 'PURCHASE_ORDER_IC', name: 'Inter-Company Purchase Order (ICPO)' },
  { code: 'PURCHASE_ORDER_LOCAL', name: 'Local Purchase Order (LPO)' },
  { code: 'GOODS_RECEIPT_NOTE', name: 'Goods Receipt Note' },
  { code: 'DELIVERY_NOTE', name: 'Delivery Note' },
  { code: 'SALES_RETURN', name: 'Sales Return' },
  { code: 'PURCHASE_RETURN', name: 'Purchase Return' },
  { code: 'GOODS_ISSUE_NOTE', name: 'Goods Issue Note' },
  { code: 'PRODUCT_TRANSFER', name: 'Product Transfer' },
  { code: 'STOCK_TRANSFER', name: 'Stock Transfer' },
  { code: 'STOCK_JOURNAL', name: 'Stock Journal' },
];

// Inventory transaction type / subtype master lookups + per-document mapping,
// from the "Inventory Transaction types" reference sheet.
const TXN_TYPE_LOOKUP = { code: 'INVENTORY_TXN_TYPE', name: 'Inventory Transaction Type' };
const TXN_SUBTYPE_LOOKUP = { code: 'INVENTORY_TXN_SUBTYPE', name: 'Inventory Transaction Subtype' };

const TXN_TYPE_VALUES = [
  'Opening Stock',
  'Production',
  'Stock Transfer',
  'Purchase',
  'Sale',
  'Purchase Return',
  'Sale Return',
  'Material Issue',
  'Adjustment',
];
const TXN_SUBTYPE_VALUES = [
  'Opening Stock',
  'Internal Production',
  'Intercompany Transfer',
  'Intercompany Purchase',
  'Intercompany Sale',
  'Intercompany Purchase Return',
  'Intercompany Sale Return',
  'Consumption',
  'Missing',
];

/** Document code → its transaction type + subtype (lookup value strings). */
const DOC_TXN_MAP: Record<string, { type: string; subtype: string }> = {
  OPENING_STOCK: { type: 'Opening Stock', subtype: 'Opening Stock' },
  PRODUCT_TRANSFER: { type: 'Production', subtype: 'Internal Production' },
  STOCK_TRANSFER: { type: 'Stock Transfer', subtype: 'Intercompany Transfer' },
  GOODS_RECEIPT_NOTE: { type: 'Purchase', subtype: 'Intercompany Purchase' },
  DELIVERY_NOTE: { type: 'Sale', subtype: 'Intercompany Sale' },
  PURCHASE_RETURN: { type: 'Purchase Return', subtype: 'Intercompany Purchase Return' },
  SALES_RETURN: { type: 'Sale Return', subtype: 'Intercompany Sale Return' },
  GOODS_ISSUE_NOTE: { type: 'Material Issue', subtype: 'Consumption' },
  STOCK_JOURNAL: { type: 'Adjustment', subtype: 'Missing' },
};

@Injectable()
export class DocumentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const d of SYSTEM_DOCUMENTS) {
        await this.prisma.document.upsert({
          where: { code: d.code },
          create: { code: d.code, name: d.name, isSystem: true },
          update: { isSystem: true },
        });
      }
      await this.seedTransactionLookups();
    } catch (e) {
      this.logger.error(
        `Seeding system documents failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Seed the Inventory Transaction Type / Subtype lookups + their values, then
   * link each system document to its type + subtype. The document link is set
   * only when unset, so an admin's later choice is preserved.
   */
  private async seedTransactionLookups(): Promise<void> {
    const inv = await this.prisma.module.findUnique({
      where: { code: 'INVENTORY' },
      select: { id: true },
    });
    const moduleId = inv?.id ?? null;

    const typeLookup = await this.prisma.lookup.upsert({
      where: { code: TXN_TYPE_LOOKUP.code },
      create: { code: TXN_TYPE_LOOKUP.code, name: TXN_TYPE_LOOKUP.name, moduleId, isSystem: true },
      update: { name: TXN_TYPE_LOOKUP.name, ...(moduleId ? { moduleId } : {}) },
    });
    const subtypeLookup = await this.prisma.lookup.upsert({
      where: { code: TXN_SUBTYPE_LOOKUP.code },
      create: { code: TXN_SUBTYPE_LOOKUP.code, name: TXN_SUBTYPE_LOOKUP.name, moduleId, isSystem: true },
      update: { name: TXN_SUBTYPE_LOOKUP.name, ...(moduleId ? { moduleId } : {}) },
    });

    const upsertValues = async (lookupId: number, values: string[]) => {
      const map = new Map<string, number>();
      for (let i = 0; i < values.length; i++) {
        const v = await this.prisma.lookupValue.upsert({
          where: { lookupId_value: { lookupId, value: values[i] } },
          create: { lookupId, value: values[i], label: values[i], sortOrder: i },
          update: { label: values[i], sortOrder: i },
        });
        map.set(values[i], v.id);
      }
      return map;
    };
    const typeMap = await upsertValues(typeLookup.id, TXN_TYPE_VALUES);
    const subtypeMap = await upsertValues(subtypeLookup.id, TXN_SUBTYPE_VALUES);

    for (const [code, m] of Object.entries(DOC_TXN_MAP)) {
      const transactionTypeId = typeMap.get(m.type) ?? null;
      const transactionSubtypeId = subtypeMap.get(m.subtype) ?? null;
      // Only set when not already linked — preserves an admin's later change.
      await this.prisma.document.updateMany({
        where: { code, transactionTypeId: null },
        data: { transactionTypeId, transactionSubtypeId },
      });
    }
  }

  /** Include the linked transaction type + subtype (id + label). */
  private readonly txnInclude = {
    transactionType: { select: { id: true, label: true } },
    transactionSubtype: { select: { id: true, label: true } },
  };

  findAll(search?: string) {
    return this.prisma.document.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      include: this.txnInclude,
    });
  }

  async findOne(id: number) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: this.txnInclude,
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async create(dto: CreateDocumentDto) {
    const code = this.slug(dto.code || dto.name);
    try {
      return await this.prisma.document.create({
        data: {
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          transactionTypeId: dto.transactionTypeId ?? null,
          transactionSubtypeId: dto.transactionSubtypeId ?? null,
          isActive: dto.isActive ?? true,
        },
        include: this.txnInclude,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A document with code "${code}" already exists.`);
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateDocumentDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'document', 'editing');
    return this.prisma.document.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
        transactionTypeId:
          dto.transactionTypeId !== undefined ? dto.transactionTypeId : undefined,
        transactionSubtypeId:
          dto.transactionSubtypeId !== undefined ? dto.transactionSubtypeId : undefined,
        isActive: dto.isActive,
      },
      include: this.txnInclude,
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.document.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'document', 'deleting');
    if (existing.isSystem) {
      throw new BadRequestException('System documents cannot be deleted.');
    }
    await this.prisma.document.delete({ where: { id } });
    return { success: true };
  }

  /** A stable UPPER_SNAKE code from a name. */
  private slug(s: string): string {
    return (
      s
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'DOC'
    );
  }
}
