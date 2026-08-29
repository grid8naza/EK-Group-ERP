/**
 * Port — how a business module asks about stock, and holds some, WITHOUT
 * importing the module that owns the ledger. Bind it in contracts.module.ts
 * (token → the Stock module's adapter).
 *
 * Rules: small, serializable shapes only; methods async; never leak Prisma types.
 */

export const STOCK = Symbol('STOCK');

/** What a company physically holds of one product, and what's left to promise. */
export interface StockOnHand {
  productId: number;
  /** Physical quantity across every store of the company. */
  onHand: number;
  /** Held by ACTIVE reservations, excluding the caller's own if it named one. */
  reserved: number;
  /** onHand - reserved. What the asking document may still take. */
  available: number;
  /** The product's stock unit — every quantity here is expressed in it. */
  unitId: number;
}

/** What a company holds of one raw-material Item, optionally at one store. */
export interface ItemStockOnHand {
  itemId: number;
  /** Physical quantity (SUM qtyIn - qtyOut), across the store(s) asked about. */
  onHand: number;
  /** The item's stock unit, or null if the item is unknown. */
  unitId: number | null;
}

/** A line asking to hold `quantity` of `productId`. */
export interface ReserveRequestLine {
  /** The caller's line id — reservations are keyed to it, and released by it. */
  lineId: number;
  productId: number;
  /** Desired quantity, in the product's stock unit. */
  quantity: number;
}

/** What a line actually got. `reserved` may be < requested when stock ran out. */
export interface ReserveResultLine {
  lineId: number;
  productId: number;
  requested: number;
  reserved: number;
  /** requested - reserved: the part no stock could cover. */
  shortfall: number;
}

export interface ReserveRequest {
  companyId: number;
  userId: number;
  /** Namespaces documentId, so one table serves every kind of document. */
  documentType: string;
  documentId: number;
  lines: ReserveRequestLine[];
}

/** A line's current hold, summed across the batches FEFO split it over. */
export interface ReservedForLine {
  lineId: number;
  productId: number;
  quantity: number;
}

/**
 * One hold, on one batch — the grain FEFO actually works at.
 *
 * Carries the batch's own selling prices, captured when that stock came in. They
 * are what a sale must charge: goods labelled at an old price cannot be sold at
 * a new one, so the price follows the batch rather than the product master
 * (whose price is only the most recent one, for information).
 */
export interface ReservationDetail {
  lineId: number;
  productId: number;
  batchId: number;
  batchNo: string;
  /** Supplier's batch number on the goods, if they gave one. */
  supplierBatchNo: string | null;
  expiryDate: string | null;
  quantity: number;
  intercompanyPrice: number;
  wholesalePrice: number;
  retailPrice: number;
}

/**
 * How far back to measure one product's sales. Per product, because the window
 * is derived from the product's own shelf life — a bun and a fruit cake are not
 * judged over the same run of trade.
 */
export interface SoldQtyWindow {
  productId: number;
  /** Local calendar date, `YYYY-MM-DD`, INCLUSIVE. Sales on or after it count. */
  sinceDate: string;
  /**
   * Local calendar date, `YYYY-MM-DD`, EXCLUSIVE — sales BEFORE it count.
   *
   * Both ends are named so the window holds exactly the number of days the
   * caller divides by. With only a start, "the last 12 days" spans 13 dates
   * (`sinceDate` through today) and every average comes out short by a day's
   * worth. It is also how today — a day only half traded — is left out.
   */
  untilDate: string;
}

/** What one product actually sold in the window asked for. */
export interface SoldQty {
  productId: number;
  /** Sum of qtyOut on SALE movements, in the product's stock unit. */
  qty: number;
}

/** A live hold standing in the way of destroying a batch. */
export interface BatchHold {
  batchId: number;
  batchNo: string;
  quantity: number;
  /** What is holding it, e.g. 'PURCHASE_ORDER'. */
  documentType: string;
  documentId: number;
}

