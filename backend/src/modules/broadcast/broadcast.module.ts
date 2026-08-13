import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';

/**
 * Broadcasts — part of the Workplace module's surface (SRS §8.11, FR-COM-03),
 * served from its own NestJS module so mail, chat, tasks, circulars and the
 * approval engine stay separable from it. Reads people and audiences through the
 * USER_LOOKUP port, so it imports no other feature module — including the
 * circular module, whose audience machinery it shares only by way of that port.
 */
@Module({
  controllers: [BroadcastController],
  providers: [BroadcastService],
})
export class BroadcastModule {}
