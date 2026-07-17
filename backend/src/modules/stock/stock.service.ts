import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ReserveRequest,
  ReserveResultLine,
  ReservedForLine,
  StockOnHand,
} from '../../contracts/stock.port';

/** One batch sitting in one store, with what's physically there and what's free. */
type BatchPosition = {
  batchId: number;
  storeId: number;
  onHand: number;
  reserved: number;
  free: number;
  expiryDate: Date | null;
};

/**
 * Stock questions and stock holds.
 *
 * Owns the read side of the ledger (what's on hand) and the reservation table
 * (what's promised). It does NOT move stock — StockTransaction/OpeningStock stay
 * the only writers of StockLedger. A reservation is a promise about future
 * movement, which is why it lives apart from the movements themselves.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * On-hand / reserved / available per product, across every store of the
   * company.
   *
   * There was no on-hand query in the codebase before this — only a private,
   * non-batch-aware aggregate inside the stock-transaction writer. This is the
   * general one.
   */
  async onHandFor(
    companyId: number,
    productIds: number[],
    forDocument?: { documentType: string; documentId: number },
  ): Promise<StockOnHand[]> {
    const ids = [...new Set(productIds)];
    if (!ids.length) return [];

    const [ledger, reservations, products] = await Promise.all([
      this.prisma.stockLedger.groupBy({
        by: ['productId'],
        where: { companyId, productId: { in: ids } },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      this.prisma.stockReservation.groupBy({
        by: ['productId'],
        where: {
          companyId,
          productId: { in: ids },
          status: 'ACTIVE',
          // The asker's own holds aren't competition for itself: re-reserving
          // releases them first, so they're still within its reach.
          ...(forDocument
            ? {
                NOT: {
                  documentType: forDocument.documentType,
                  documentId: forDocument.documentId,
                },
              }
            : {}),
        },
        _sum: { quantity: true },
      }),
      this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, unitId: true },
      }),
    ]);

    const onHandOf = new Map(
      ledger.map((r) => [
        r.productId!,
        (r._sum.qtyIn ?? 0) - (r._sum.qtyOut ?? 0),
      ]),
    );
    const reservedOf = new Map(
      reservations.map((r) => [r.productId, r._sum.quantity ?? 0]),
    );
    const unitOf = new Map(products.map((p) => [p.id, p.unitId]));

    // A product with no ledger history is 0, not absent — the caller wants a row
    // per line it asked about.
    return ids.map((productId) => {
      const onHand = onHandOf.get(productId) ?? 0;
      const reserved = reservedOf.get(productId) ?? 0;
      return {
        productId,
        onHand,
        reserved,
        available: onHand - reserved,
        unitId: unitOf.get(productId) ?? 0,
      };
    });
  }

  /**
   * Hold stock for a document's lines, FEFO across the company's stores.
   *
   * Runs read-allocate-write inside one transaction: unlike a stock movement,
   * which the ledger itself makes self-consistent, a reservation's correctness
   * rests entirely on nobody else allocating the same batch between our read of
   * what's free and our write of the hold.
   */
  async reserveFefo(input: ReserveRequest): Promise<ReserveResultLine[]> {
    const { companyId, userId, documentType, documentId, lines } = input;
    if (!lines.length) return [];

    return this.prisma.$transaction(async (tx) => {
      // Re-reserving must not stack on top of the last attempt, so a line's own
      // holds go back in the pool before it competes for stock again. This is
      // what makes Reserve safe to press twice.
      await tx.stockReservation.updateMany({
        where: {
          documentType,
          documentId,
          documentLineId: { in: lines.map((l) => l.lineId) },
          status: 'ACTIVE',
        },
        data: { status: 'RELEASED' },
      });

      const results: ReserveResultLine[] = [];
      for (const line of lines) {
        const want = Math.max(0, line.quantity);
        if (!want) {
          results.push({
            lineId: line.lineId,
            productId: line.productId,
            requested: 0,
            reserved: 0,
            shortfall: 0,
          });
          continue;
        }

        const positions = await this.freeBatchPositions(
          tx,
          companyId,
          line.productId,
        );

        let left = want;
        for (const pos of positions) {
          if (left <= 0) break;
          const take = Math.min(left, pos.free);
          if (take <= 0) continue;
          await tx.stockReservation.create({
            data: {
              companyId,
              storeId: pos.storeId,
              productId: line.productId,
              batchId: pos.batchId,
              quantity: take,
              documentType,
              documentId,
              documentLineId: line.lineId,
              status: 'ACTIVE',
              createdByUserId: userId,
            },
          });
          left -= take;
        }

        const reserved = want - left;
        results.push({
          lineId: line.lineId,
          productId: line.productId,
          requested: want,
          // Short is normal, not an error: it's the quantity to produce.
          reserved,
          shortfall: left,
        });
      }
      return results;
    });
  }

  async releaseFor(
    documentType: string,
    documentId: number,
    lineIds?: number[],
  ): Promise<void> {
    await this.prisma.stockReservation.updateMany({
      where: {
        documentType,
        documentId,
        status: 'ACTIVE',
        ...(lineIds ? { documentLineId: { in: lineIds } } : {}),
      },
      data: { status: 'RELEASED' },
    });
  }

  async consumeFor(documentType: string, documentId: number): Promise<void> {
    await this.prisma.stockReservation.updateMany({
      where: { documentType, documentId, status: 'ACTIVE' },
      data: { status: 'CONSUMED' },
    });
  }

  async reservedFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservedForLine[]> {
    const rows = await this.prisma.stockReservation.groupBy({
      by: ['documentLineId', 'productId'],
      where: { documentType, documentId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    return rows.map((r) => ({
      lineId: r.documentLineId,
      productId: r.productId,
      quantity: r._sum.quantity ?? 0,
    }));
  }

  // --- helpers ---

  /**
   * Every batch of a product that still has something free, oldest expiry first.
   *
   * A batch is only a LABEL — StockBatch carries no store and no quantity — so a
   * stockable position has to be derived by grouping the ledger on (batch, store)
   * and netting off the holds already placed on it.
   *
   * Expiry comes from StockBatch, never from the ledger: only inbound rows carry
   * an expiry date, so aggregating the ledger's own column would read null on
   * every issue. Expiry is also optional at goods-receipt, and a batch with no
   * date sorts LAST — no expiry means it never expires, so it should be consumed
   * after everything that does. Ties break on batchId, which is receipt order.
   */
  private async freeBatchPositions(
    tx: Prisma.TransactionClient,
    companyId: number,
    productId: number,
  ): Promise<BatchPosition[]> {
    const ledger = await tx.stockLedger.groupBy({
      by: ['batchId', 'storeId'],
      where: { companyId, productId, batchId: { not: null } },
      _sum: { qtyIn: true, qtyOut: true },
    });
    if (!ledger.length) return [];

    const held = await tx.stockReservation.groupBy({
      by: ['batchId', 'storeId'],
      where: { companyId, productId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    const heldOf = new Map(
      held.map((h) => [`${h.batchId}:${h.storeId}`, h._sum.quantity ?? 0]),
    );

    const batchIds = [...new Set(ledger.map((l) => l.batchId!))];
    const batches = await tx.stockBatch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, expiryDate: true },
    });
    const expiryOf = new Map(batches.map((b) => [b.id, b.expiryDate]));

    return ledger
      .map((l) => {
        const batchId = l.batchId!;
        const onHand = (l._sum.qtyIn ?? 0) - (l._sum.qtyOut ?? 0);
        const reserved = heldOf.get(`${batchId}:${l.storeId}`) ?? 0;
        return {
          batchId,
          storeId: l.storeId,
          onHand,
          reserved,
          free: onHand - reserved,
          expiryDate: expiryOf.get(batchId) ?? null,
        };
      })
      .filter((p) => p.free > 0)
      .sort((a, b) => {
        // FEFO. Nulls last — a batch that never expires waits its turn.
        if (a.expiryDate && b.expiryDate) {
          const d = a.expiryDate.getTime() - b.expiryDate.getTime();
          if (d !== 0) return d;
        } else if (a.expiryDate) return -1;
        else if (b.expiryDate) return 1;
        return a.batchId - b.batchId;
      });
  }
}
