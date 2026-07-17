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

  /** Mark a document's holds CONSUMED — the goods have moved on. */
  consumeFor(documentType: string, documentId: number): Promise<void>;

  /** What each line of a document currently holds. */
  reservedFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservedForLine[]>;
}
