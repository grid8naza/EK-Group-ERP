import { Module } from '@nestjs/common';
import { CostCenterService } from './cost-center.service';
import { CostCenterController } from './cost-center.controller';

@Module({
  controllers: [CostCenterController],
  providers: [CostCenterService],
})
export class CostCenterModule {}
