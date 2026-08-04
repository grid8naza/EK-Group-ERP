import { BadRequestException } from '@nestjs/common';

/**
 * What a document asks for at data entry, decided by TWO checkpoints.
 *
 *   Level 1 — the COMPANY: branchApplicable, costCenterApplicable,
 *     costObjectApplicable. A company that does not work in cost centres has
 *     none to name, so the field is never shown whatever a ledger says.
 *
 *   Level 2 — the LEDGER: Account.hasCostCenter, Account.hasCostObject. Within
 *     a company that does work in them, the account decides whether THIS line
 *     carries one.
 *
 * Both are checked and the narrower answer wins. Keeping that in one function
 * is the point: the entry screen, the posting engine and every document that
 * carries a cost dimension must reach the same answer, and they will not if
 * each works it out for itself.
 *
 * A document that names no ledger account — a stock journal, a production
 * receipt — has no level-2 opinion. Its dimensions are OPTIONAL where the
 * company allows them: it may carry a centre, but nothing here demands one.
 */
export type EntryFieldRule =
  /** Ask for it, and refuse the line without it. */
  | 'REQUIRED'
  /** Offer it; the line is valid either way. */
  | 'OPTIONAL'
  /** Do not ask. The field stays blank on the line. */
  | 'OFF';

/** Level 1 — the company's own setup. */
export interface CompanyEntrySetup {
  branchApplicable: boolean;
  costCenterApplicable: boolean;
  costObjectApplicable: boolean;
}

/** Level 2 — what the ledger account being posted to asks for. */
export interface AccountEntrySetup {
  hasCostCenter: boolean;
  hasCostObject: boolean;
}

export interface EntryRules {
  /** Mandatory on every entry of a branch-applicable company. */
  branch: EntryFieldRule;
  costCenter: EntryFieldRule;
  costObject: EntryFieldRule;
}

/**
 * Resolve the two checkpoints into what one line must carry.
 *
 * `account` is null for a document that posts to no ledger account.
 */
export function resolveEntryRules(
  company: CompanyEntrySetup,
  account?: AccountEntrySetup | null,
): EntryRules {
  const level2 = (
    applicable: boolean,
    asks: boolean | undefined,
  ): EntryFieldRule => {
    if (!applicable) return 'OFF';
    if (!account) return 'OPTIONAL';
    return asks ? 'REQUIRED' : 'OFF';
  };

  return {
    // Company and branch are not analysis dimensions but the books the entry
    // belongs to, so no ledger may waive the branch.
    branch: company.branchApplicable ? 'REQUIRED' : 'OFF',
    costCenter: level2(company.costCenterApplicable, account?.hasCostCenter),
    // A department is named inside its division, so it is never asked for on
    // its own — the caller cannot end up with an object and no centre.
    costObject:
      company.costCenterApplicable && company.costObjectApplicable
        ? level2(true, account?.hasCostObject)
        : 'OFF',
  };
}

/**
 * Hold a line to the rules: what is REQUIRED must be there, and what is OFF is
 * dropped rather than rejected — a module that stamps the document's cost
 * centre on every line must not fail on the one line whose account does not
 * take one (Annexure D.7).
 *
 * Returns the values as they should be stored.
 */
export function applyEntryRules(
  rules: EntryRules,
  values: { branchId?: number | null; costCenterId?: number | null; costObjectId?: number | null },
  /** Named in the error, e.g. "Mess Provisions Consumed". */
  label?: string,
): { branchId: number | null; costCenterId: number | null; costObjectId: number | null } {
  const where = label ? ` on ${label}` : '';
  const take = (
    rule: EntryFieldRule,
    value: number | null | undefined,
    name: string,
  ): number | null => {
    if (rule === 'OFF') return null;
    if (rule === 'REQUIRED' && value == null) {
      throw new BadRequestException(`Choose a ${name}${where}.`);
    }
    return value ?? null;
  };

  const costCenterId = take(rules.costCenter, values.costCenterId, 'cost centre');
  const costObjectId = take(rules.costObject, values.costObjectId, 'cost object');
  // Dropping the centre drops the department with it: an object recorded under
  // no centre could never be rolled up.
  return {
    branchId: take(rules.branch, values.branchId, 'branch'),
    costCenterId,
    costObjectId: costCenterId == null ? null : costObjectId,
  };
}
