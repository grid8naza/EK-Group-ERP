import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ALERT_SOURCE,
  AlertSourcePort,
} from '../../contracts/alert-source.port';

/** Default gap between sweeps. Overridden by ALERT_SCAN_MINUTES. */
const DEFAULT_MINUTES = 15;

/**
 * How long to wait after boot before the first sweep. The scaffold sync, the
 * chart-of-accounts seed and Prisma's first connection all happen in the same
 * few seconds; a stock scan joining that queue would only slow the app's first
 * useful response.
 */
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Runs every registered ALERT_SOURCE on a timer (SRS §8.11, FR-COM-05).
 *
 * The alerts the SRS asks for divide in two. Most hang off an action — a
 * document is submitted, a task is assigned — and the code doing it publishes on
 * the spot. But stock falling under its reorder level, a batch approaching
 * expiry and a task going overdue are true because TIME PASSED: no request runs,
 * no handler fires, and the only way anybody learns of them is if something goes
 * and looks. That is this class.
 *
 * A plain interval rather than a cron package, deliberately: `@nestjs/schedule`
 * is a dependency, and the dev compose keeps node_modules in an anonymous volume,
 * so every added package costs an image rebuild for each developer (the same
 * reasoning that made chat use SSE). An interval also survives a restart
 * correctly here, because every source is written to describe the world as it is
 * now rather than to react to a moment — a missed sweep costs a delay, never a
 * lost alert.
 *
 * SINGLE-INSTANCE, like the SSE hub: two replicas would both sweep. That is not
 * harmful — publishing is idempotent on sourceKey — but it is wasted work, and
 * the fix when it matters is a lock, in this file only.
 */
@Injectable()
export class NotificationScannerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationScannerService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  /** Guards against a slow sweep overlapping the next tick. */
  private running = false;

  constructor(
    @Inject(ALERT_SOURCE) private readonly sources: AlertSourcePort[],
  ) {}

  onModuleInit(): void {
    if (process.env.ALERT_SCAN_ENABLED === 'false') {
      this.logger.log('alert scanning disabled (ALERT_SCAN_ENABLED=false)');
      return;
    }
    const minutes = Number(process.env.ALERT_SCAN_MINUTES) || DEFAULT_MINUTES;
    const every = Math.max(minutes, 1) * 60_000;

    this.timer = setTimeout(() => {
      void this.sweep();
      this.interval = setInterval(() => void this.sweep(), every);
    }, FIRST_RUN_DELAY_MS);

    this.logger.log(
      `alert scanner armed: ${this.sources.length} source(s), every ${minutes} min`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
  }

  /**
   * One pass over every source. Sources run in sequence, not in parallel: they
   * are background work sharing a connection pool with the people actually using
   * the application, and finishing a minute later costs nobody anything.
   */
  async sweep(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'previous alert sweep still running — skipping this one',
      );
      return;
    }
    this.running = true;
    try {
      for (const source of this.sources) {
        try {
          await source.scan();
        } catch (e) {
          // One broken source must not stop the others: a failing stock query
          // cannot be allowed to silence overdue tasks.
          this.logger.error(
            `alert source "${source.key}" failed: ${String(e)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
