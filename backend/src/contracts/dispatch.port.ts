/**
 * Port — how the RECEIVING side of an intercompany shipment reads and closes a
 * Dispatch it does not own. The seller raises the dispatch in CRM; the buyer
 * receives the goods on their Goods Receipt Note (inventory), which needs to
 * list what is coming in and mark it received once banked into stock.
 *
 * Implemented by the CRM module (DispatchLinkAdapter); bound in contracts.module.ts.
 *
 * Deliberately NOT served by DispatchService: that service posts stock through
 * STOCK_POSTING, which the stock-transaction module implements — routing this
 * back through it would close a provider cycle. The link service touches nothing
 * but dispatch rows.
 */

/** DI token for the dispatch port. Inject with `@Inject(DISPATCH)`. */
export const DISPATCH = Symbol('DISPATCH');

/** One product line on an incoming dispatch, as the buyer sees it. */
export interface IncomingDispatchLine {
  productId: number;
  productName: string;
  /** What the seller shipped. The buyer may accept less (short / damaged). */
  quantity: number;
  unitId: number;
  /** The seller's intercompany price — what the goods cost the buyer. */
  rate: number;
  /** The seller's batch number, carried onto the receipt as the supplier batch. */
  batchNo: string | null;
  /**
   * The seller's batch. The goods are physically the same, so the receiving side
   * resolves its expiry from here — it owns the batch table, CRM does not.
   */
  batchId: number | null;
}

/** A dispatch heading for this company, awaiting receipt. */
export interface IncomingDispatch {
  id: number;
  dispatchNo: string;
  dispatchDate: string;
  /** The company that shipped (the seller). */
  sellerCompanyId: number;
  soNumber: string | null;
  invoiceNo: string | null;
  deliveryNoteNo: string | null;
  ewayBillNo: string | null;
  driverName: string | null;
  vehicleNo: string | null;
  lines: IncomingDispatchLine[];
}

export interface DispatchPort {
  /**
   * Dispatches shipped TO this company (and branch, when one is active) that are
   * still awaiting receipt.
   */
  incomingFor(
    buyerCompanyId: number,
    buyerBranchId: number | null,
  ): Promise<IncomingDispatch[]>;

  /**
   * One incoming dispatch addressed to this buyer, whatever its status, or null.
   * The caller decides what an already-received dispatch means.
   */
  findIncoming(
    dispatchId: number,
    buyerCompanyId: number,
  ): Promise<(IncomingDispatch & { received: boolean }) | null>;

  /** Close a dispatch: the buyer has banked the goods into stock. */
  markReceived(dispatchId: number): Promise<void>;

  /** Reopen a dispatch — its goods receipt was deleted. */
  markDispatched(dispatchId: number): Promise<void>;
}
