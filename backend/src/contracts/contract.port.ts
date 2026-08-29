/**
 * Port — how a business module asks what the SUPPLY CONTRACTS oblige on a day,
 * without importing the module that owns them.
 *
 * The Order Catalogue lives in Purchase and the contracts live in CRM. What the
 * catalogue needs is one question — "what must this branch hand over on
 * Wednesday" — and a port is the whole of it, so neither module has to know the
 * other exists.
 *
 * Implemented by the CRM module (ContractAdapter); bound in contracts.module.ts.
 *
 * Rules: small, serializable shapes only; methods async; never leak Prisma types.
 */

/** DI token for the contract port. Inject with `@Inject(CONTRACT)`. */
export const CONTRACT = Symbol('CONTRACT');

/** One contract standing behind a quantity — so a branch can see WHY it owes. */
export interface ContractDueSource {
  contractId: number;
  contractNo: string;
  customerName: string;
  quantity: number;
  /** The price agreed for this contract — not the batch's, deliberately. */
  rate: number;
}

/** What the live contracts oblige for one product on one day. */
export interface ContractDue {
  productId: number;
  /** Summed across every live contract that supplies this product that day. */
  quantity: number;
  unitId: number;
  sources: ContractDueSource[];
}

export interface ContractPort {
  /**
   * What this branch must hand over on `date` (a local calendar date,
   * YYYY-MM-DD), per product.
   *
   * Only ACTIVE contracts whose period covers the date count, and only the
   * LINES supplied on that weekday — a school taking bread on Monday, Wednesday
   * and Friday owes nothing on a Tuesday. A product nothing is due for is
   * absent rather than zero: the caller is adding to a demand figure, not
   * rendering a row per contract.
   *
   * `branchId` null asks for the contracts served centrally only.
   */
  dueOn(
    companyId: number,
    branchId: number | null,
    date: string,
  ): Promise<ContractDue[]>;
}
