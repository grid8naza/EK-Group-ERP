/**
 * Port — how stock modules obtain a formatted batch number from the central
 * per-company/branch batch-numbering rules WITHOUT importing the module. Bound
 * in contracts.module.ts to the BatchNumbering adapter.
 */

/** DI token for the batch-numbering port. Inject with `@Inject(BATCH_NUMBERING)`. */
export const BATCH_NUMBERING = Symbol('BATCH_NUMBERING');

export interface BatchNumberingPort {
  /**
   * `count` sequential formatted batch numbers for (company, branch), derived
   * from the MAX existing sequence in that rule's period (so back-dated /
   * interleaved entry stays correct). Returns null when no rule is configured —
   * the caller falls back to its own built-in scheme.
   */
  nextRange(
    companyId: number,
    branchId: number | null,
    count: number,
    date?: Date,
  ): Promise<string[] | null>;
}
