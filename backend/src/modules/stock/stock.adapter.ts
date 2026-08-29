import { Injectable } from '@nestjs/common';
import {
  BatchHold,
  ItemStockOnHand,
  ReservationDetail,
  ReserveRequest,
  ReserveResultLine,
  ReservedForLine,
  SoldQty,
  SoldQtyWindow,
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

  onHandAtBranch(
    companyId: number,
    branchId: number,
    productIds: number[],
  ): Promise<StockOnHand[]> {
    return this.stock.onHandAtBranch(companyId, branchId, productIds);
  }

  soldQtyAtBranch(
    companyId: number,
    branchId: number,
    windows: SoldQtyWindow[],
  ): Promise<SoldQty[]> {
    return this.stock.soldQtyAtBranch(companyId, branchId, windows);
  }

  onHandForItems(
    companyId: number,
    itemIds: number[],
    storeId?: number,
  ): Promise<ItemStockOnHand[]> {
    return this.stock.onHandForItems(companyId, itemIds, storeId);
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

  holdsOnBatches(batchIds: number[]): Promise<BatchHold[]> {
    return this.stock.holdsOnBatches(batchIds);
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

  reservationDetailFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservationDetail[]> {
    return this.stock.reservationDetailFor(documentType, documentId);
  }
}
