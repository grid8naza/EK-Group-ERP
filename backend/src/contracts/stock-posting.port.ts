/**
 * Port — how a business module POSTS a stock movement it does not own the ledger
 * for. Today: production receipts (finished goods banked into stock as new
 * batches). Implemented by the stock-transaction module (the ledger writer);
 * bound in contracts.module.ts.
 */

/** DI token for the stock-posting port. Inject with `@Inject(STOCK_POSTING)`. */
export const STOCK_POSTING = Symbol('STOCK_POSTING');

/** One finished product produced into stock. */
export interface ProduceStockLine {
  productId: number;
  quantity: number;
  /** Explicit expiry; when absent it is derived from the product shelf life. */
  expiryDate?: string | null;
}

/** The batch a produced line was banked as. */
export interface ProducedBatch {
  productId: number;
  batchId: number;
  batchNo: string;
  quantity: number;
  unitId: number;
  expiryDate: string | null;
}

export interface ProductionReceiptPosting {
  companyId: number;
  branchId: number | null;
  storeId: number;
  /** The production-receipt document these movements belong to. */
  documentId: number;
  documentNo: string;
  /** ISO date of the movement. */
  date: string;
  lines: ProduceStockLine[];
}

/** A product consumed out of stock (e.g. a packed product's unpacked source). */
export interface ConsumeProductLine {
  productId: number;
  quantity: number;
}

/** A raw/packing-material item consumed out of stock. */
export interface ConsumeItemLine {
  itemId: number;
  quantity: number;
}

export interface PackingPosting {
  companyId: number;
  branchId: number | null;
  storeId: number;
  documentId: number;
  documentNo: string;
  date: string;
  /** Packed products produced (new batches in). */
  produce: ProduceStockLine[];
  /** Unpacked source products consumed (out). */
  consumeProducts: ConsumeProductLine[];
  /** Packing-material items consumed (out). */
  consumeItems: ConsumeItemLine[];
}

/** A product shipped out on a dispatch. */
export interface DispatchStockLine {
  productId: number;
  quantity: number;
}

export interface DispatchPosting {
  companyId: number;
  branchId: number | null;
  storeId: number;
  documentId: number;
  documentNo: string;
  date: string;
  lines: DispatchStockLine[];
}

export interface StockPostingPort {
  /**
   * Bank produced finished goods into stock: one new batch per line, a
   * PRODUCTION stock-in ledger row each, at the given store. Returns the batch
   * each line became. Atomic — all lines post or none do.
   */
  postProductionReceipt(
    input: ProductionReceiptPosting,
  ): Promise<ProducedBatch[]>;

  /**
   * Post a packing operation: consume the unpacked source products and packing
   * materials (stock-out, availability-checked), and produce the packed products
   * as new batches (stock-in). Atomic — everything posts or nothing does.
   */
  postPacking(input: PackingPosting): Promise<ProducedBatch[]>;

  /**
   * Ship goods out on a dispatch: a SALE stock-out per product at the source
   * store, availability-checked. Atomic.
   */
  postDispatch(input: DispatchPosting): Promise<void>;
}
