import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NUMBERING,
  NumberingPort,
  NumberingScope,
} from '../../contracts/numbering.port';
import {
  BATCH_NUMBERING,
  BatchNumberingPort,
} from '../../contracts/batch-numbering.port';
import { assertUnlocked } from '../../common/assert-unlocked';
import { resolveEntryRules } from '../../common/entry-rules';
import { assertBatchesFree } from '../../common/assert-batches-free';
import { maxBatchSeq } from '../../common/max-batch-seq';
import { withNumberRetry } from '../../common/with-number-retry';
import { STOCK, StockPort } from '../../contracts/stock.port';
import {
  PURCHASE_PRICE,
  PurchasePricePort,
} from '../../contracts/purchase-price.port';
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

/**
 * The tax stamped on a movement line: the rates as entered, and what each came
 * to on this line's taxable value.
 *
 * The amounts are computed HERE rather than accepted from the caller, and
 * stored rather than derived at read time. Both for the same reason: a rate on
 * the master can be corrected next month, and the tax already charged on a
 * posted bill must not silently move with it. Rounded to the paisa, so a
 * register foots to the invoice it came from.
 */
const taxOf = (line: {
  quantity: number;
  unitPrice?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
}) => {
  const taxable = line.quantity * (line.unitPrice ?? 0);
  const paisa = (rate?: number) =>
    Math.round(taxable * ((rate ?? 0) / 100) * 100) / 100;
  return {
    cgst: line.cgst ?? 0,
    sgst: line.sgst ?? 0,
    igst: line.igst ?? 0,
    cess: line.cess ?? 0,
    cgstAmount: paisa(line.cgst),
    sgstAmount: paisa(line.sgst),
    igstAmount: paisa(line.igst),
    cessAmount: paisa(line.cess),
  };
};

/** Item/product classification denormalized onto each ledger line. */
interface LineClass {
  categoryId: number | null;
  primaryGroupId: number | null;
  parentGroupId: number | null;
  unitId: number;
}

/** The costing dimensions stamped on a ledger row. */
interface LineCosting {
  costCenterId: number | null;
  costObjectId: number | null;
}

const NO_COSTING: LineCosting = { costCenterId: null, costObjectId: null };

/**
 * Which of a product's cost objects a movement belongs to. One cost centre
 * serves the whole company, so only the OBJECT varies — by what is being done,
 * not by whether stock is coming in or going out.
 */
type CostActivity =
  | 'RECIPE' // making it: production receipts, and the materials that go in
  | 'PACKING' // packing it, and the sources consumed doing so
  | 'SALE'; // shipping it out

