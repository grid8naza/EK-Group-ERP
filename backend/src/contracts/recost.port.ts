/**
 * Port — how a master that owns a COSTING RATE tells product costing that the
 * rate has moved, so the products built on it can be recosted. Owned and
 * implemented by the product module (which owns recipes, packing and the cost
 * cache); bound in contracts.module.ts.
 *
 * The direction matters: Asset and HR do not know what a recipe is, and the
 * product module does not know when a machine is edited. Neither imports the
 * other — the rate's owner announces the change and the costing side decides
 * what it means.
 *
 * Only the COST follows a rate automatically. Selling prices and the profit
 * targets they are judged against are never touched: moving the cost is exactly
 * what makes the margin change visible in Price Review, where a human decides
 * whether a price should follow.
 */

/** DI token for the recost port. Inject with `@Inject(RECOST)`. */
export const RECOST = Symbol('RECOST');

/** A product whose cached cost moved as a result. */
export interface RecostedProduct {
  productId: number;
  name: string;
  from: number;
  to: number;
}

export interface RecostPort {
  /**
   * Recost every product reached by the given machines / designations — those
   * whose process flow references them, and everything packed from those in
   * turn. Returns only the products whose cost actually moved.
   *
   * A product with no BOM to cost from, or a locked one, is left alone.
   */
  recostForRateChange(input: {
    assetIds?: number[];
    designationIds?: number[];
  }): Promise<RecostedProduct[]>;
}
