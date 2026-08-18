import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDayMonthYear } from '../../common/zoned-time';
import { AlertSourcePort } from '../../contracts/alert-source.port';
import {
  NOTIFICATION,
  NotificationPort,
} from '../../contracts/notification.port';

/** The module whose people are told. An operational alert has no addressee. */
const INVENTORY = 'INVENTORY';

/** Screens the alerts open. There is no stock-balance screen to send them to. */
const ITEMS_ROUTE = '/inventory/items';
const PRODUCTS_UNPACKED_ROUTE = '/inventory/products-unpacked';
const PRODUCTS_PACKED_ROUTE = '/inventory/products-packed';

/** Key namespaces — one owner each, so a sweep can clear its own by exclusion. */
const LOW_NAMESPACE = 'stock:low:';
const EXPIRY_NAMESPACE = 'stock:expiry:';

/** How far ahead expiry looks, unless ALERT_EXPIRY_DAYS says otherwise. */
const DEFAULT_EXPIRY_DAYS = 30;

/** Below this, a balance is treated as nothing rather than as a rounding crumb. */
const EPSILON = 0.0001;

/**
 * The Stock module's alert source — what is running out, and what is going off
 * (SRS §8.11, FR-COM-05: "stock-out ... expiry").
 *
 * Both conditions are true because time passed, not because anybody did
 * anything, so they are swept for on the notification module's timer rather than
 * raised from a handler. Registered in contracts/contracts.module.ts.
 *
 * It lives HERE, in the module that owns the ledger, and not in the notification
 * module, because "what is on hand" is a stock question — the same reason
 * onHandFor lives beside it. The reorder levels and expiry dates it reads sit in
 * the same schema domain (inventory.prisma); nothing is imported from another
 * module.
 *
 * WHO IS TOLD is the interesting part. A stock-out has no addressee — nobody
 * caused it and it is not "for" anyone — so the audience is the honest one:
 * everybody who may work in Inventory at that company. The notification module
 * resolves that through USER_LOOKUP; this class never learns who they are.
 *
 * Two rules keep the sweep from becoming noise:
 *  - **Only stock this company has actually held.** A company with no ledger
 *    history for an item is not warned that it has none: on a fresh database
 *    every item in the master would be "below reorder level", and a bell that
 *    opens with four hundred rows is a bell nobody looks at again.
 *  - **Only batches with something left in them.** An expired batch that was
 *    consumed months ago is history, not a warning.
 */
