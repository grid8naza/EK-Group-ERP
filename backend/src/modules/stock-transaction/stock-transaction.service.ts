import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  BATCH_NUMBERING,
  BatchNumberingPort,
} from '../../contracts/batch-numbering.port';
import { assertUnlocked } from '../../common/assert-unlocked';
import { assertBatchesFree } from '../../common/assert-batches-free';
import { maxBatchSeq } from '../../common/max-batch-seq';
import { withNumberRetry } from '../../common/with-number-retry';
import { STOCK, StockPort } from '../../contracts/stock.port';
import {
  DispatchPosting,
  MaterialIssuePosting,
  PackingPosting,
  ProducedBatch,
  ProductionReceiptPosting,
} from '../../contracts/stock-posting.port';
import {
  DISPATCH,
  DispatchPort,
  IncomingDispatch,
} from '../../contracts/dispatch.port';
import {
  CreateStockTransactionDto,
  StockTransactionLineInput,
  UpdateStockTransactionDto,
} from './stock-transaction.dto';

/** The transaction types the Inventory Transactions menu drives. */
export const TXN_TYPES = [
  'PURCHASE',
  'SALE',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'CONSUMPTION',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

/** Per-type config: numbering document code + built-in fallback prefix. The
 *  documentCode also links a type to its Document Master transaction type/subtype. */
const TXN_CONFIG: Record<TxnType, { documentCode: string; prefix: string }> = {
  PURCHASE: { documentCode: 'GOODS_RECEIPT_NOTE', prefix: 'GRN' },
  SALE: { documentCode: 'DELIVERY_NOTE', prefix: 'DN' },
  SALES_RETURN: { documentCode: 'SALES_RETURN', prefix: 'SRN' },
  PURCHASE_RETURN: { documentCode: 'PURCHASE_RETURN', prefix: 'PRN' },
  CONSUMPTION: { documentCode: 'GOODS_ISSUE_NOTE', prefix: 'GIN' },
};

/**
 * IN types add stock (create a batch); OUT types remove it. Sales Return is a
 * customer returning goods back into stock (IN); Purchase Return sends goods
 * back to the supplier (OUT).
 */
const isInbound = (type: TxnType): boolean =>
  type === 'PURCHASE' || type === 'SALES_RETURN';

/** Item/product classification denormalized onto each ledger line. */
interface LineClass {
  categoryId: number | null;
  primaryGroupId: number | null;
  parentGroupId: number | null;
  unitId: number;
}

@Injectable()
export class StockTransactionService {
  constructor(
    private prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    @Inject(BATCH_NUMBERING) private readonly batchNumbering: BatchNumberingPort,
    // Batches are regenerated on every edit and dropped on delete, so this
    // service must ask whether anything is holding them first.
    @Inject(STOCK) private readonly stock: StockPort,
    // A Goods Receipt Note can receive an intercompany dispatch; CRM owns that
    // row, so it is read and closed through the port.
    @Inject(DISPATCH) private readonly dispatch: DispatchPort,
  ) {}

  /** Batch numbers from the configured rule, or null to fall back to the
   *  built-in `CompanyCode-YYMMDD-####` scheme. One per line, in order. */
  private ruleBatchNumbers(
    companyId: number,
    branchId: number | null,
    count: number,
    date: Date,
  ): Promise<string[] | null> {
    return this.batchNumbering.nextRange(companyId, branchId, count, date);
  }

  /**
   * Bank produced finished goods into stock — the PRODUCTION stock-in. One new
   * batch per line and a qtyIn ledger row at the given store, reusing this
   * module's classify / batch-numbering / snapshot logic. Prices are snapshotted
   * from the product master so the batch can be sold at its current price.
   *
   * Called through the STOCK_POSTING port by the Production module. Atomic.
   */
  async postProductionReceipt(
    input: ProductionReceiptPosting,
  ): Promise<ProducedBatch[]> {
    const { companyId, branchId, storeId, documentId, documentNo, date, lines } =
      input;
    if (!lines.length) return [];

    const docDate = new Date(date);
    const companyCode = await this.companyCode(companyId);
    const ymd = this.ymd(date);
    const ruleBatchNos = await this.ruleBatchNumbers(
      companyId,
      branchId,
      lines.length,
      docDate,
    );
    // Fallback sequence continues after today's existing batches for the company.
    const base = await maxBatchSeq(
      this.prisma,
      companyId,
      `${companyCode}-${ymd}-`,
    );

    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        categoryId: true,
        groupId: true,
        unitId: true,
        shelfLife: true,
        costPrice: true,
        intercompanyPrice: true,
        wholesalePrice: true,
        retailPrice: true,
      },
    });
    const prodById = new Map(products.map((p) => [p.id, p]));

    return this.prisma.$transaction(async (tx) => {
      const out: ProducedBatch[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const p = prodById.get(line.productId);
        if (!p) throw new BadRequestException('Product not found.');
        const primaryGroupId = await this.primaryGroup(p.groupId);
        // Expiry: explicit, else derived from the product's shelf life (days).
        const expiry = line.expiryDate
          ? new Date(line.expiryDate)
          : p.shelfLife > 0
            ? new Date(docDate.getTime() + p.shelfLife * 86400000)
            : null;
        const batchNo1 =
          ruleBatchNos?.[i] ??
          `${companyCode}-${ymd}-${String(base + i + 1).padStart(4, '0')}`;

        const batch = await tx.stockBatch.create({
          data: {
            companyId,
            batchNo1,
            productId: line.productId,
            expiryDate: expiry,
          },
        });
        await tx.stockLedger.create({
          data: {
            date: docDate,
            companyId,
            branchId,
            storeId,
            transactionType: StockTxnType.PRODUCTION,
            documentId,
            documentNo,
            categoryId: p.categoryId,
            primaryGroupId,
            parentGroupId: p.groupId,
            productId: line.productId,
            batchId: batch.id,
            batchNo1,
            expiryDate: expiry,
            qtyIn: line.quantity,
            qtyOut: 0,
            unitId: p.unitId,
            unitPrice: p.costPrice,
            costPrice: p.costPrice,
            intercompanyPrice: p.intercompanyPrice,
            wholesalePrice: p.wholesalePrice,
            retailPrice: p.retailPrice,
          },
        });
        out.push({
          productId: line.productId,
          batchId: batch.id,
          batchNo: batchNo1,
          quantity: line.quantity,
          unitId: p.unitId,
          expiryDate: expiry ? expiry.toISOString() : null,
        });
      }
      return out;
    });
  }

  /**
   * Post a packing operation: consume the unpacked source products and packing
   * materials (stock-out, availability-checked), then produce the packed
   * products as new batches (stock-in). Atomic.
   */
  async postPacking(input: PackingPosting): Promise<ProducedBatch[]> {
    const {
      companyId,
      branchId,
      storeId,
      documentId,
      documentNo,
      date,
      produce,
      consumeProducts,
      consumeItems,
    } = input;
    if (!produce.length) return [];

    const docDate = new Date(date);
    const companyCode = await this.companyCode(companyId);
    const ymd = this.ymd(date);
    const ruleBatchNos = await this.ruleBatchNumbers(
      companyId,
      branchId,
      produce.length,
      docDate,
    );
    const base = await maxBatchSeq(
      this.prisma,
      companyId,
      `${companyCode}-${ymd}-`,
    );
    const productIds = [...new Set(produce.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        categoryId: true,
        groupId: true,
        unitId: true,
        shelfLife: true,
        costPrice: true,
        intercompanyPrice: true,
        wholesalePrice: true,
        retailPrice: true,
      },
    });
    const prodById = new Map(products.map((p) => [p.id, p]));

    return this.prisma.$transaction(async (tx) => {
      // CONSUME the unpacked source products and packing materials.
      for (const c of consumeProducts) {
        await this.consumeStock(tx, {
          companyId,
          branchId,
          storeId,
          documentId,
          documentNo,
          docDate,
          productId: c.productId,
          itemId: null,
          quantity: c.quantity,
        });
      }
      for (const c of consumeItems) {
        await this.consumeStock(tx, {
          companyId,
          branchId,
          storeId,
          documentId,
          documentNo,
          docDate,
          productId: null,
          itemId: c.itemId,
          quantity: c.quantity,
        });
      }

      // PRODUCE the packed products (new batch each).
      const out: ProducedBatch[] = [];
      for (let i = 0; i < produce.length; i++) {
        const line = produce[i];
        const p = prodById.get(line.productId);
        if (!p) throw new BadRequestException('Product not found.');
        const primaryGroupId = await this.primaryGroup(p.groupId);
        const expiry = line.expiryDate
          ? new Date(line.expiryDate)
          : p.shelfLife > 0
            ? new Date(docDate.getTime() + p.shelfLife * 86400000)
            : null;
        const batchNo1 =
          ruleBatchNos?.[i] ??
          `${companyCode}-${ymd}-${String(base + i + 1).padStart(4, '0')}`;
        const batch = await tx.stockBatch.create({
          data: {
            companyId,
            batchNo1,
            productId: line.productId,
            expiryDate: expiry,
          },
        });
        await tx.stockLedger.create({
          data: {
            date: docDate,
            companyId,
            branchId,
            storeId,
            transactionType: StockTxnType.PRODUCTION,
            documentId,
            documentNo,
            categoryId: p.categoryId,
            primaryGroupId,
            parentGroupId: p.groupId,
            productId: line.productId,
            batchId: batch.id,
            batchNo1,
            expiryDate: expiry,
            qtyIn: line.quantity,
            qtyOut: 0,
            unitId: p.unitId,
            unitPrice: p.costPrice,
            costPrice: p.costPrice,
            intercompanyPrice: p.intercompanyPrice,
            wholesalePrice: p.wholesalePrice,
            retailPrice: p.retailPrice,
          },
        });
        out.push({
          productId: line.productId,
          batchId: batch.id,
          batchNo: batchNo1,
          quantity: line.quantity,
          unitId: p.unitId,
          expiryDate: expiry ? expiry.toISOString() : null,
        });
      }
      return out;
    });
  }

  /**
   * Issue raw materials to production — a CONSUMPTION stock-out per item at the
   * issuing store, availability-checked. Atomic: a store either hands over the
   * whole requisition or none of it.
   */
  async postMaterialIssue(input: MaterialIssuePosting): Promise<void> {
    const { companyId, branchId, storeId, documentId, documentNo, date, lines } =
      input;
    if (!lines.length) return;
    const docDate = new Date(date);
    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        await this.consumeStock(tx, {
          companyId,
          branchId,
          storeId,
          documentId,
          documentNo,
          docDate,
          productId: null,
          itemId: l.itemId,
          quantity: l.quantity,
          action: 'issue',
        });
      }
    });
  }

  /**
   * Ship goods out on a dispatch — a SALE stock-out per product at the source
   * store, availability-checked. Atomic.
   */
  async postDispatch(input: DispatchPosting): Promise<void> {
    const { companyId, branchId, storeId, documentId, documentNo, date, lines } =
      input;
    if (!lines.length) return;
    const docDate = new Date(date);
    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        await this.consumeStock(tx, {
          companyId,
          branchId,
          storeId,
          documentId,
          documentNo,
          docDate,
          productId: l.productId,
          itemId: null,
          quantity: l.quantity,
          txnType: StockTxnType.SALE,
        });
      }
    });
  }

  /** Post one stock-out line (CONSUMPTION by default), availability-checked. */
  private async consumeStock(
    tx: Prisma.TransactionClient,
    o: {
      companyId: number;
      branchId: number | null;
      storeId: number;
      documentId: number;
      documentNo: string;
      docDate: Date;
      productId: number | null;
      itemId: number | null;
      quantity: number;
      txnType?: StockTxnType;
      /** Verb for the short-stock message ("ship" by default). */
      action?: string;
    },
  ): Promise<void> {
    if (o.quantity <= 0) return;
    const cls = await this.classify(o.itemId, o.productId);
    const avail = await this.availableStock(
      tx,
      o.companyId,
      o.storeId,
      o.itemId,
      o.productId,
    );
    if (o.quantity > avail) {
      // Name the stockable — a bare quantity says nothing when a document moves
      // a dozen of them. Only on the failure path.
      const named = await this.stockableName(o.itemId, o.productId);
      throw new BadRequestException(
        `Insufficient stock to ${o.action ?? 'ship'}${named ? ` ${named}` : ''}: ` +
          `${avail} available, ${o.quantity} needed.`,
      );
    }
    await tx.stockLedger.create({
      data: {
        date: o.docDate,
        companyId: o.companyId,
        branchId: o.branchId,
        storeId: o.storeId,
        transactionType: o.txnType ?? StockTxnType.CONSUMPTION,
        documentId: o.documentId,
        documentNo: o.documentNo,
        categoryId: cls.categoryId,
        primaryGroupId: cls.primaryGroupId,
        parentGroupId: cls.parentGroupId,
        itemId: o.itemId,
        productId: o.productId,
        qtyIn: 0,
        qtyOut: o.quantity,
        unitId: cls.unitId,
      },
    });
  }

  // ---- reads ----

  async findOne(id: number) {
    const header = await this.prisma.stockTransaction.findUnique({
      where: { id },
    });
    if (!header) throw new NotFoundException('Stock transaction not found');
    const lines = await this.prisma.stockLedger.findMany({
      where: { transactionType: header.type, documentId: id },
      orderBy: { id: 'asc' },
    });
    return { ...header, lines };
  }

  /** Flat, enriched ledger lines for one transaction type (the listing grid). */
  async lines(
    companyId: number | undefined,
    branchId: number | undefined,
    type: TxnType,
  ) {
    const filtered = await this.prisma.stockLedger.findMany({
      where: {
        transactionType: type as StockTxnType,
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { id: 'desc' },
    });

    const uniq = <T>(xs: (T | null | undefined)[]) =>
      [...new Set(xs.filter((x): x is T => x != null))];
    const itemIds = uniq(filtered.map((r) => r.itemId));
    const productIds = uniq(filtered.map((r) => r.productId));
    const catIds = uniq(filtered.map((r) => r.categoryId));
    const groupIds = uniq([
      ...filtered.map((r) => r.primaryGroupId),
      ...filtered.map((r) => r.parentGroupId),
    ]);
    const unitIds = uniq(filtered.map((r) => r.unitId));
    const storeIds = uniq(filtered.map((r) => r.storeId));
    const docIds = uniq(filtered.map((r) => r.documentId));

    const [its, prs, cats, grps, uns, sts, docs] = await Promise.all([
      itemIds.length
        ? this.prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } })
        : [],
      productIds.length
        ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
        : [],
      catIds.length
        ? this.prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
        : [],
      groupIds.length
        ? this.prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } })
        : [],
      unitIds.length
        ? this.prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, symbol: true, code: true } })
        : [],
      storeIds.length
        ? this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
        : [],
      docIds.length
        ? this.prisma.stockTransaction.findMany({ where: { id: { in: docIds } }, select: { id: true, isLocked: true } })
        : [],
    ]);

    const itemMap = new Map(its.map((x) => [x.id, x.name] as const));
    const prodMap = new Map(prs.map((x) => [x.id, x.name] as const));
    const catMap = new Map(cats.map((x) => [x.id, x.name] as const));
    const grpMap = new Map(grps.map((x) => [x.id, x.name] as const));
    const unitMap = new Map(uns.map((x) => [x.id, x.symbol ?? x.code] as const));
    const storeMap = new Map(sts.map((x) => [x.id, x.name] as const));
    const lockMap = new Map(docs.map((x) => [x.id, x.isLocked] as const));

    const inbound = isInbound(type);
    return filtered.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      docNo: r.documentNo,
      docDate: r.date,
      storeId: r.storeId,
      storeName: storeMap.get(r.storeId) ?? '',
      itemId: r.itemId,
      productId: r.productId,
      name: r.itemId
        ? itemMap.get(r.itemId) ?? ''
        : r.productId
          ? prodMap.get(r.productId) ?? ''
          : '',
      categoryId: r.categoryId,
      categoryName: r.categoryId ? catMap.get(r.categoryId) ?? null : null,
      primaryGroupId: r.primaryGroupId,
      primaryGroupName: r.primaryGroupId ? grpMap.get(r.primaryGroupId) ?? null : null,
      parentGroupId: r.parentGroupId,
      parentGroupName: r.parentGroupId ? grpMap.get(r.parentGroupId) ?? null : null,
      batchNo1: r.batchNo1,
      batchNo2: r.batchNo2,
      expiryDate: r.expiryDate,
      qtyIn: r.qtyIn,
      qtyOut: r.qtyOut,
      qty: inbound ? r.qtyIn : r.qtyOut,
      unitId: r.unitId,
      unitSymbol: unitMap.get(r.unitId) ?? '',
      unitPrice: r.unitPrice,
      isLocked: lockMap.get(r.documentId) ?? false,
    }));
  }

  /** One row per DOCUMENT (header listing): date, doc no, company, branch,
   *  store, reference, total amount (sum qty × rate), lock. */
  async documents(
    companyId: number | undefined,
    branchId: number | undefined,
    type: TxnType,
  ) {
    const headers = await this.prisma.stockTransaction.findMany({
      where: {
        type: type as StockTxnType,
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { id: 'desc' },
    });
    const ids = headers.map((h) => h.id);
    const ledger = ids.length
      ? await this.prisma.stockLedger.findMany({
          where: { transactionType: type as StockTxnType, documentId: { in: ids } },
          select: { documentId: true, qtyIn: true, qtyOut: true, unitPrice: true },
        })
      : [];
    const amountByDoc = new Map<number, number>();
    for (const r of ledger) {
      amountByDoc.set(
        r.documentId,
        (amountByDoc.get(r.documentId) ?? 0) +
          (r.qtyIn + r.qtyOut) * (r.unitPrice ?? 0),
      );
    }

    const uniq = <T>(xs: (T | null | undefined)[]) =>
      [...new Set(xs.filter((x): x is T => x != null))];
    const companyIds = uniq(headers.map((h) => h.companyId));
    const branchIds = uniq(headers.map((h) => h.branchId));
    const storeIds = uniq(headers.map((h) => h.storeId));
    const [companies, branches, stores] = await Promise.all([
      companyIds.length
        ? this.prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
        : [],
      branchIds.length
        ? this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
        : [],
      storeIds.length
        ? this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const companyMap = new Map(companies.map((x) => [x.id, x.name] as const));
    const branchMap = new Map(branches.map((x) => [x.id, x.name] as const));
    const storeMap = new Map(stores.map((x) => [x.id, x.name] as const));

    // Transaction type/subtype from this note's Document Master entry (same for
    // every row in the listing).
    const docMaster = await this.prisma.document.findUnique({
      where: { code: TXN_CONFIG[type].documentCode },
      select: {
        transactionType: { select: { label: true } },
        transactionSubtype: { select: { label: true } },
      },
    });
    const txnType = docMaster?.transactionType?.label ?? null;
    const txnSubtype = docMaster?.transactionSubtype?.label ?? null;

    return headers.map((h) => ({
      id: h.id,
      docNo: h.docNo,
      docDate: h.docDate,
      companyId: h.companyId,
      companyName: companyMap.get(h.companyId) ?? '',
      branchId: h.branchId,
      branchName: h.branchId ? branchMap.get(h.branchId) ?? null : null,
      storeId: h.storeId,
      storeName: storeMap.get(h.storeId) ?? '',
      reference: h.reference,
      amount: amountByDoc.get(h.id) ?? 0,
      transactionType: txnType,
      transactionSubtype: txnSubtype,
      isLocked: h.isLocked,
    }));
  }

  // ---- writes ----

  async create(
    companyId: number | undefined,
    branchId: number | undefined,
    type: TxnType,
    dto: CreateStockTransactionDto,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before entering a transaction.');
    }
    const companyCode = await this.companyCode(companyId);
    // Company + branch scoped: with an active branch, the store must belong to
    // it — you can only transact against your own branch's stores.
    const store = await this.prisma.store.findFirst({
      where: { id: dto.storeId, companyId, ...(branchId ? { branchId } : {}) },
    });
    if (!store) {
      throw new BadRequestException('Choose a valid store for this branch.');
    }
    const txnBranchId = store.branchId ?? branchId ?? null;

    // Receiving an intercompany shipment: the dispatch dictates what may be
    // received, and closes once the goods are banked.
    const incoming =
      type === 'PURCHASE' && dto.dispatchId
        ? await this.assertReceivable(dto.dispatchId, companyId, dto.lines)
        : null;

    const resolved = await this.resolveLines(dto.lines);
    const docDate = new Date(dto.docDate);
    const ymd = this.ymd(dto.docDate);
    // Only IN types create batches → only they need rule batch numbers.
    const ruleBatchNos = isInbound(type)
      ? await this.ruleBatchNumbers(companyId, txnBranchId, dto.lines.length, docDate)
      : null;

    // The document number is derived, so an entry posted at the same instant can
    // take it; retry with the next one rather than failing the post.
    const header = await withNumberRetry(
      (attempt) => this.nextDocNo(companyId, type, docDate, attempt),
      (docNo) =>
        this.prisma.$transaction(async (tx) => {
          const base = await maxBatchSeq(tx, companyId, `${companyCode}-${ymd}-`);
          const created = await tx.stockTransaction.create({
            data: {
              companyId,
              branchId: txnBranchId,
              type: type as StockTxnType,
              docNo,
              docDate,
              storeId: dto.storeId,
              // Supplier + PO apply to Goods Receipt only.
              supplierId: type === 'PURCHASE' ? dto.supplierId ?? null : null,
              purchaseOrderRef:
                type === 'PURCHASE'
                  ? dto.purchaseOrderRef?.trim() || null
                  : null,
              dispatchId: incoming?.id ?? null,
              dispatchNo: incoming?.dispatchNo ?? null,
              reference: dto.reference?.trim() || null,
              notes: dto.notes?.trim() || null,
              status: 'POSTED',
            },
          });
          await this.writeLines(tx, {
            type,
            header: created,
            companyId,
            branchId: txnBranchId,
            storeId: dto.storeId,
            docDate,
            docNo,
            reference: dto.reference?.trim() || null,
            companyCode,
            ymd,
            base,
            ruleBatchNos,
            lines: dto.lines,
            resolved,
          });
          return created;
        }),
    );

    // The goods are in stock — close the shipment. If CRM refuses, the receipt
    // must not survive as an unlinked stock-in.
    if (incoming) {
      try {
        await this.dispatch.markReceived(incoming.id);
      } catch (e) {
        await this.remove(header.id);
        throw e;
      }
    }
    return header;
  }

  async update(
    id: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: UpdateStockTransactionDto,
  ) {
    const existing = await this.prisma.stockTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Stock transaction not found');
    assertUnlocked(existing, 'stock transaction', 'editing');
    const effCompany = existing.companyId;
    const companyCode = await this.companyCode(effCompany);

    const storeId = dto.storeId ?? existing.storeId;
    // The edited document stays in its own branch — the (new) store must belong
    // to it (companies without branches are unconstrained).
    const store = await this.prisma.store.findFirst({
      where: {
        id: storeId,
        companyId: effCompany,
        ...(existing.branchId ? { branchId: existing.branchId } : {}),
      },
    });
    if (!store) {
      throw new BadRequestException('Choose a valid store for this branch.');
    }
    const txnBranchId = store.branchId ?? existing.branchId ?? null;

    // A receipt against a dispatch stays bounded by it, however it is re-edited.
    if (dto.lines && existing.dispatchId) {
      await this.assertReceivable(existing.dispatchId, effCompany, dto.lines, true);
    }

    const docDate = dto.docDate ? new Date(dto.docDate) : existing.docDate;
    const ymd = this.ymd(docDate.toISOString());
    const resolved = dto.lines ? await this.resolveLines(dto.lines) : null;
    const ruleBatchNos =
      dto.lines && isInbound(existing.type as TxnType)
        ? await this.ruleBatchNumbers(effCompany, txnBranchId, dto.lines.length, docDate)
        : null;

    return this.prisma.$transaction(async (tx) => {
      const isGrn = existing.type === 'PURCHASE';
      await tx.stockTransaction.update({
        where: { id },
        data: {
          storeId,
          branchId: txnBranchId,
          docDate,
          supplierId:
            isGrn && dto.supplierId !== undefined ? dto.supplierId : undefined,
          purchaseOrderRef:
            isGrn && dto.purchaseOrderRef !== undefined
              ? dto.purchaseOrderRef?.trim() || null
              : undefined,
          reference:
            dto.reference !== undefined ? dto.reference?.trim() || null : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        },
      });

      if (dto.lines && resolved) {
        // Replace lines + their batches (batch numbers are regenerated).
        const old = await tx.stockLedger.findMany({
          where: { transactionType: existing.type, documentId: id },
          select: { batchId: true },
        });
        const batchIds = old
          .map((l) => l.batchId)
          .filter((b): b is number => b != null);
        // The batches below are about to be regenerated. A reservation names a
        // batch by id, so destroying one strands the hold and silently sterilises
        // the stock — refuse instead, and let the reservation be dealt with.
        await assertBatchesFree(this.stock, batchIds, 'document', 'editing');
        await tx.stockLedger.deleteMany({
          where: { transactionType: existing.type, documentId: id },
        });
        if (batchIds.length) {
          await tx.stockBatch.deleteMany({ where: { id: { in: batchIds } } });
        }
        const base = await maxBatchSeq(
          tx,
          effCompany,
          `${companyCode}-${ymd}-`,
        );
        await this.writeLines(tx, {
          type: existing.type as TxnType,
          header: existing,
          companyId: effCompany,
          branchId: txnBranchId,
          storeId,
          docDate,
          docNo: existing.docNo,
          reference: dto.reference?.trim() ?? existing.reference ?? null,
          companyCode,
          ymd,
          base,
          ruleBatchNos,
          lines: dto.lines,
          resolved,
        });
      }
      return this.findOne(id);
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.stockTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Stock transaction not found');
    assertUnlocked(existing, 'stock transaction', 'deleting');
    await this.prisma.$transaction(async (tx) => {
      const old = await tx.stockLedger.findMany({
        where: { transactionType: existing.type, documentId: id },
        select: { batchId: true },
      });
      const batchIds = old
        .map((l) => l.batchId)
        .filter((b): b is number => b != null);
      // Deleting takes the batches with it — see the guard in update().
      await assertBatchesFree(this.stock, batchIds, 'document', 'deleting');
      await tx.stockLedger.deleteMany({
        where: { transactionType: existing.type, documentId: id },
      });
      if (batchIds.length) {
        await tx.stockBatch.deleteMany({ where: { id: { in: batchIds } } });
      }
      await tx.stockTransaction.delete({ where: { id } });
    });
    // The shipment was never received after all — hand it back to the buyer's
    // incoming list.
    if (existing.dispatchId) {
      await this.dispatch.markDispatched(existing.dispatchId);
    }
    return { success: true };
  }

  async setLock(id: number, locked: boolean) {
    const existing = await this.prisma.stockTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Stock transaction not found');
    return this.prisma.stockTransaction.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  // ---- incoming intercompany shipments ----

  /**
   * Dispatches shipped to this company that are still awaiting receipt, each
   * line carrying the shipped batch's expiry — the goods are physically the same
   * batch, so the buyer's own batch must expire on the same day or FEFO would
   * treat freshly-received stock as ageless.
   */
  async incomingDispatches(
    companyId: number | undefined,
    branchId: number | undefined,
  ): Promise<(IncomingDispatch & { lines: { expiryDate: string | null }[] })[]> {
    if (!companyId) return [];
    const dispatches = await this.dispatch.incomingFor(
      companyId,
      branchId ?? null,
    );
    const batchIds = [
      ...new Set(
        dispatches.flatMap((d) =>
          d.lines.map((l) => l.batchId).filter((b): b is number => b != null),
        ),
      ),
    ];
    const batches = batchIds.length
      ? await this.prisma.stockBatch.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, expiryDate: true },
        })
      : [];
    const expiryById = new Map(batches.map((b) => [b.id, b.expiryDate]));
    return dispatches.map((d) => ({
      ...d,
      lines: d.lines.map((l) => ({
        ...l,
        expiryDate:
          (l.batchId ? expiryById.get(l.batchId) : null)?.toISOString() ?? null,
      })),
    }));
  }

  /**
   * Guard a goods receipt raised against an intercompany dispatch: it must be
   * addressed to this company, still open, and receive only products it shipped
   * — never more than was shipped. Accepting LESS is allowed and expected: that
   * is the short/damaged case, and the difference simply never enters stock.
   */
  private async assertReceivable(
    dispatchId: number,
    companyId: number,
    lines: StockTransactionLineInput[],
    reopening = false,
  ): Promise<IncomingDispatch> {
    const incoming = await this.dispatch.findIncoming(dispatchId, companyId);
    if (!incoming) {
      throw new BadRequestException('That dispatch was not shipped to this company.');
    }
    // On a re-edit the dispatch is already closed by this very receipt.
    if (incoming.received && !reopening) {
      throw new BadRequestException(
        `Dispatch ${incoming.dispatchNo} has already been received.`,
      );
    }
    // A product ships once per batch, so it can appear on several lines — the
    // ceiling is what was shipped in TOTAL.
    const shippedByProduct = new Map<number, number>();
    for (const l of incoming.lines) {
      shippedByProduct.set(
        l.productId,
        (shippedByProduct.get(l.productId) ?? 0) + l.quantity,
      );
    }
    // Accepted quantity is per PRODUCT, not per line — a product split across
    // two lines must still not add up to more than arrived.
    const accepted = new Map<number, number>();
    for (const line of lines) {
      if (line.itemId || !line.productId) {
        throw new BadRequestException(
          'A dispatch receipt can only receive the products that were shipped.',
        );
      }
      if (!shippedByProduct.has(line.productId)) {
        throw new BadRequestException(
          `Dispatch ${incoming.dispatchNo} did not ship that product.`,
        );
      }
      accepted.set(
        line.productId,
        (accepted.get(line.productId) ?? 0) + line.quantity,
      );
    }
    for (const [productId, qty] of accepted) {
      const shipped = shippedByProduct.get(productId) ?? 0;
      if (qty > shipped) {
        const name =
          incoming.lines.find((l) => l.productId === productId)?.productName ??
          `#${productId}`;
        throw new BadRequestException(
          `Cannot accept ${qty} of ${name} — only ${shipped} was dispatched.`,
        );
      }
    }
    return incoming;
  }

  // ---- helpers ----

  /** Create the batch (IN) or validate availability (OUT) + ledger row per line. */
  private async writeLines(
    tx: Prisma.TransactionClient,
    ctx: {
      type: TxnType;
      header: { id: number };
      companyId: number;
      branchId: number | null;
      storeId: number;
      docDate: Date;
      docNo: string;
      reference: string | null;
      companyCode: string;
      ymd: string;
      base: number;
      ruleBatchNos: string[] | null;
      lines: StockTransactionLineInput[];
      resolved: LineClass[];
    },
  ) {
    const inbound = isInbound(ctx.type);
    let batchSeq = 0;
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const cls = ctx.resolved[i];
      const expiry = line.expiryDate ? new Date(line.expiryDate) : null;

      let batchId: number | null = null;
      let batchNo1: string | null = null;
      if (inbound) {
        batchSeq += 1;
        // Use the company/branch batch-numbering rule when configured; else fall
        // back to the built-in CompanyCode-YYMMDD-#### scheme.
        batchNo1 =
          ctx.ruleBatchNos?.[batchSeq - 1] ??
          `${ctx.companyCode}-${ctx.ymd}-${String(ctx.base + batchSeq).padStart(4, '0')}`;
        const batch = await tx.stockBatch.create({
          data: {
            companyId: ctx.companyId,
            batchNo1,
            batchNo2: line.batchNo2?.trim() || null,
            itemId: line.itemId ?? null,
            productId: line.productId ?? null,
            expiryDate: expiry,
          },
        });
        batchId = batch.id;
      } else {
        // OUT: never issue more than is on hand at this store (the aggregate
        // already reflects earlier lines written in this same transaction).
        const available = await this.availableStock(
          tx,
          ctx.companyId,
          ctx.storeId,
          line.itemId ?? null,
          line.productId ?? null,
        );
        if (line.quantity > available) {
          throw new BadRequestException(
            `Insufficient stock: ${available} available, ${line.quantity} requested.`,
          );
        }
      }

      await tx.stockLedger.create({
        data: {
          date: ctx.docDate,
          companyId: ctx.companyId,
          branchId: ctx.branchId,
          storeId: ctx.storeId,
          transactionType: ctx.type as StockTxnType,
          transactionSubtype: null,
          documentId: ctx.header.id,
          documentNo: ctx.docNo,
          reference: ctx.reference,
          categoryId: cls.categoryId,
          primaryGroupId: cls.primaryGroupId,
          parentGroupId: cls.parentGroupId,
          itemId: line.itemId ?? null,
          productId: line.productId ?? null,
          batchId,
          batchNo1,
          batchNo2: inbound ? line.batchNo2?.trim() || null : null,
          expiryDate: inbound ? expiry : null,
          qtyIn: inbound ? line.quantity : 0,
          qtyOut: inbound ? 0 : line.quantity,
          unitId: cls.unitId,
          unitPrice: line.unitPrice ?? 0,
        },
      });
    }
  }

  /** The item's or product's name, for a message. Empty when it can't be read. */
  private async stockableName(
    itemId: number | null,
    productId: number | null,
  ): Promise<string> {
    if (itemId) {
      const it = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: { name: true },
      });
      return it?.name ?? '';
    }
    if (productId) {
      const p = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { name: true },
      });
      return p?.name ?? '';
    }
    return '';
  }

  /** On-hand quantity for one stockable at a store (SUM qtyIn - qtyOut). */
  private async availableStock(
    tx: Prisma.TransactionClient,
    companyId: number,
    storeId: number,
    itemId: number | null,
    productId: number | null,
  ): Promise<number> {
    const agg = await tx.stockLedger.aggregate({
      where: {
        companyId,
        storeId,
        ...(itemId ? { itemId } : {}),
        ...(productId ? { productId } : {}),
      },
      _sum: { qtyIn: true, qtyOut: true },
    });
    return (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
  }

  private async resolveLines(
    lines: StockTransactionLineInput[],
  ): Promise<LineClass[]> {
    const out: LineClass[] = [];
    for (const l of lines) {
      if (!l.itemId && !l.productId) {
        throw new BadRequestException('Each line must have an item or a product.');
      }
      if (l.itemId && l.productId) {
        throw new BadRequestException('A line cannot be both an item and a product.');
      }
      out.push(await this.classify(l.itemId ?? null, l.productId ?? null));
    }
    return out;
  }

  private async classify(
    itemId: number | null,
    productId: number | null,
  ): Promise<LineClass> {
    if (itemId) {
      const it = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: { categoryId: true, groupId: true, unitId: true },
      });
      if (!it) throw new BadRequestException('Item not found.');
      return {
        categoryId: it.categoryId,
        parentGroupId: it.groupId,
        primaryGroupId: await this.primaryGroup(it.groupId),
        unitId: it.unitId,
      };
    }
    const pr = await this.prisma.product.findUnique({
      where: { id: productId ?? -1 },
      select: { categoryId: true, groupId: true, unitId: true },
    });
    if (!pr) throw new BadRequestException('Product not found.');
    return {
      categoryId: pr.categoryId,
      parentGroupId: pr.groupId,
      primaryGroupId: await this.primaryGroup(pr.groupId),
      unitId: pr.unitId,
    };
  }

  /** Walk up the group chain to the level-1 (primary) group. */
  private async primaryGroup(groupId: number | null): Promise<number | null> {
    if (!groupId) return null;
    let g = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, parentGroupId: true },
    });
    while (g?.parentGroupId) {
      const p = await this.prisma.group.findUnique({
        where: { id: g.parentGroupId },
        select: { id: true, parentGroupId: true },
      });
      if (!p) break;
      g = p;
    }
    return g?.id ?? null;
  }

  private async companyCode(companyId: number): Promise<string> {
    const c = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true },
    });
    return (c?.code || 'CO').toUpperCase();
  }

  /** YYMMDD from an ISO date string (tz-safe: reads the date part directly). */
  private ymd(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${y.slice(2)}${m}${d}`;
  }

  /** Next document number: the company's numbering rule, else a built-in prefix. */
  private async nextDocNo(
    companyId: number,
    type: TxnType,
    date: Date,
    attempt = 0,
  ): Promise<string> {
    const cfg = TXN_CONFIG[type];
    return this.numbering.nextOrDefault(
      companyId,
      cfg.documentCode,
      { prefix: `${cfg.prefix}-`, padding: 5 },
      date,
      attempt,
    );
  }
}
