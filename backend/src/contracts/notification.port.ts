/**
 * Port — how ANY module raises an alert for people, without knowing who they
 * are, how they are reached, or whether they are logged in (SRS §8.11,
 * FR-COM-05). Implemented by the notification module; bound in
 * contracts.module.ts.
 *
 * The point of the port is that a publisher says only WHAT HAPPENED. It does
 * not resolve recipients (name an audience and the notification module resolves
 * it through USER_LOOKUP), it does not decide delivery (in-app now, browser and
 * mobile push through the same rows later), and it does not know whether the
 * reader has muted the category. Every one of those is a fact the publisher
 * would get wrong, and would then get wrong differently in each module.
 *
 * Rules: small, serializable shapes only; methods async; never leak Prisma types.
 */

/** DI token for the notification port. Inject with `@Inject(NOTIFICATION)`. */
export const NOTIFICATION = Symbol('NOTIFICATION');

/** Mirrors the NotificationCategory enum, as plain strings across the boundary. */
export type NotificationCategoryKey =
  | 'APPROVAL'
  | 'TASK'
  | 'STOCK'
  | 'EXPIRY'
  | 'PAYMENT'
  | 'LEAVE'
  | 'MESSAGE'
  | 'SYSTEM';

/** Mirrors NotificationPriority. */
export type NotificationPriorityKey = 'NORMAL' | 'IMPORTANT' | 'URGENT';

/**
 * Who an alert is for.
 *
 * Named people when the publisher knows them (an approver, an assignee), and a
 * MODULE ROLE when it does not: "whoever may work in Inventory at this company"
 * is the honest audience for a stock-out, and it is the user module's fact to
 * answer, not the stock module's. Resolving it here rather than in the
 * publisher is what stops six modules each inventing their own idea of who
 * ought to be told.
 */
export type NotificationAudience =
  | { userIds: number[] }
  | {
      /** Everybody with effective access to this module, in this company. */
      companyId: number;
      /** Module CODE (e.g. 'INVENTORY') — publishers don't hold module ids. */
      moduleCode: string;
    };

/** One thing that happened, and who should hear about it. */
export interface PublishNotification {
  audience: NotificationAudience;
  category: NotificationCategoryKey;
  priority?: NotificationPriorityKey;
  /** A few words. Shown as the bell row's heading. */
  title: string;
  /** One or two sentences of PLAIN text — the bell renders no markup. */
  body: string;

  /** Screen route + row the alert opens, when there is one to open. */
  route?: string | null;
  documentId?: number | null;

  /** Where it happened — a stamp for display, never a filter. */
  companyId?: number | null;
  branchId?: number | null;

  /**
   * Stable identity of the condition, e.g. `workflow:task:412`. Publishing the
   * same key again while a live alert holds it is a no-op, which is what lets a
   * scanner re-run every few minutes; `resolve` with the same key takes it off
   * the bell when the condition ends. Omit for a one-off that is true once.
   */
  sourceKey?: string | null;

  /**
   * Whoever caused it. Dropped from the audience — a person who just assigned a
   * task does not need telling that a task was assigned.
   */
  excludeUserId?: number | null;
}

export interface NotificationPort {
  /**
   * Raise an alert. Returns how many people it actually reached, after the
   * audience is resolved, the actor is excluded, mutes are applied and existing
   * live alerts on the same sourceKey are skipped. Zero is an ordinary answer,
   * not a failure.
   */
  publish(input: PublishNotification): Promise<number>;

  /**
   * The condition ended: take every live alert on these keys off the bell. Safe
   * to call for keys that were never published, and safe to call twice.
   */
  resolve(sourceKeys: string[]): Promise<void>;

  /**
   * Resolve everything under a key PREFIX — for a scanner clearing what it no
   * longer finds. `stock:low:3:` drops that company's stock alerts in one call,
   * without the scanner having to remember what it published last time.
   *
   * `keep` names the keys that are still true and must survive.
   */
  resolveMissing(prefix: string, keep: string[]): Promise<void>;
}
