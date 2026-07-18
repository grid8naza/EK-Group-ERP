import { Injectable } from '@nestjs/common';
import {
  ProducedBatch,
  ProductionReceiptPosting,
  StockPostingPort,
} from '../../contracts/stock-posting.port';
import { StockTransactionService } from './stock-transaction.service';

/**
 * Binds the STOCK_POSTING port to the stock-transaction module (the ledger
 * writer), so Production can bank finished goods into stock without importing
 * it. Bound in contracts.module.ts.
 */
@Injectable()
export class StockPostingAdapter implements StockPostingPort {
  constructor(private readonly service: StockTransactionService) {}

  postProductionReceipt(
    input: ProductionReceiptPosting,
  ): Promise<ProducedBatch[]> {
    return this.service.postProductionReceipt(input);
  }
}
