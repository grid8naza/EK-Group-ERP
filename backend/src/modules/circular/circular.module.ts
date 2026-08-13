import { Module } from '@nestjs/common';
import { CircularController } from './circular.controller';
import { CircularService } from './circular.service';

/**
 * Circulars — part of the Workplace module's surface (SRS §8.11, FR-COM-04),
 * served from its own NestJS module so mail, chat, tasks and the approval engine
 * stay separable from it. Reads people and audiences through the USER_LOOKUP
 * port, so it imports no other feature module.
 */
@Module({
  controllers: [CircularController],
  providers: [CircularService],
})
export class CircularModule {}
