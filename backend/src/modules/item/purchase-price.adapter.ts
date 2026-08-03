import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PurchasedAt,
  PurchasePricePort,
  PurchasePriceRaise,
} from '../../contracts/purchase-price.port';

/**
 * The Item module's implementation of PurchasePricePort — lets the Goods Receipt
 * Note raise what an item last cost WITHOUT importing this module. Bound to the
 * PURCHASE_PRICE token in contracts.module.ts.
 */
@Injectable()
export class PurchasePriceAdapter implements PurchasePricePort {
  constructor(private readonly prisma: PrismaService) {}

  async raiseLastPurchasePrice(
    lines: PurchasedAt[],
  ): Promise<PurchasePriceRaise[]> {
    // One receipt can carry the same item on several lines; the highest rate on
    // the document is the one that counts.
    const highest = new Map<number, number>();
    for (const l of lines) {
      if (!Number.isFinite(l.itemId) || !(l.unitPrice > 0)) continue;
      const cur = highest.get(l.itemId);
      if (cur == null || l.unitPrice > cur) highest.set(l.itemId, l.unitPrice);
    }
    if (!highest.size) return [];

    const items = await this.prisma.item.findMany({
      where: { id: { in: [...highest.keys()] } },
      select: { id: true, name: true, lastPurchasePrice: true },
    });

    const raises: PurchasePriceRaise[] = [];
    for (const item of items) {
      const paid = highest.get(item.id)!;
      const from = item.lastPurchasePrice ?? 0;
      // Strictly higher only — an equal rate is not a change, and a lower one is
      // ignored by design (see the port).
      if (paid <= from) continue;
      raises.push({ itemId: item.id, itemName: item.name, from, to: paid });
    }
    if (!raises.length) return [];

    await this.prisma.$transaction(
      raises.map((r) =>
        this.prisma.item.update({
          where: { id: r.itemId },
          data: { lastPurchasePrice: r.to },
        }),
      ),
    );
    return raises;
  }
}
