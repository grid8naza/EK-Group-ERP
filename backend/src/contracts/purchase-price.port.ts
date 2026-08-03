/**
 * Port — how a receiving module reports what it actually paid for an item, so
 * the Item master's last purchase price can follow. Owned and implemented by the
 * item module (which owns `Item.lastPurchasePrice`); bound in contracts.module.ts.
 *
 * The rule is deliberately one-way: a rate only ever RISES. A cheap one-off buy,
 * a sample, or a promotional lot must not drop the figure every recipe is costed
 * against, because that would quietly inflate every margin in the business. When
 * a price genuinely falls for good, someone lowers it by hand in the Item master
 * — a decision, not a side effect of one delivery.
 */

/** DI token for the purchase-price port. Inject with `@Inject(PURCHASE_PRICE)`. */
export const PURCHASE_PRICE = Symbol('PURCHASE_PRICE');

/** What one received line paid, per the item's OWN stock unit. */
export interface PurchasedAt {
  itemId: number;
  /** Rate per stock unit. Callers must convert a pack rate before sending it. */
  unitPrice: number;
}

/** An item whose last purchase price actually moved. */
export interface PurchasePriceRaise {
  itemId: number;
  itemName: string;
  from: number;
  to: number;
}

export interface PurchasePricePort {
  /**
   * Raise each item's last purchase price to the rate paid, where that rate is
   * higher than what the master holds. Returns only the items that moved, so the
   * caller can report the change; an empty array means every rate was at or
   * below what was already recorded.
   */
  raiseLastPurchasePrice(lines: PurchasedAt[]): Promise<PurchasePriceRaise[]>;
}
