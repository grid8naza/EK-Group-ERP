import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChecklistService } from './checklist.service';

/** Default gap between passes. Overridden by CHECKLIST_SCAN_MINUTES. */
const DEFAULT_MINUTES = 5;

/** How long to wait after boot before the first pass, so it joins no queue. */
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * Raises recurring checklists when their time of day comes round (SRS §8.12,
 * FR-TSK-02).
 *
 * A plain interval rather than a cron package, for the reason the alert scanner
 * gives: `@nestjs/schedule` is a dependency, and the dev compose keeps
 * node_modules in an anonymous volume, so every added package costs each
 * developer an image rebuild.
 *
 * FIVE minutes, not the alert sweep's fifteen. A checklist is bound to a clock —
 * somebody is told to start at six — and a quarter of an hour of slack on that is
 * noticeable in a way that "stock is low" is not.
 *
 * SINGLE-INSTANCE, like the alert scanner, but harmless if that stops being
 * true: two replicas would both look, and the unique (templateId, occurrenceOn)
 * means only one of them can raise the day's occurrence.
 */
@Injectable()
export class ChecklistSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChecklistSchedulerService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  /** Guards against a slow pass overlapping the next tick. */
  private running = false;

  constructor(private readonly checklists: ChecklistService) {}

  onModuleInit(): void {
    if (process.env.CHECKLIST_SCAN_ENABLED === 'false') {
      this.logger.log(
        'recurring checklists disabled (CHECKLIST_SCAN_ENABLED=false)',
      );
      return;
    }
    const minutes =
      Number(process.env.CHECKLIST_SCAN_MINUTES) || DEFAULT_MINUTES;
    const every = Math.max(minutes, 1) * 60_000;

    this.timer = setTimeout(() => {
      void this.pass();
      this.interval = setInterval(() => void this.pass(), every);
    }, FIRST_RUN_DELAY_MS);

    this.logger.log(`recurring checklists armed: every ${minutes} min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
  }

  private async pass(): Promise<void> {
    if (this.running) {
      this.logger.warn('previous checklist pass still running — skipping');
      return;
    }
    this.running = true;
    try {
      const raised = await this.checklists.runDue();
      // Quiet unless something happened: this runs 288 times a day.
      if (raised) this.logger.log(`raised ${raised} recurring checklist(s)`);
    } catch (e) {
      this.logger.error(`checklist pass failed: ${String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
