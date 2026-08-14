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
  { code: 'SALES_ORDER_IC', name: 'Inter-Company Sales Order (ICSO)' },
  { code: 'WORK_ORDER', name: 'Work Order' },
  { code: 'PRODUCTION_PLAN', name: 'Production Plan' },
  { code: 'MATERIAL_REQUEST', name: 'Material Request' },
  { code: 'PRODUCTION_RECEIPT', name: 'Production Receipt' },
  { code: 'PACKING', name: 'Packing' },
  { code: 'GOODS_RECEIPT_NOTE', name: 'Goods Receipt Note' },
  { code: 'DELIVERY_NOTE', name: 'Delivery Note' },
  { code: 'DISPATCH', name: 'Dispatch' },
  { code: 'SALES_INVOICE', name: 'Sales Invoice' },
  { code: 'EWAY_BILL', name: 'E-Way Bill' },
  { code: 'SALES_RETURN', name: 'Sales Return' },
  { code: 'PURCHASE_RETURN', name: 'Purchase Return' },
  { code: 'GOODS_ISSUE_NOTE', name: 'Goods Issue Note' },
  { code: 'PRODUCT_TRANSFER', name: 'Product Transfer' },
  { code: 'STOCK_TRANSFER', name: 'Stock Transfer' },
  { code: 'STOCK_JOURNAL', name: 'Stock Journal' },
  // Ledger vouchers — one per hand-written kind. Each numbers separately, so a
  // cash receipt and a bank receipt raised on the same day do not share a
  // series.
  { code: 'CASH_RECEIPT_VOUCHER', name: 'Cash Receipt Voucher' },
  { code: 'CASH_PAYMENT_VOUCHER', name: 'Cash Payment Voucher' },
  { code: 'BANK_RECEIPT_VOUCHER', name: 'Bank Receipt Voucher' },
  { code: 'BANK_PAYMENT_VOUCHER', name: 'Bank Payment Voucher' },
  { code: 'PURCHASE_VOUCHER', name: 'Purchase Voucher' },
  { code: 'SALES_VOUCHER', name: 'Sales Voucher' },
  { code: 'JOURNAL_VOUCHER', name: 'Journal Voucher' },
  { code: 'CONTRA_VOUCHER', name: 'Contra Voucher' },
  { code: 'DEBIT_NOTE_VOUCHER', name: 'Debit Note Voucher' },
  { code: 'CREDIT_NOTE_VOUCHER', name: 'Credit Note Voucher' },
  // Not a transaction, but numbered by the same machinery on purpose: an
  // employee code is a number a company issues once and quotes for ever after,
  // and HR should be able to shape it (EK/EMP/0001) from the same screen as
  // everything else rather than live with whatever a developer hard-coded.
  { code: 'EMPLOYEE', name: 'Employee' },
];

/**
 * System documents that no longer back a screen. Deactivated rather than
 * deleted: a company may have configured a numbering rule against one, and the
 * rule points at the document's id.
 */
const RETIRED_DOCUMENTS = ['PAYMENT_VOUCHER', 'RECEIPT_VOUCHER'];

// Transaction type / subtype master lookups + per-document mapping, from the
// "Inventory Transaction types" reference sheet, since widened.
//
// GLOBAL (moduleId null) rather than owned by Inventory: the same taxonomy now
// classifies stock movements AND ledger vouchers, so a sale is the same kind of
// sale in the stock book and in the books of account. Two module-scoped copies
// would drift, and a figure that reconciles in one place would not in the other.
const TXN_TYPE_LOOKUP = {
  code: 'TRANSACTION_TYPE',
  name: 'Transaction Type',
  /** What it was called when Inventory owned it; renamed in place on boot. */
  legacyCode: 'INVENTORY_TXN_TYPE',
};
const TXN_SUBTYPE_LOOKUP = {
  code: 'TRANSACTION_SUBTYPE',
  name: 'Transaction Subtype',
  legacyCode: 'INVENTORY_TXN_SUBTYPE',
};

/**
 * The taxonomy, as the two levels it is actually read in: each type followed by
 * the subtypes that belong to it. A subtype is stored with its type as
 * `parentValueId`, so choosing "Sale" offers only the three ways of selling and
 * a Sale voucher cannot be filed under a purchase subtype.
 *
 * The order here is the order shown — deliberate, not alphabetical.
 */
const TXN_TAXONOMY: { type: string; subtypes: string[] }[] = [
  { type: 'Opening Stock', subtypes: ['Opening Stock'] },
  { type: 'Production', subtypes: ['Internal Production'] },
  { type: 'Stock Transfer', subtypes: ['Intercompany Transfer'] },
  // No B2C purchase: the company buys from businesses, and a purchase from a
  // consumer is not a thing this business does.
  { type: 'Purchase', subtypes: ['Intercompany Purchase', 'B2B Purchase'] },
  { type: 'Sale', subtypes: ['Intercompany Sale', 'B2B Sale', 'B2C Sale'] },
  {
    type: 'Purchase Return',
    subtypes: ['Intercompany Purchase Return', 'B2B Purchase Return'],
  },
  {
    type: 'Sale Return',
    subtypes: [
      'Intercompany Sale Return',
      'B2B Sale Return',
      'B2C Sale Return',
    ],
  },
  { type: 'Material Issue', subtypes: ['Consumption'] },
  { type: 'Adjustment', subtypes: ['Missing'] },
];

