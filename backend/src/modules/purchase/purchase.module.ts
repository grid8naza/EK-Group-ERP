import { Module } from '@nestjs/common';
import { LpoController } from './lpo.controller';
import { LpoService } from './lpo.service';

@Module({
  controllers: [LpoController],
  providers: [LpoService],
})
export class PurchaseModule {}
