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

export interface StockPostingPort {
  /**
   * Bank produced finished goods into stock: one new batch per line, a
   * PRODUCTION stock-in ledger row each, at the given store. Returns the batch
   * each line became. Atomic — all lines post or none do.
   */
  postProductionReceipt(
    input: ProductionReceiptPosting,
  ): Promise<ProducedBatch[]>;
}