@Injectable()
export class StockAlertsAdapter implements AlertSourcePort {
  readonly key = 'stock';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION) private readonly notifications: NotificationPort,
  ) {}

  async scan(): Promise<void> {
    // The companies that have stock, taken from the ledger itself rather than
    // from the company master — a company with no movements has nothing this
    // sweep could say, and the ledger is this module's own table.
    const companies = (
      await this.prisma.stockLedger.findMany({
        distinct: ['companyId'],
        select: { companyId: true },
      })
    ).map((r) => r.companyId);

    const lowKeys: string[] = [];
    const expiryKeys: string[] = [];
    for (const companyId of companies) {
      lowKeys.push(...(await this.scanLowStock(companyId)));
      expiryKeys.push(...(await this.scanExpiry(companyId)));
    }

    // What is no longer true — replenished, re-levelled, consumed, deleted —
    // leaves the bell, without this class remembering what it published last
    // time. Each namespace is swept separately because each has one owner.
    await this.notifications.resolveMissing(LOW_NAMESPACE, lowKeys);
    await this.notifications.resolveMissing(EXPIRY_NAMESPACE, expiryKeys);
  }

  // ------------------------------------------------------------ stock-out --

  /** Raw materials and packing materials under their level. Returns live keys. */
  private async scanLowStock(companyId: number): Promise<string[]> {
    const keys: string[] = [];

    // What this company holds, per item. The groupBy IS the filter: an item with
    // no row here has never moved for this company.
    const held = await this.prisma.stockLedger.groupBy({
      by: ['itemId'],
      where: { companyId, itemId: { not: null } },
      _sum: { qtyIn: true, qtyOut: true },
    });
    if (!held.length) return keys;

    const onHandOf = new Map(
      held.map((r) => [r.itemId!, (r._sum.qtyIn ?? 0) - (r._sum.qtyOut ?? 0)]),
    );

    const items = await this.prisma.item.findMany({
      where: { id: { in: [...onHandOf.keys()] }, isActive: true },
      select: {
        id: true,
        name: true,
        minimumStock: true,
        reorderLevel: true,
        unit: { select: { symbol: true, code: true } },
      },
    });

    for (const item of items) {
      // The reorder level is the trigger; the minimum is the floor. Whichever is
      // set is the line, and the higher one wins when both are — warning at the
      // lower of the two would mean the higher was never a level at all.
      const level = Math.max(item.reorderLevel ?? 0, item.minimumStock ?? 0);
      if (level <= 0) continue;

      const onHand = onHandOf.get(item.id) ?? 0;
      if (onHand > level) continue;

      const out = onHand <= EPSILON;
      const unit = item.unit?.symbol || item.unit?.code || '';
      const key = `${LOW_NAMESPACE}${companyId}:item:${item.id}`;
      keys.push(key);

      await this.notifications.publish({
        audience: { companyId, moduleCode: INVENTORY },
        category: 'STOCK',
        priority: out ? 'URGENT' : 'IMPORTANT',
        title: out ? 'Out of stock' : 'Stock below reorder level',
        body: out
          ? `${item.name} has run out (reorder level ${fmt(level)} ${unit}).`
          : `${item.name} is down to ${fmt(onHand)} ${unit} — reorder level ${fmt(level)} ${unit}.`,
        route: ITEMS_ROUTE,
        companyId,
        sourceKey: key,
      });
    }

    keys.push(...(await this.scanLowProducts(companyId)));
    return keys;
  }

  /**
   * Finished and semi-finished products under their level.
   *
   * Per BRANCH, not per company, because that is where the level is set
   * (ProductBranchStock): the counter at Kadathy running out is a Kadathy fact,
   * and totalling the group's stock would hide it behind a full factory store.
   */
  private async scanLowProducts(companyId: number): Promise<string[]> {
    const keys: string[] = [];

    const held = await this.prisma.stockLedger.groupBy({
      by: ['productId', 'branchId'],
      where: { companyId, productId: { not: null }, branchId: { not: null } },
      _sum: { qtyIn: true, qtyOut: true },
    });
    if (!held.length) return keys;

    const levels = await this.prisma.productBranchStock.findMany({
      where: {
        productId: { in: held.map((h) => h.productId!) },
        branchId: { in: held.map((h) => h.branchId!) },
      },
      select: {
        productId: true,
        branchId: true,
        minStock: true,
        reorderLevel: true,
      },
    });
    if (!levels.length) return keys;
    const levelOf = new Map(
      levels.map((l) => [
        `${l.productId}:${l.branchId}`,
        Math.max(l.reorderLevel ?? 0, l.minStock ?? 0),
      ]),
    );

    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(levels.map((l) => l.productId))] } },
      select: {
        id: true,
        name: true,
        hasPacking: true,
        unit: { select: { symbol: true, code: true } },
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const row of held) {
      const productId = row.productId!;
      const branchId = row.branchId!;
      const level = levelOf.get(`${productId}:${branchId}`) ?? 0;
      if (level <= 0) continue;

      const onHand = (row._sum.qtyIn ?? 0) - (row._sum.qtyOut ?? 0);
      if (onHand > level) continue;

      const product = productById.get(productId);
      if (!product) continue;

      const out = onHand <= EPSILON;
      const unit = product.unit?.symbol || product.unit?.code || '';
      const key = `${LOW_NAMESPACE}${companyId}:product:${productId}:${branchId}`;
      keys.push(key);

      await this.notifications.publish({
        audience: { companyId, moduleCode: INVENTORY },
        category: 'STOCK',
        priority: out ? 'URGENT' : 'IMPORTANT',
        title: out ? 'Out of stock' : 'Stock below reorder level',
        body: out
          ? `${product.name} has run out at this branch (reorder level ${fmt(level)} ${unit}).`
          : `${product.name} is down to ${fmt(onHand)} ${unit} at this branch — reorder level ${fmt(level)} ${unit}.`,
        route: product.hasPacking
          ? PRODUCTS_PACKED_ROUTE
          : PRODUCTS_UNPACKED_ROUTE,
        companyId,
        // Stamped so the reader is told WHICH branch by the alert itself rather
        // than by a sentence that would have to name it.
        branchId,
        sourceKey: key,
      });
    }

    return keys;
  }

  // --------------------------------------------------------------- expiry --

  /** Batches at or near their expiry date with stock still in them. */
  private async scanExpiry(companyId: number): Promise<string[]> {
    const keys: string[] = [];
    const days = Number(process.env.ALERT_EXPIRY_DAYS) || DEFAULT_EXPIRY_DAYS;
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 86_400_000);

    const batches = await this.prisma.stockBatch.findMany({
      where: { companyId, expiryDate: { not: null, lte: horizon } },
      select: {
        id: true,
        batchNo1: true,
        expiryDate: true,
        itemId: true,
        productId: true,
      },
    });
    if (!batches.length) return keys;

    // What is left in each of them. A batch consumed months ago is history.
    const balances = await this.prisma.stockLedger.groupBy({
      by: ['batchId'],
      where: { companyId, batchId: { in: batches.map((b) => b.id) } },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const leftIn = new Map(
      balances.map((b) => [
        b.batchId!,
        (b._sum.qtyIn ?? 0) - (b._sum.qtyOut ?? 0),
      ]),
    );

    const [items, products] = await Promise.all([
      this.prisma.item.findMany({
        where: {
          id: { in: batches.map((b) => b.itemId).filter(Boolean) as number[] },
        },
        select: {
          id: true,
          name: true,
          unit: { select: { symbol: true, code: true } },
        },
      }),
      this.prisma.product.findMany({
        where: {
          id: {
            in: batches.map((b) => b.productId).filter(Boolean) as number[],
          },
        },
        select: {
          id: true,
          name: true,
          hasPacking: true,
          unit: { select: { symbol: true, code: true } },
        },
      }),
    ]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const batch of batches) {
      const left = leftIn.get(batch.id) ?? 0;
      if (left <= EPSILON) continue;

      const item = batch.itemId ? itemById.get(batch.itemId) : undefined;
      const product = batch.productId
        ? productById.get(batch.productId)
        : undefined;
      const name = item?.name || product?.name;
      if (!name) continue;

      const unitSrc = item?.unit || product?.unit;
      const unit = unitSrc?.symbol || unitSrc?.code || '';
      const on = formatDayMonthYear(batch.expiryDate!);
      const expired = batch.expiryDate! <= now;
      const key = `${EXPIRY_NAMESPACE}${companyId}:batch:${batch.id}`;
      keys.push(key);

      await this.notifications.publish({
        audience: { companyId, moduleCode: INVENTORY },
        category: 'EXPIRY',
        priority: expired ? 'URGENT' : 'IMPORTANT',
        title: expired ? 'Stock has expired' : 'Stock nearing expiry',
        body: expired
          ? `${name} batch ${batch.batchNo1} expired on ${on} — ${fmt(left)} ${unit} still in stock.`
          : `${name} batch ${batch.batchNo1} expires on ${on} — ${fmt(left)} ${unit} in stock.`,
        route: item
          ? ITEMS_ROUTE
          : product?.hasPacking
            ? PRODUCTS_PACKED_ROUTE
            : PRODUCTS_UNPACKED_ROUTE,
        companyId,
        sourceKey: key,
      });
    }

    return keys;
  }
}

/** Quantities as a person writes them: 12, not 12.0000000001. */
function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}
