import { Module } from '@nestjs/common';
import { WorkplaceController } from './workplace.controller';
import { WorkplaceService } from './workplace.service';

/**
 * The Workplace dashboard — the one module in the Workplace surface that owns no
 * data at all.
 *
 * It has no Prisma models and no tables. Everything it shows belongs to mail,
 * chat, tasks, circulars, broadcasts, alerts and the approval engine, and it
 * reaches all of them through the WORKPLACE_SUMMARY port array — so it imports
 * none of them, and each keeps its own visibility rules.
 */
@Module({
  controllers: [WorkplaceController],
  providers: [WorkplaceService],
})
export class WorkplaceModule {}
