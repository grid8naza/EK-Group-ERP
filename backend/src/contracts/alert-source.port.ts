/**
 * Port — how a module contributes alerts that nothing TRIGGERS (SRS §8.11,
 * FR-COM-05).
 *
 * Most alerts hang off an action: a document is submitted, a task is assigned,
 * and the code doing it publishes through NOTIFICATION on the spot. But some of
 * the conditions the SRS names — stock under its reorder level, a batch nearing
 * expiry, a task falling overdue — are true because time passed and nobody did
 * anything. Nothing calls a handler for those; somebody has to go and look.
 *
 * So a module owning such a condition implements this port, and the
 * notification module runs every registered source on a timer. Registered as a
 * multi-provider array in contracts/contracts.module.ts exactly like
 * METRIC_PROVIDER (NestJS has no Angular-style multi-providers), so the scanner
 * injects them ALL and imports no feature module.
 *
 * A `scan` must be IDEMPOTENT and must describe the world as it is right now:
 * publish what is true (the notification module dedupes on sourceKey, so
 * re-publishing an alert that already stands does nothing), and call
 * `resolveMissing` for what it no longer finds. Written that way, a scan that
 * is missed, run twice, or run after a restart still leaves the bell correct.
 */

/** DI token for alert sources. Inject the array with `@Inject(ALERT_SOURCE)`. */
export const ALERT_SOURCE = Symbol('ALERT_SOURCE');

export interface AlertSourcePort {
  /** Short name for the log line — 'stock', 'task'. */
  readonly key: string;

  /**
   * Look at the world and make the alerts match it. Called on a timer; may be
   * called at any moment, including concurrently with the events that would
   * have published the same alerts.
   */
  scan(): Promise<void>;
}
