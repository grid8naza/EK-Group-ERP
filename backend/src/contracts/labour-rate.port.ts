/**
 * Port — how a costing consumer obtains a worker designation's hourly rate
 * without importing the HR module. Owned and implemented by the hr-designation
 * module; bound in contracts.module.ts.
 *
 * Deliberately narrow, and unfiltered by `isActive` for the same reason as
 * [AssetRatePort]: a process step that already references a designation keeps
 * costing at that designation's rate.
 */

/** DI token for the labour-rate port. Inject with `@Inject(LABOUR_RATE)`. */
export const LABOUR_RATE = Symbol('LABOUR_RATE');

export interface LabourRatePort {
  /**
   * Cost per hour for each requested designation, keyed by designation id. Ids
   * that do not resolve are absent from the map; treat a miss as a zero rate.
   */
  ratePerHourFor(designationIds: number[]): Promise<Map<number, number>>;
}
