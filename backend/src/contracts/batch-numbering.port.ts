/**
 * Port — how stock modules obtain a formatted batch number from the central
 * per-company/branch batch-numbering rules WITHOUT importing the module. Bound
 * in contracts.module.ts to the BatchNumbering adapter.
 */

/** DI token for the batch-numbering port. Inject with `@Inject(BATCH_NUMBERING)`. */
export const BATCH_NUMBERING = Symbol('BATCH_NUMBERING');

export interface BatchNumberingPort {
  /**
   * The next formatted batch number for (company, branch), advancing that rule's
   * counter. Returns null when no rule is configured — the caller falls back to
   * its own built-in scheme.
   */
  next(
    companyId: number,
    branchId: number | null,
    date?: Date,
  ): Promise<string | null>;
}
