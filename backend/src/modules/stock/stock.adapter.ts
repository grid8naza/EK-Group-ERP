import { Injectable } from '@nestjs/common';
import {
  ReserveRequest,
  ReserveResultLine,
  ReservedForLine,
  StockOnHand,
  StockPort,
} from '../../contracts/stock.port';
import { StockService } from './stock.service';

/**
 * The Stock module's in-process implementation of StockPort — lets a business
 * module (CRM, …) ask what's on hand and hold some, WITHOUT importing this
 * module. Bound to the STOCK token in contracts.module.ts; if stock is ever
 * extracted, only that binding changes.
 */
@Injectable()
export class StockAdapter implements StockPort {
  constructor(private readonly stock: StockService) {}

  onHandFor(
    companyId: number,
    productIds: number[],
    forDocument?: { documentType: string; documentId: number },
  ): Promise<StockOnHand[]> {
    return this.stock.onHandFor(companyId, productIds, forDocument);
  }

  reserveFefo(input: ReserveRequest): Promise<ReserveResultLine[]> {
    return this.stock.reserveFefo(input);
  }

  releaseFor(
    documentType: string,
    documentId: number,
    lineIds?: number[],
  ): Promise<void> {
    return this.stock.releaseFor(documentType, documentId, lineIds);
  }

  consumeFor(documentType: string, documentId: number): Promise<void> {
    return this.stock.consumeFor(documentType, documentId);
  }

  reservedFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservedForLine[]> {
    return this.stock.reservedFor(documentType, documentId);
  }
}
