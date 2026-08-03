/**
 * Port — how a costing consumer obtains a machine's running rate without
 * importing the Asset module. Owned and implemented by the asset module; bound
 * in contracts.module.ts.
 *
 * Deliberately narrow: costing needs a rate per machine and nothing else about
 * the asset. It does NOT filter on `isProductionLine` or status — a process step
 * that already references a machine must keep costing at that machine's rate
 * even after it is retired, exactly as the Recipe/Packing editors resolve it.
 */

/** DI token for the asset-rate port. Inject with `@Inject(ASSET_RATE)`. */
export const ASSET_RATE = Symbol('ASSET_RATE');

export interface AssetRatePort {
  /**
   * Running cost per hour for each requested asset, keyed by asset id. Ids that
   * do not resolve are absent from the map; treat a miss as a zero rate.
   */
  costPerHourFor(assetIds: number[]): Promise<Map<number, number>>;
}
