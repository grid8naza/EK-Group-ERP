import { Injectable } from '@nestjs/common';
import {
  DispatchPosting,
  MaterialIssuePosting,
  PackingPosting,
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

  postPacking(input: PackingPosting): Promise<ProducedBatch[]> {
    return this.service.postPacking(input);
  }

  postMaterialIssue(input: MaterialIssuePosting): Promise<void> {
    return this.service.postMaterialIssue(input);
  }

  postDispatch(input: DispatchPosting): Promise<void> {
    return this.service.postDispatch(input);
  }
}