export interface StockPort {
  /**
   * On-hand / reserved / available per product for a company, across all its
   * stores. Products with no ledger history come back as zeroes rather than
   * missing, so a caller can render a row for every line it asked about.
   *
   * Pass `forDocument` when asking on behalf of a document that already holds
   * stock: its OWN holds are then excluded from `reserved`, so `available` is
   * what THAT document may still take. Without this a reviewer who reserved 14
   * of 26 would be told 12 are available, when re-reserving would in fact give
   * them all 26 — reserveFefo releases a line's own holds before reallocating.
   */
  onHandFor(
    companyId: number,
    productIds: number[],
    forDocument?: { documentType: string; documentId: number },
  ): Promise<StockOnHand[]>;

  /**
   * The same reading, narrowed to ONE BRANCH — its stores only.
   *
   * A branch counter running out is a fact about that counter, and the
   * company-wide figure hides it behind a full factory store. Reservations are
   * netted off the same way, by the stores that sit in the branch.
   */
  onHandAtBranch(
    companyId: number,
    branchId: number,
    productIds: number[],
  ): Promise<StockOnHand[]>;

  /**
   * What each product SOLD at a branch since its own `sinceDate` — the qtyOut
   * on SALE movements, which is every delivery note and every intercompany
   * dispatch out of that branch.
   *
   * Windows are per product rather than one date for the lot: what counts as a
   * representative run of trade follows the goods' shelf life. Products that
   * moved nothing come back as 0, so the caller gets a row for each one asked
   * about.
   */
  soldQtyAtBranch(
    companyId: number,
    branchId: number,
    windows: SoldQtyWindow[],
  ): Promise<SoldQty[]>;

  /**
   * On-hand per raw-material Item for a company, optionally scoped to one store.
   * Raw materials carry no reservations, so on-hand is what is available. Items
   * with no ledger history come back as zero, so the caller gets a row per item.
   */
  onHandForItems(
    companyId: number,
    itemIds: number[],
    storeId?: number,
  ): Promise<ItemStockOnHand[]>;

  /**
   * Hold stock for a document's lines, oldest-expiry-first across every store of
   * the company (FEFO), splitting a line across batches as needed.
   *
   * IDEMPOTENT: a line's existing ACTIVE holds are released before it is
   * allocated afresh, so calling twice re-reserves rather than double-reserves.
   * A line whose request exceeds what's free reserves what it can and reports the
   * shortfall — it is not an error, it's the production gap.
   */
  reserveFefo(input: ReserveRequest): Promise<ReserveResultLine[]>;

  /** Give back holds for a whole document, or just some of its lines. */
  releaseFor(
    documentType: string,
    documentId: number,
    lineIds?: number[],
  ): Promise<void>;

  /**
   * ACTIVE holds standing on any of these batches. Empty = the batches are free.
   *
   * Ask before DESTROYING a batch — which every stock document does when its
   * lines are edited or it's deleted, since batches are regenerated wholesale.
   * A hold outlives the batch it names, and then quietly sterilises the stock:
   * it counts against what anyone else can reserve, while pointing at a row that
   * no longer exists, so nothing on any screen explains where the quantity went.
   */
  holdsOnBatches(batchIds: number[]): Promise<BatchHold[]>;

  /** Mark a document's holds CONSUMED — the goods have moved on. */
  consumeFor(documentType: string, documentId: number): Promise<void>;

  /** What each line of a document currently holds, summed across its batches. */
  reservedFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservedForLine[]>;

  /**
   * Every hold of a document, one row per batch, with that batch's prices.
   *
   * This is what a sales order is built from: the price a customer pays comes
   * from the batch that ships, so one ordered product becomes one line per batch
   * it was filled from. Ordered oldest-expiry-first, matching how FEFO allocated.
   */
  reservationDetailFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservationDetail[]>;
}
