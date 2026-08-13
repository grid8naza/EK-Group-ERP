import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

/**
 * Task management — part of the Workplace module's surface (SRS §8.12), served
 * from its own NestJS module so mail, chat and the approval engine stay
 * separable from it. Reads people through the USER_LOOKUP port, so it imports
 * no other feature module.
 */
@Module({
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
