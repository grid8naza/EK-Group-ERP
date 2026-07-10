import { Module } from '@nestjs/common';
import { StockTransactionController } from './stock-transaction.controller';
import { StockTransactionService } from './stock-transaction.service';

@Module({
  controllers: [StockTransactionController],
  providers: [StockTransactionService],
})
export class StockTransactionModule {}
