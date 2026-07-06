import { Module } from '@nestjs/common';
import { HrGroupService } from './hr-group.service';
import { HrGroupController } from './hr-group.controller';

@Module({
  controllers: [HrGroupController],
  providers: [HrGroupService],
})
export class HrGroupModule {}
