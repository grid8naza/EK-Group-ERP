import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationScannerService } from './notification-scanner.service';

/**
 * Alerts and push (SRS §8.11, FR-COM-05 / FR-COM-06) — part of the Workplace
 * module's surface, served from its own NestJS module so mail, chat, tasks and
 * the approval engine stay separable from it.
 *
 * This module serves the READER: the bell, the Alerts screen, the live stream
 * and the mute settings. PUBLISHERS never come here — they reach the same
 * service through the NOTIFICATION port, which is bound (with its own instance
 * of the service, both stateless bar the SSE hub) in contracts.module.ts. That
 * is what lets Inventory raise a stock alert without importing anything of this.
 *
 * The SSE hub is bound there too, so the instance the port publishes through and
 * the instance this controller streams from are the SAME hub — two would leave
 * a bell that only updates when the reader's own tab caused the alert.
 */
@Module({
  controllers: [NotificationController],
  providers: [NotificationScannerService],
})
export class NotificationModule {}
