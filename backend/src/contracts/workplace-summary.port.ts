/**
 * Port — how each module says what is waiting for ONE PERSON, so the Workplace
 * dashboard can show all of it together without importing any of them.
 *
 * The dashboard is deliberately **user-centric, not company-centric**: it covers
 * every company and branch the signed-in user has privileges for, because a
 * person does not stop being answerable for a payment at Regency because they
 * are working in Bake House this morning. Every implementation below is
 * therefore keyed on the USER, and never filtered by an active company.
 *
 * Registered as a multi-provider array in contracts/contracts.module.ts, the
 * same shape as METRIC_PROVIDER and ALERT_SOURCE (NestJS has no Angular-style
 * multi-providers). The dashboard service injects them ALL.
 *
 * Why not one dashboard module querying the tables directly? Because the hard
 * part of every line below is the VISIBILITY rule — a mail one reader deleted is
 * still in another's inbox, a task is visible to its raiser and assignees alone,
 * an approval belongs to whoever holds a PENDING task on it, a circular is
 * outstanding until acknowledged rather than until read. Those rules live in the
 * modules that own them, and a second copy in a dashboard is a second copy that
 * will drift.
 *
 * Rules: small, serializable shapes only; methods async; never leak Prisma types.
 */

/** DI token. Inject the ARRAY with `@Inject(WORKPLACE_SUMMARY)`. */
export const WORKPLACE_SUMMARY = Symbol('WORKPLACE_SUMMARY');

/** How loudly a tile paints. `urgent` is for things already late. */
export type WorkplaceTone = 'normal' | 'attention' | 'urgent';

/** One number on the dashboard, and the screen it leads to. */
export interface WorkplaceTile {
  /** Unique across every provider, e.g. 'approvals.pending'. */
  key: string;
  /** What the number is, in the reader's words. */
  label: string;
  count: number;
  /** Where the whole of it is read. */
  route: string;
  /** Lucide icon name (kebab-case) — the dashboard renders what it is given. */
  icon?: string;
  tone?: WorkplaceTone;
  /** Position in the row; ties break on key. */
  order: number;
  /**
   * The same count, split by company — what makes this dashboard say something
   * a per-company screen cannot. Optional: a provider whose data is not
   * partitioned by company (chat) simply omits it.
   */
  byCompany?: { companyId: number; count: number }[];
}

/** What a row of the "waiting on you" list can be. */
export type WorkplaceItemKind =
  'APPROVAL' | 'REVIEW' | 'TASK' | 'CIRCULAR' | 'MAIL' | 'ALERT';

/** One thing waiting for this person, wherever in the group it is. */
export interface WorkplaceItem {
  /** Unique across providers — 'approval:412', 'task:88'. Also the React key. */
  key: string;
  kind: WorkplaceItemKind;
  title: string;
  subtitle?: string | null;

  /** When it arrived. ISO. */
  at: string;
  /** When it must be answered, where there is such a date. */
  dueAt?: string | null;
  /** Past that date. Computed by the owner, which knows what late means to it. */
  overdue?: boolean;

  /** Where it is dealt with. */
  route?: string | null;
  documentId?: number | null;

  companyId?: number | null;
  branchId?: number | null;
}

export interface WorkplaceSummaryPort {
  /** Short name for logs — 'approvals', 'tasks', 'mail'. */
  readonly key: string;

  /** The counts this module contributes. Empty array is fine. */
  tiles(userId: number): Promise<WorkplaceTile[]>;

  /**
   * The individual things waiting, newest or most urgent first. `limit` is a
   * hint: the dashboard merges every provider's list and cuts the result, so
   * returning more than asked only wastes work.
   */
  waiting(userId: number, limit: number): Promise<WorkplaceItem[]>;
}
