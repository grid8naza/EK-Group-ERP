/**
 * Port — how document modules obtain their next formatted document number from
 * the central per-company numbering rules WITHOUT importing the numbering
 * module. Bound in contracts.module.ts to the DocumentNumbering adapter.
 */

/** DI token for the numbering port. Inject with `@Inject(NUMBERING)`. */
export const NUMBERING = Symbol('NUMBERING');

export interface NumberingPort {
  /**
   * The next formatted number for (company, document code), advancing the
   * company's counter. Returns null when no rule is configured for that
   * document — the caller may then fall back to its own scheme.
   */
  next(
    companyId: number,
    documentCode: string,
    date?: Date,
  ): Promise<string | null>;
}
