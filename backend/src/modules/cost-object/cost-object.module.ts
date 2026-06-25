import { Module } from '@nestjs/common';
import { CostObjectService } from './cost-object.service';
import { CostObjectController } from './cost-object.controller';

@Module({
  controllers: [CostObjectController],
  providers: [CostObjectService],
})
export class CostObjectModule {}
