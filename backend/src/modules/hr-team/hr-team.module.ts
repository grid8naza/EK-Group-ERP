import { Module } from '@nestjs/common';
import { HrTeamService } from './hr-team.service';
import { HrTeamController } from './hr-team.controller';

/**
 * Teams — the working groups a branch marks its attendance in, and the leader
 * who answers for each. A master of its own: attendance reads it (as every
 * module here reads the tables of the domains it works with) and imports
 * nothing from it.
 */
@Module({
  controllers: [HrTeamController],
  providers: [HrTeamService],
})
export class HrTeamModule {}
