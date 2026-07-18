import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchHold,
  ItemStockOnHand,
  ReservationDetail,
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
   * On-hand per raw-material Item, optionally at one store. Raw materials carry
   * no reservations, so on-hand IS available. Mirrors onHandFor but keyed on the
   * item side of the ledger (StockBatch/StockLedger carry itemId OR productId).
   */
  async onHandForItems(
    companyId: number,
    itemIds: number[],
    storeId?: number,
  ): Promise<ItemStockOnHand[]> {
    const ids = [...new Set(itemIds)];
    if (!ids.length) return [];

    const [ledger, items] = await Promise.all([
      this.prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          companyId,
          itemId: { in: ids },
          ...(storeId ? { storeId } : {}),
        },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      this.prisma.item.findMany({
        where: { id: { in: ids } },
        select: { id: true, unitId: true },
      }),
    ]);

    const onHandOf = new Map(
      ledger.map((r) => [r.itemId!, (r._sum.qtyIn ?? 0) - (r._sum.qtyOut ?? 0)]),
    );
    const unitOf = new Map(items.map((i) => [i.id, i.unitId]));

    return ids.map((itemId) => ({
      itemId,
      onHand: onHandOf.get(itemId) ?? 0,
      unitId: unitOf.get(itemId) ?? null,
    }));
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

  /**
   * ACTIVE holds on any of these batches — what a caller must clear before it
   * may destroy them. See StockPort.holdsOnBatches for why this matters.
   */
  async holdsOnBatches(batchIds: number[]): Promise<BatchHold[]> {
    const ids = [...new Set(batchIds)];
    if (!ids.length) return [];

    const holds = await this.prisma.stockReservation.groupBy({
      by: ['batchId', 'documentType', 'documentId'],
      where: { batchId: { in: ids }, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    if (!holds.length) return [];

    const batches = await this.prisma.stockBatch.findMany({
      where: { id: { in: holds.map((h) => h.batchId) } },
      select: { id: true, batchNo1: true },
    });
    const noOf = new Map(batches.map((b) => [b.id, b.batchNo1]));

    return holds.map((h) => ({
      batchId: h.batchId,
      batchNo: noOf.get(h.batchId) ?? `#${h.batchId}`,
      quantity: h._sum.quantity ?? 0,
      documentType: h.documentType,
      documentId: h.documentId,
    }));
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

  /**
   * Every hold of a document at batch grain, carrying each batch's prices.
   *
   * The prices live on the batch's inbound LEDGER row, not on StockBatch (which
   * is only a label) — they were captured there when the stock came in. One
   * batch is created per goods-in line, so that inbound row is unique per batch
   * and its prices are the batch's prices.
   */
  async reservationDetailFor(
    documentType: string,
    documentId: number,
  ): Promise<ReservationDetail[]> {
    const holds = await this.prisma.stockReservation.groupBy({
      by: ['documentLineId', 'productId', 'batchId'],
      where: { documentType, documentId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    if (!holds.length) return [];

    const batchIds = [...new Set(holds.map((h) => h.batchId))];
    const [batches, inbound] = await Promise.all([
      this.prisma.stockBatch.findMany({
        where: { id: { in: batchIds } },
        select: {
          id: true,
          batchNo1: true,
          batchNo2: true,
          expiryDate: true,
        },
      }),
      // The prices the stock arrived at. qtyIn > 0 picks the receipt row.
      this.prisma.stockLedger.findMany({
        where: { batchId: { in: batchIds }, qtyIn: { gt: 0 } },
        select: {
          batchId: true,
          intercompanyPrice: true,
          wholesalePrice: true,
          retailPrice: true,
        },
      }),
    ]);
    const batchOf = new Map(batches.map((b) => [b.id, b]));
    const pricesOf = new Map(inbound.map((l) => [l.batchId!, l]));

    return holds
      .map((h) => {
        const b = batchOf.get(h.batchId);
        const p = pricesOf.get(h.batchId);
        return {
          lineId: h.documentLineId,
          productId: h.productId,
          batchId: h.batchId,
          batchNo: b?.batchNo1 ?? `#${h.batchId}`,
          supplierBatchNo: b?.batchNo2 ?? null,
          expiryDate: b?.expiryDate?.toISOString() ?? null,
          quantity: h._sum.quantity ?? 0,
          intercompanyPrice: p?.intercompanyPrice ?? 0,
          wholesalePrice: p?.wholesalePrice ?? 0,
          retailPrice: p?.retailPrice ?? 0,
          _expiry: b?.expiryDate ?? null,
        };
      })
      // Same order FEFO allocated in, so the document reads the way it was filled.
      .sort((a, b) => {
        if (a.lineId !== b.lineId) return a.lineId - b.lineId;
        if (a._expiry && b._expiry) {
          const d = a._expiry.getTime() - b._expiry.getTime();
          if (d !== 0) return d;
        } else if (a._expiry) return -1;
        else if (b._expiry) return 1;
        return a.batchId - b.batchId;
      })
      .map(({ _expiry, ...rest }) => rest);
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
