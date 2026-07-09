import { Module } from '@nestjs/common';
import { OpeningStockController } from './opening-stock.controller';
import { OpeningStockService } from './opening-stock.service';

@Module({
  controllers: [OpeningStockController],
  providers: [OpeningStockService],
})
export class OpeningStockModule {}
