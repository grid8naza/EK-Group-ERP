/**
 * What the Order Catalogue hands the screen. Read-only shapes: the catalogue
 * itself writes nothing — ticking quantities and pressing Create raises an
 * ordinary ICPO through POST /purchase-orders, so nothing here is ever posted
 * back.
 */

/** One product as the ordering branch sees it, with the maths already done. */
export interface CatalogueRow {
  productId: number;
  code: string;
  name: string;
  /** Product picture, served from /uploads/products. Null = no picture set. */
  imageUrl: string | null;
  /** Sold as a pack. Purely a label for the card. */
  packed: boolean;
  categoryId: number | null;
  categoryName: string | null;
  groupId: number | null;
  groupName: string | null;
  unitId: number;
  unitSymbol: string;
  /** Decimals the unit allows — what the quantity box steps in. */
  decimalPlaces: number;
  /**
   * The supplier's intercompany price. INFORMATION ONLY: an ICPO carries no
   * price, because what the goods cost is decided by the batch that ends up
   * shipping. Shown so the branch can see roughly what it is committing to.
   */
  price: number;

  // --- how demand was measured ---
  /** Days the goods keep. 0 = not tracked, and the window falls back. */
  shelfLife: number;
  /** Shelf-life cycles averaged over, from Product Master. */
  demandCycles: number;
  /** shelfLife x demandCycles — the days of history behind `avgDailySales`. */
  windowDays: number;
  /** Quantity SOLD at this branch over that window. */
  soldQty: number;
  /** soldQty / windowDays. */
  avgDailySales: number;

  // --- how long the delivery must last ---
  /** Days this delivery has to cover: the gap to the next production run,
   *  capped at the shelf life. */
  coverDays: number;
  /** The run that ends the cover, `YYYY-MM-DD`. Null when made to order. */
  nextProductionDate: string | null;

  // --- what the branch keeps and holds ---
  minStock: number;
  maxStock: number;
  reorderLevel: number;
  /** On hand at this branch, less its own active holds. */
  available: number;
  /** Already coming on an open ICPO from this supplier, not yet received. */
  onOrder: number;
  /**
   * Ordered from this branch by outside CUSTOMERS, for on or before the delivery
   * date, not yet dispatched. Demand the branch owes somebody by name, so it is
   * ADDED to the suggestion rather than netted off.
   */
  poQty: number;
  /** Owed under a supply contract on the delivery date. Added, like poQty. */
  contractQty: number;
  /** The contracts behind `contractQty` — so a branch can see WHY it owes. */
  contractSources: {
    contractId: number;
    contractNo: string;
    customerName: string;
    quantity: number;
    rate: number;
  }[];

  // --- the answer ---
  /** avgDailySales x coverDays — the shelf's own need over the cover period. */
  target: number;
  /**
   * max(0, (coverDays x avgDailySales) - minStock - available + poQty
   *        + contractQty), to the unit's precision.
   *
   * Recomputed on the screen when the cover days are edited, by the same
   * arithmetic — every input above is on the row, so the client needs nothing
   * more from the server to redo it.
   */
  suggestedQty: number;
  /** Available has fallen under the branch's reorder / minimum level. */
  belowLevel: boolean;
}

/** The whole catalogue for one supplier, read for one branch on one day. */
export interface CatalogueResult {
  branchId: number;
  supplierCompanyId: number;
  /** The day the goods are wanted, `YYYY-MM-DD` — what cover days measure from. */
  deliveryDate: string;
  rows: CatalogueRow[];
}