@Injectable()
export class StockTransactionService {
  private readonly logger = new Logger(StockTransactionService.name);

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
    // What a receipt paid feeds back into the Item master, which the item
    // module owns — so it is written through the port.
    @Inject(PURCHASE_PRICE) private readonly purchasePrice: PurchasePricePort,
  ) {}

  /**
   * Feed what a Goods Receipt paid back into the Item master, raising each
   * item's last purchase price where the rate received is higher.
   *
   * This is what makes recipe and packing costs follow real purchases: those
   * BOMs hold no rates of their own, so every one of them recosts off
   * `Item.lastPurchasePrice` the moment it moves. Nothing downstream is rewritten
   * here — a cost change is surfaced for review in Production → Price Review,
   * where a human decides whether a selling price should follow. Prices are
   * never repriced automatically.
   *
   * `line.unitPrice` is already per the item's own stock unit (the document's
   * pack rate is kept separately as `enteredUnitPrice`), so it needs no
   * conversion. PURCHASE only — a return is not a purchase, and issues and
   * transfers pay nothing.
   *
   * Deliberately runs AFTER the receipt has committed, and never throws: the
   * goods are in stock either way, and a price write-back failing is no reason
   * to lose the receipt.
   */
  private async feedPurchasePrices(
    type: TxnType,
    lines: { itemId?: number | null; unitPrice?: number | null }[],
  ): Promise<void> {
    if (type !== 'PURCHASE') return;
    const paid = lines
      .filter((l) => l.itemId != null && (l.unitPrice ?? 0) > 0)
      .map((l) => ({ itemId: l.itemId as number, unitPrice: l.unitPrice as number }));
    if (!paid.length) return;
    try {
      const raised = await this.purchasePrice.raiseLastPurchasePrice(paid);
      for (const r of raised) {
        this.logger.log(
          `Last purchase price raised: ${r.itemName} ${r.from} → ${r.to}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Goods receipt posted, but the item purchase prices could not be updated: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

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
    // Banking output is the making of it, so it takes the recipe cost object.
    const costing = await this.costingFor(companyId, productIds, 'RECIPE');

    return this.prisma.$transaction(async (tx) => {
      const out: ProducedBatch[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const p = prodById.get(line.productId);
        if (!p) throw new BadRequestException('Product not found.');
        const primaryGroupId = await this.primaryGroup(p.groupId);
        const cost = costing.get(line.productId) ?? NO_COSTING;
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
            costCenterId: cost.costCenterId,
            costObjectId: cost.costObjectId,
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
   * Post a packing operation: consume the source products and packing
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
    // The whole operation is packing, so everything it moves — the packed
    // output, the unpacked sources it eats and the packing materials — is
    // traced against the PACKED product's packing cost object. The sources are
    // charged to the pack they went into, not to their own recipe object, so
    // the packing line's cost lands in one place.
    const costing = await this.costingFor(companyId, productIds, 'PACKING');
    const packCosting = costing.get(produce[0].productId) ?? NO_COSTING;

    return this.prisma.$transaction(async (tx) => {
      // CONSUME the source products and packing materials.
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
          costing: packCosting,
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
          costing: packCosting,
        });
      }

      // PRODUCE the packed products (new batch each).
      const out: ProducedBatch[] = [];
      for (let i = 0; i < produce.length; i++) {
        const line = produce[i];
        const p = prodById.get(line.productId);
        if (!p) throw new BadRequestException('Product not found.');
        const primaryGroupId = await this.primaryGroup(p.groupId);
        const cost = costing.get(line.productId) ?? NO_COSTING;
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
            costCenterId: cost.costCenterId,
            costObjectId: cost.costObjectId,
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
    // Items have no costing of their own — it rides in from the requisition.
    const costing: LineCosting = {
      costCenterId: input.costCenterId ?? null,
      costObjectId: input.costObjectId ?? null,
    };
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
          costing,
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
    // A sale is traced against the selling company's own costing for the
    // product — the same cost centre its purchases and production there use.
    const costing = await this.costingFor(
      companyId,
      lines.map((l) => l.productId),
      'SALE',
    );
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
          costing: costing.get(l.productId) ?? NO_COSTING,
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
      /** Costing dimensions to stamp; omitted where the movement isn't traced. */
      costing?: LineCosting;
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
        costCenterId: o.costing?.costCenterId ?? null,
        costObjectId: o.costing?.costObjectId ?? null,
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

  /**
   * The PURCHASE REGISTER — what was bought, from whom, at what rate.
   *
   * Read from the goods receipts and their stock ledger rather than from a
   * purchase expense account, because a purchase is a DOCUMENT, not a balance:
   * the ledger could only ever tell you a total, while the receipt knows the
   * supplier, the item, the batch, the store and the rate on the day. Under the
   * costing method this ERP posts (a receipt debits inventory, and the cost
   * reaches the profit and loss when the material is consumed), the purchase
   * block of the chart is not posted to at all — so this is the only place the
   * question is answerable, and it answers it better.
   *
   * Every filter is optional and narrows the same query; the caller groups the
   * rows however it wants to read them.
   */
  async purchaseRegister(
    companyId: number | undefined,
    branchId: number | undefined,
    filters: {
      from?: Date;
      to?: Date;
      supplierId?: number;
      categoryId?: number;
      storeId?: number;
    },
  ) {
    // The supplier lives on the DOCUMENT, so a supplier filter selects receipts
    // first and the ledger rows follow from them.
    const headers = await this.prisma.stockTransaction.findMany({
      where: {
        type: 'PURCHASE',
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.from || filters.to
          ? {
              docDate: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        docNo: true,
        docDate: true,
        supplierId: true,
        purchaseOrderRef: true,
        reference: true,
        storeId: true,
        branchId: true,
      },
      orderBy: [{ docDate: 'desc' }, { id: 'desc' }],
    });
    if (!headers.length) return [];

    const byDoc = new Map(headers.map((h) => [h.id, h]));
    const rows = await this.prisma.stockLedger.findMany({
      where: {
        transactionType: 'PURCHASE',
        documentId: { in: headers.map((h) => h.id) },
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
    });

    const uniq = <T>(xs: (T | null | undefined)[]) =>
      [...new Set(xs.filter((x): x is T => x != null))];
    const [items, products, cats, groups, units, stores, suppliers] =
      await Promise.all([
        this.byId(this.prisma.item, uniq(rows.map((r) => r.itemId))),
        this.byId(this.prisma.product, uniq(rows.map((r) => r.productId))),
        this.byId(this.prisma.category, uniq(rows.map((r) => r.categoryId))),
        this.byId(
          this.prisma.group,
          uniq([
            ...rows.map((r) => r.primaryGroupId),
            ...rows.map((r) => r.parentGroupId),
          ]),
        ),
        this.prisma.unit.findMany({
          where: {
            id: { in: uniq([...rows.map((r) => r.unitId), ...rows.map((r) => r.enteredUnitId)]) },
          },
          select: { id: true, symbol: true, code: true },
        }),
        this.byId(this.prisma.store, uniq(headers.map((h) => h.storeId))),
        // Cross-domain by id, as everywhere: the supplier master is the
        // Accounts module's, and this only ever reads a name off it.
        this.byId(this.prisma.supplier, uniq(headers.map((h) => h.supplierId))),
      ]);
    const unitOf = new Map(units.map((u) => [u.id, u.symbol ?? u.code] as const));

    return rows.map((r) => {
      const doc = byDoc.get(r.documentId);
      const qty = r.qtyIn;
      const taxable = qty * r.unitPrice;
      const tax =
        r.cgstAmount + r.sgstAmount + r.igstAmount + r.cessAmount;
      return {
        id: r.id,
        documentId: r.documentId,
        docNo: r.documentNo,
        date: r.date,
        supplierId: doc?.supplierId ?? null,
        supplierName: doc?.supplierId
          ? suppliers.get(doc.supplierId) ?? null
          : null,
        poRef: doc?.purchaseOrderRef ?? null,
        reference: doc?.reference ?? null,
        storeName: doc ? stores.get(doc.storeId) ?? null : null,
        branchId: doc?.branchId ?? null,
        itemId: r.itemId,
        productId: r.productId,
        name: r.itemId
          ? items.get(r.itemId) ?? ''
          : r.productId
            ? products.get(r.productId) ?? ''
            : '',
        categoryId: r.categoryId,
        categoryName: r.categoryId ? cats.get(r.categoryId) ?? null : null,
        primaryGroupName: r.primaryGroupId
          ? groups.get(r.primaryGroupId) ?? null
          : null,
        parentGroupName: r.parentGroupId
          ? groups.get(r.parentGroupId) ?? null
          : null,
        batchNo1: r.batchNo1,
        batchNo2: r.batchNo2,
        expiryDate: r.expiryDate,
        qty,
        unitSymbol: unitOf.get(r.unitId) ?? '',
        rate: r.unitPrice,
        // `value` stays the TAXABLE value, as it always was; tax and the gross
        // sit beside it rather than inside it, so a register read for costing
        // and one read for a return are the same report.
        value: taxable,
        gstRate: r.cgst + r.sgst + r.igst,
        cgst: r.cgstAmount,
        sgst: r.sgstAmount,
        igst: r.igstAmount,
        cess: r.cessAmount,
        tax,
        total: Math.round((taxable + tax) * 100) / 100,
        // The rate AS INVOICED, per pack — 50 a bottle beside unitPrice's 0.25
        // a gram. Both are stored on the row precisely so a purchase report can
        // show what the supplier billed next to what stock is valued at.
        enteredQty: r.enteredQty,
        enteredUnitSymbol: r.enteredUnitId
          ? unitOf.get(r.enteredUnitId) ?? ''
          : '',
        enteredRate: r.enteredUnitPrice,
      };
    });
  }

  /**
   * The SALES REGISTER — what went out, to whom, at what rate. The mirror of
   * the purchase register, and read the same way: from the documents, because a
   * sale is a document and a ledger balance could only ever give a total.
   *
   * Goods leave on TWO documents, and a register that showed one of them would
   * be quietly wrong:
   *
   *   · a Delivery Note, raised here against a CUSTOMER;
   *   · an intercompany Dispatch, raised in CRM against a BUYER COMPANY.
   *
   * Both write SALE rows to the same stock ledger, and both are stamped with
   * their own document's id — which is why a row is matched on the document
   * NUMBER as well: two tables number their rows independently, so id 7 exists
   * in each, and only the number says which 7 a row means.
   */
  async salesRegister(
    companyId: number | undefined,
    branchId: number | undefined,
    filters: {
      from?: Date;
      to?: Date;
      customerId?: number;
      categoryId?: number;
      storeId?: number;
    },
  ) {
    const rows = await this.prisma.stockLedger.findMany({
      where: {
        transactionType: 'SALE',
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.from || filters.to
          ? {
              date: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
    });
    if (!rows.length) return [];

    const docIds = [...new Set(rows.map((r) => r.documentId))];
    const [notes, dispatches] = await Promise.all([
      this.prisma.stockTransaction.findMany({
        where: { id: { in: docIds }, type: 'SALE' },
        select: {
          id: true,
          docNo: true,
          customerId: true,
          salesOrderRef: true,
          reference: true,
          storeId: true,
          branchId: true,
        },
      }),
      // CRM's row, read by id like any cross-domain reference.
      this.prisma.dispatch.findMany({
        where: { id: { in: docIds } },
        select: {
          id: true,
          dispatchNo: true,
          buyerCompanyId: true,
          soNumber: true,
          invoiceNo: true,
          storeId: true,
          branchId: true,
        },
      }),
    ]);
    // Keyed by number, not id: that is what tells one document 7 from the other.
    const noteBy = new Map(notes.map((n) => [n.docNo, n]));
    const dispatchBy = new Map(dispatches.map((d) => [d.dispatchNo, d]));

    const uniq = <T>(xs: (T | null | undefined)[]) =>
      [...new Set(xs.filter((x): x is T => x != null))];
    const [items, products, cats, groups, units, stores, customers, companies] =
      await Promise.all([
        this.byId(this.prisma.item, uniq(rows.map((r) => r.itemId))),
        this.byId(this.prisma.product, uniq(rows.map((r) => r.productId))),
        this.byId(this.prisma.category, uniq(rows.map((r) => r.categoryId))),
        this.byId(
          this.prisma.group,
          uniq([
            ...rows.map((r) => r.primaryGroupId),
            ...rows.map((r) => r.parentGroupId),
          ]),
        ),
        this.prisma.unit.findMany({
          where: {
            id: {
              in: uniq([
                ...rows.map((r) => r.unitId),
                ...rows.map((r) => r.enteredUnitId),
              ]),
            },
          },
          select: { id: true, symbol: true, code: true },
        }),
        this.byId(this.prisma.store, uniq(rows.map((r) => r.storeId))),
        this.byId(this.prisma.customer, uniq(notes.map((n) => n.customerId))),
        this.byId(
          this.prisma.company,
          uniq(dispatches.map((d) => d.buyerCompanyId)),
        ),
      ]);
    const unitOf = new Map(units.map((u) => [u.id, u.symbol ?? u.code] as const));

    const mapped = rows.map((r) => {
      const note = noteBy.get(r.documentNo);
      const dispatch = note ? undefined : dispatchBy.get(r.documentNo);
      // Who the goods went to, whichever document carried them. An intercompany
      // dispatch names the buying COMPANY; that is still the customer of the
      // sale, so it reads in the same column rather than a second one nobody
      // would think to look in.
      const customerId = note?.customerId ?? null;
      const buyerCompanyId = dispatch?.buyerCompanyId ?? null;
      const qty = r.qtyOut;
      const taxable = qty * r.unitPrice;
      const tax = r.cgstAmount + r.sgstAmount + r.igstAmount + r.cessAmount;
      return {
        id: r.id,
        documentId: r.documentId,
        docNo: r.documentNo,
        // Which document it left on, since the two read differently: a delivery
        // note is this company's sale, a dispatch is a shipment to another of
        // the group's companies.
        source: dispatch ? ('DISPATCH' as const) : ('DELIVERY_NOTE' as const),
        date: r.date,
        customerId,
        customerName: customerId
          ? customers.get(customerId) ?? null
          : buyerCompanyId
            ? companies.get(buyerCompanyId) ?? null
            : null,
        isIntercompany: !!buyerCompanyId,
        orderRef: note?.salesOrderRef ?? dispatch?.soNumber ?? null,
        reference: note?.reference ?? dispatch?.invoiceNo ?? null,
        storeName: stores.get(r.storeId) ?? null,
        branchId: r.branchId,
        itemId: r.itemId,
        productId: r.productId,
        name: r.itemId
          ? items.get(r.itemId) ?? ''
          : r.productId
            ? products.get(r.productId) ?? ''
            : '',
        categoryId: r.categoryId,
        categoryName: r.categoryId ? cats.get(r.categoryId) ?? null : null,
        primaryGroupName: r.primaryGroupId
          ? groups.get(r.primaryGroupId) ?? null
          : null,
        parentGroupName: r.parentGroupId
          ? groups.get(r.parentGroupId) ?? null
          : null,
        batchNo1: r.batchNo1,
        expiryDate: r.expiryDate,
        qty,
        unitSymbol: unitOf.get(r.unitId) ?? '',
        rate: r.unitPrice,
        value: taxable,
        gstRate: r.cgst + r.sgst + r.igst,
        cgst: r.cgstAmount,
        sgst: r.sgstAmount,
        igst: r.igstAmount,
        cess: r.cessAmount,
        tax,
        total: Math.round((taxable + tax) * 100) / 100,
        enteredQty: r.enteredQty,
        enteredUnitSymbol: r.enteredUnitId
          ? unitOf.get(r.enteredUnitId) ?? ''
          : '',
        enteredRate: r.enteredUnitPrice,
      };
    });

    // Applied last, because who a row was sold to is only known once the two
    // document kinds have been resolved.
    return filters.customerId
      ? mapped.filter((r) => r.customerId === filters.customerId)
      : mapped;
  }

  /** id -> name for any master, skipping the query when nothing needs it. */
  private async byId(
    model: { findMany: (args: unknown) => Promise<{ id: number; name: string }[]> },
    ids: number[],
  ): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows = await model.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name] as const));
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
    const headerCosting = await this.assertHeaderCosting(companyId, dto);
    const docDate = new Date(dto.docDate);
    const ymd = this.ymd(dto.docDate);
    // Only IN types create batches → only they need rule batch numbers.
    const ruleBatchNos = isInbound(type)
      ? await this.ruleBatchNumbers(companyId, txnBranchId, dto.lines.length, docDate)
      : null;

    // The document number is derived, so an entry posted at the same instant can
    // take it; retry with the next one rather than failing the post.
    const header = await withNumberRetry(
      (attempt) =>
        this.nextDocNo(
          { companyId, branchId: txnBranchId },
          type,
          docDate,
          attempt,
        ),
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
              // Supplier + PO apply to the Goods Receipt, customer + SO to the
              // Delivery Note. Cleared on every other type rather than carried:
              // a counterparty on a stock journal would be a fact nobody put
              // there, and the registers read these columns.
              supplierId: type === 'PURCHASE' ? dto.supplierId ?? null : null,
              purchaseOrderRef:
                type === 'PURCHASE'
                  ? dto.purchaseOrderRef?.trim() || null
                  : null,
              customerId: type === 'SALE' ? dto.customerId ?? null : null,
              salesOrderRef:
                type === 'SALE' ? dto.salesOrderRef?.trim() || null : null,
              dispatchId: incoming?.id ?? null,
              dispatchNo: incoming?.dispatchNo ?? null,
              costCenterId: headerCosting.costCenterId,
              costObjectId: headerCosting.costObjectId,
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
            headerCosting,
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

    // Last — after the receipt is committed and the shipment closed, so a
    // rolled-back or refused receipt never moves a purchase price.
    await this.feedPurchasePrices(type, dto.lines);
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
    // Costing may be re-picked. Validate the pair the row will END UP with, not
    // just what was sent — changing only the object must keep the saved centre,
    // and an omitted field means "leave alone" rather than "clear".
    const wantsCostingChange =
      dto.costCenterId !== undefined || dto.costObjectId !== undefined;
    const headerCosting = wantsCostingChange
      ? await this.assertHeaderCosting(effCompany, {
          costCenterId:
            dto.costCenterId !== undefined
              ? dto.costCenterId
              : existing.costCenterId,
          costObjectId:
            dto.costObjectId !== undefined
              ? dto.costObjectId
              : existing.costObjectId,
        })
      : {
          costCenterId: existing.costCenterId,
          costObjectId: existing.costObjectId,
        };
    const ruleBatchNos =
      dto.lines && isInbound(existing.type as TxnType)
        ? await this.ruleBatchNumbers(effCompany, txnBranchId, dto.lines.length, docDate)
        : null;

    const saved = await this.prisma.$transaction(async (tx) => {
      const isGrn = existing.type === 'PURCHASE';
      const isSale = existing.type === 'SALE';
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
          customerId:
            isSale && dto.customerId !== undefined ? dto.customerId : undefined,
          salesOrderRef:
            isSale && dto.salesOrderRef !== undefined
              ? dto.salesOrderRef?.trim() || null
              : undefined,
          costCenterId: wantsCostingChange
            ? headerCosting.costCenterId
            : undefined,
          costObjectId: wantsCostingChange
            ? headerCosting.costObjectId
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
          headerCosting,
        });
      }
      return this.findOne(id);
    });

    // An edit can correct the rate that was received, so the write-back runs
    // again over the saved lines. It only ever raises, so re-running is safe and
    // correcting a rate DOWNWARD will not pull the item price back down — that
    // stays a deliberate edit in the Item master.
    if (dto.lines) {
      await this.feedPurchasePrices(existing.type as TxnType, dto.lines);
    }
    return saved;
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
      /** Costing chosen on the document; overrides the per-line product costing. */
      headerCosting?: LineCosting;
    },
  ) {
    const inbound = isInbound(ctx.type);
    // The header's choice wins when there is one — it is a deliberate
    // attribution of the whole document, and it is the only costing an issue of
    // raw-material ITEMS can have (an item carries none of its own). Otherwise
    // each PRODUCT line falls back to whatever this company traces that product
    // against.
    const headerCosting =
      ctx.headerCosting?.costCenterId != null ? ctx.headerCosting : null;
    const costing = headerCosting
      ? new Map<number, LineCosting>()
      : await this.costingFor(
          ctx.companyId,
          ctx.lines
            .map((l) => l.productId)
            .filter((n): n is number => n != null),
          'SALE',
        );
    let batchSeq = 0;
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const cls = ctx.resolved[i];
      const cost =
        headerCosting ??
        (line.productId != null
          ? (costing.get(line.productId) ?? NO_COSTING)
          : NO_COSTING);
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
          costCenterId: cost.costCenterId,
          costObjectId: cost.costObjectId,
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
          // Rates as given; amounts computed here from qty × rate, never taken
          // from the caller — the register foots to these, so they cannot be a
          // figure a client sent.
          ...taxOf(line),
          // The document's own words, kept beside the converted quantity: pack
          // qty, pack unit and the rate per pack, against the stock-unit
          // quantity and rate above.
          enteredQty: line.enteredQty ?? null,
          enteredUnitId: line.enteredUnitId ?? null,
          enteredUnitPrice: line.enteredUnitPrice ?? null,
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
  /**
   * Validate the costing chosen on a document header.
   *
   * A stock document names no ledger account, so only the first of the two
   * entry checkpoints applies: what the COMPANY works in. A centre sent to a
   * company that is not cost-centre-applicable is dropped rather than stored —
   * it could never be reported on, and refusing the document would break a
   * caller that stamps its costing on every save.
   *
   * Beyond that, both must belong to the posting company and the object must
   * sit under the chosen centre — the ids come from the client, so a mismatched
   * pair would otherwise charge another company's books. An object without a
   * centre is rejected rather than silently kept: a cost object is only
   * meaningful under its centre.
   */
  private async assertHeaderCosting(
    companyId: number,
    dto: { costCenterId?: number | null; costObjectId?: number | null },
  ): Promise<LineCosting> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        branchApplicable: true,
        costCenterApplicable: true,
        costObjectApplicable: true,
      },
    });
    if (!company) throw new BadRequestException('Company not found.');
    // No account: the rules come back OPTIONAL where the company allows the
    // dimension and OFF where it does not.
    const rules = resolveEntryRules(company, null);
    const costCenterId =
      rules.costCenter === 'OFF' ? null : (dto.costCenterId ?? null);
    const costObjectId =
      rules.costObject === 'OFF' ? null : (dto.costObjectId ?? null);
    if (costCenterId == null && costObjectId == null) return NO_COSTING;
    if (costCenterId == null) {
      throw new BadRequestException(
        'Choose a cost centre before choosing a cost object.',
      );
    }

    const centre = await this.prisma.costCenter.findUnique({
      where: { id: costCenterId },
      select: { companyId: true },
    });
    if (!centre || centre.companyId !== companyId) {
      throw new BadRequestException(
        'That cost centre belongs to another company.',
      );
    }
    if (costObjectId != null) {
      const obj = await this.prisma.costObject.findUnique({
        where: { id: costObjectId },
        select: { companyId: true, costCenterId: true },
      });
      if (!obj || obj.companyId !== companyId) {
        throw new BadRequestException(
          'That cost object belongs to another company.',
        );
      }
      if (obj.costCenterId !== costCenterId) {
        throw new BadRequestException(
          'That cost object does not sit under the chosen cost centre.',
        );
      }
    }
    return { costCenterId, costObjectId };
  }

  /**
   * The costing dimensions for a set of products, as seen by ONE company.
   *
   * Costing hangs off the product's row for that company (ProductCompany), not
   * off the product itself: the same product can be made by one company and
   * bought by another, and each traces it against its own books. One cost
   * centre serves buying, making and selling alike there, so only the OBJECT
   * varies — by activity.
   *
   * A company that only buys and sells has no per-activity objects, so its
   * single one answers for every activity. A product with no row in this
   * company (or no costing set) yields nulls rather than failing: costing is a
   * reporting dimension, and a movement must not be blocked for want of one.
   */
  private async costingFor(
    companyId: number,
    productIds: number[],
    activity: CostActivity,
  ): Promise<Map<number, LineCosting>> {
    const out = new Map<number, LineCosting>();
    const ids = [...new Set(productIds)];
    if (!ids.length) return out;

    const rows = await this.prisma.productCompany.findMany({
      where: { companyId, productId: { in: ids } },
      select: {
        productId: true,
        costCenterId: true,
        recipeCostObjectId: true,
        packingCostObjectId: true,
        costObjectId: true,
      },
    });
    for (const r of rows) {
      // A sale follows what was actually sold: a packed product carries the
      // packing object, an unpacked one the recipe object.
      const byActivity =
        activity === 'PACKING'
          ? r.packingCostObjectId
          : activity === 'SALE'
            ? (r.packingCostObjectId ?? r.recipeCostObjectId)
            : r.recipeCostObjectId;
      out.set(r.productId, {
        costCenterId: r.costCenterId,
        costObjectId: byActivity ?? r.costObjectId ?? null,
      });
    }
    return out;
  }

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

  /** Next document number: the branch's numbering rule, else a built-in prefix. */
  private async nextDocNo(
    scope: NumberingScope,
    type: TxnType,
    date: Date,
    attempt = 0,
  ): Promise<string> {
    const cfg = TXN_CONFIG[type];
    return this.numbering.nextOrDefault(
      scope,
      cfg.documentCode,
      { prefix: `${cfg.prefix}-`, padding: 5 },
      date,
      attempt,
    );
  }
}
