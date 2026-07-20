/**
 * Port — how document modules obtain their next formatted document number from
 * the central per-company numbering rules WITHOUT importing the numbering
 * module. Bound in contracts.module.ts to the DocumentNumbering adapter.
 *
 * Numbers are DERIVED, never stored: the next one is MAX(what has actually been
 * issued) + 1, the Access `Nz(DMax(...),0)+1` rule. No running counter exists,
 * so clearing a company's documents restarts its numbering at the beginning
 * instead of carrying a counter no document backs any more.
 */

/** DI token for the numbering port. Inject with `@Inject(NUMBERING)`. */
export const NUMBERING = Symbol('NUMBERING');

/** The built-in scheme a document falls back to when no rule is configured. */
export interface NumberingDefault {
  /** e.g. "SO-" — the number becomes SO-00001. */
  prefix: string;
  /** Digits the sequence is padded to. */
  padding: number;
}

export interface NumberingPort {
  /**
   * The next formatted number for (company, document code): the highest number
   * already issued for the current period, plus one. Returns null when no rule
   * is configured for that document — prefer nextOrDefault, which handles that.
   */
  next(
    companyId: number,
    documentCode: string,
    date?: Date,
  ): Promise<string | null>;

  /**
   * The next number, falling back to the caller's built-in scheme when the
   * company has configured no rule. Never null.
   *
   * `attempt` offsets the sequence: a derived number is deterministic, so a
   * retry after a unique-constraint clash must ask for the one after it.
   */
  nextOrDefault(
    companyId: number,
    documentCode: string,
    fallback: NumberingDefault,
    date?: Date,
    attempt?: number,
  ): Promise<string>;
}
