import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';
import { ChecklistSchedulerService } from './checklist-scheduler.service';

/**
 * Task management — part of the Workplace module's surface (SRS §8.12), served
 * from its own NestJS module so mail, chat and the approval engine stay
 * separable from it. Reads people through the USER_LOOKUP port, so it imports
 * no other feature module.
 *
 * Recurring checklists (FR-TSK-02) live here rather than beside it, because what
 * they produce IS a task: the template raises ordinary Task rows with ordinary
 * checklist items, and its service reuses this module's own rules for who may be
 * given work and how an assignment is announced.
 */
@Module({
  controllers: [TaskController, ChecklistController],
  providers: [TaskService, ChecklistService, ChecklistSchedulerService],
})
export class TaskModule {}