/**
 * Taxonomy values that were shipped and are no longer offered. Deactivated
 * rather than deleted, and on every boot: a voucher or a document already filed
 * under one still has to read back as what it says, and the id it stored is not
 * ours to take away. Nothing offers an inactive value, and the posting rules
 * refuse one, so it leaves by being unusable rather than by vanishing.
 */
const RETIRED_TXN_SUBTYPES = ['B2C Purchase'];

/** Document code → its transaction type + subtype (lookup value strings). */
const DOC_TXN_MAP: Record<string, { type: string; subtype: string }> = {
  OPENING_STOCK: { type: 'Opening Stock', subtype: 'Opening Stock' },
  PRODUCT_TRANSFER: { type: 'Production', subtype: 'Internal Production' },
  STOCK_TRANSFER: { type: 'Stock Transfer', subtype: 'Intercompany Transfer' },
  GOODS_RECEIPT_NOTE: { type: 'Purchase', subtype: 'Intercompany Purchase' },
  DELIVERY_NOTE: { type: 'Sale', subtype: 'Intercompany Sale' },
  PURCHASE_RETURN: {
    type: 'Purchase Return',
    subtype: 'Intercompany Purchase Return',
  },
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
      await this.prisma.document.updateMany({
        where: { code: { in: RETIRED_DOCUMENTS }, isActive: true },
        data: { isActive: false },
      });
      await this.seedTransactionLookups();
    } catch (e) {
      this.logger.error(
        `Seeding system documents failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Seed the Transaction Type / Subtype lookups + their values, then link each
   * system document to its type + subtype. The document link is set only when
   * unset, so an admin's later choice is preserved.
   *
   * Each subtype is planted UNDER its type (`parentValueId`), which is what lets
   * a form offer only the subtypes belonging to the type in hand.
   */
  private async seedTransactionLookups(): Promise<void> {
    // Both lookups began life owned by Inventory. Rename in place rather than
    // create afresh: documents point at their VALUES by id, and a second pair
    // would leave those pointing at a list nothing maintains.
    const claim = async (l: {
      code: string;
      name: string;
      legacyCode: string;
    }) => {
      const [legacy, current] = await Promise.all([
        this.prisma.lookup.findUnique({
          where: { code: l.legacyCode },
          select: { id: true, _count: { select: { values: true } } },
        }),
        this.prisma.lookup.findUnique({
          where: { code: l.code },
          select: { id: true, _count: { select: { values: true } } },
        }),
      ]);

      if (legacy) {
        // Both codes present: an empty row under the new code is the residue of
        // a half-finished rename, and the legacy one still holds the values and
        // every document pointing at them. Clear the empty one out of the way so
        // the rename can go through — `code` is unique. An occupied one is not
        // ours to touch, so say so rather than guess.
        if (current && current.id !== legacy.id) {
          if (current._count.values > 0) {
            this.logger.error(
              `Cannot rename ${l.legacyCode} to ${l.code}: a different lookup already uses that code and has values.`,
            );
            return current;
          }
          await this.prisma.lookup.delete({ where: { id: current.id } });
        }
        return this.prisma.lookup.update({
          where: { id: legacy.id },
          data: { code: l.code, name: l.name, moduleId: null, isSystem: true },
        });
      }

      return this.prisma.lookup.upsert({
        where: { code: l.code },
        create: { code: l.code, name: l.name, moduleId: null, isSystem: true },
        update: { name: l.name, moduleId: null, isSystem: true },
      });
    };
    const typeLookup = await claim(TXN_TYPE_LOOKUP);
    const subtypeLookup = await claim(TXN_SUBTYPE_LOOKUP);

    // Declare the pairing on the lookups themselves, not just on the values.
    // That is what makes the rule hold for values added later by hand: the
    // Lookups screen asks which type a new subtype sits under, and the API
    // refuses one that names none.
    await this.prisma.lookup.update({
      where: { id: subtypeLookup.id },
      data: { parentLookupId: typeLookup.id },
    });

    const upsertValue = async (
      lookupId: number,
      value: string,
      sortOrder: number,
      parentValueId: number | null,
    ) => {
      const v = await this.prisma.lookupValue.upsert({
        where: { lookupId_value: { lookupId, value } },
        create: { lookupId, value, label: value, sortOrder, parentValueId },
        update: { label: value, sortOrder, parentValueId },
      });
      return v.id;
    };

    const typeMap = new Map<string, number>();
    const subtypeMap = new Map<string, number>();
    let t = 0;
    let s = 0;
    for (const entry of TXN_TAXONOMY) {
      const typeId = await upsertValue(typeLookup.id, entry.type, t++, null);
      typeMap.set(entry.type, typeId);
      for (const sub of entry.subtypes) {
        subtypeMap.set(
          sub,
          await upsertValue(subtypeLookup.id, sub, s++, typeId),
        );
      }
    }

    await this.prisma.lookupValue.updateMany({
      where: {
        lookupId: subtypeLookup.id,
        value: { in: RETIRED_TXN_SUBTYPES },
        isActive: true,
      },
      data: { isActive: false },
    });

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
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A document with code "${code}" already exists.`,
        );
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
          dto.description !== undefined
            ? dto.description?.trim() || null
            : undefined,
        transactionTypeId:
          dto.transactionTypeId !== undefined
            ? dto.transactionTypeId
            : undefined,
        transactionSubtypeId:
          dto.transactionSubtypeId !== undefined
            ? dto.transactionSubtypeId
            : undefined,
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
