import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** One cost object's production activity over the period. */
export interface CostObjectPerformance {
  costCenterId: number | null;
  costCenterName: string;
  costObjectId: number | null;
  costObjectName: string;
  /** Finished goods banked into stock (PRODUCTION rows). */
  producedQty: number;
  producedValue: number;
  /** Raw materials issued to production against it (CONSUMPTION rows). */
  consumedQty: number;
  consumedValue: number;
  /** Goods shipped out against it (SALE rows). */
  soldQty: number;
  soldValue: number;
  /** Documents touching it — how busy the cost object was. */
  documentCount: number;
}

/** Movement types the report reads, and which bucket each falls in. */
const BUCKETS = {
  PRODUCTION: 'produced',
  CONSUMPTION: 'consumed',
  SALE: 'sold',
} as const;

const UNASSIGNED = '— Unassigned —';

/**
 * Production performance by cost centre / cost object, from Production's own
 * data — the stock ledger.
 *
 * Every movement that matters is already a ledger row carrying the costing it
 * was traced against (see StockLedger.costCenterId / costObjectId), so this is
 * one query rather than a union across the production documents. Movements with
 * no costing are reported under "Unassigned" rather than dropped: a product
 * someone forgot to cost should be visible, not silently missing from the
 * totals.
 *
 * This is the production-side view. The accounts-side view of the same
 * dimensions belongs to the Accounts module, which does not exist yet.
 */
@Injectable()
export class ProductionPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async byCostObject(
    companyId: number | undefined,
    branchId: number | undefined,
    from?: string,
    to?: string,
  ): Promise<CostObjectPerformance[]> {
    if (!companyId) return [];

    // `to` is inclusive: callers pass a date, not an instant, so take anything
    // before the start of the following day.
    const toEnd = to ? new Date(to) : undefined;
    if (toEnd) toEnd.setDate(toEnd.getDate() + 1);

    const rows = await this.prisma.stockLedger.findMany({
      where: {
        companyId,
        ...(branchId ? { branchId } : {}),
        transactionType: { in: Object.keys(BUCKETS) as (keyof typeof BUCKETS)[] },
        ...(from || toEnd
          ? {
              date: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(toEnd ? { lt: toEnd } : {}),
              },
            }
          : {}),
      },
      select: {
        costCenterId: true,
        costObjectId: true,
        transactionType: true,
        documentId: true,
        documentNo: true,
        qtyIn: true,
        qtyOut: true,
        costPrice: true,
        unitPrice: true,
      },
    });

    // Resolve the names once, from the ids actually present.
    const centreIds = [
      ...new Set(rows.map((r) => r.costCenterId).filter((n): n is number => n != null)),
    ];
    const objectIds = [
      ...new Set(rows.map((r) => r.costObjectId).filter((n): n is number => n != null)),
    ];
    const [centres, objects] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { id: { in: centreIds } },
        select: { id: true, name: true },
      }),
      this.prisma.costObject.findMany({
        where: { id: { in: objectIds } },
        select: { id: true, name: true },
      }),
    ]);
    const centreName = new Map(centres.map((c) => [c.id, c.name]));
    const objectName = new Map(objects.map((o) => [o.id, o.name]));

    const byKey = new Map<string, CostObjectPerformance & { docs: Set<string> }>();
    for (const r of rows) {
      const key = `${r.costCenterId ?? 'x'}:${r.costObjectId ?? 'x'}`;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          costCenterId: r.costCenterId,
          costCenterName:
            r.costCenterId != null
              ? (centreName.get(r.costCenterId) ?? `#${r.costCenterId}`)
              : UNASSIGNED,
          costObjectId: r.costObjectId,
          costObjectName:
            r.costObjectId != null
              ? (objectName.get(r.costObjectId) ?? `#${r.costObjectId}`)
              : UNASSIGNED,
          producedQty: 0,
          producedValue: 0,
          consumedQty: 0,
          consumedValue: 0,
          soldQty: 0,
          soldValue: 0,
          documentCount: 0,
          docs: new Set<string>(),
        };
        byKey.set(key, acc);
      }
      // Quantity is whichever side the movement used; value is costed at the
      // rate stamped on the row, falling back to the line's unit price.
      const qty = r.qtyIn > 0 ? r.qtyIn : r.qtyOut;
      const rate = r.costPrice || r.unitPrice || 0;
      const bucket = BUCKETS[r.transactionType as keyof typeof BUCKETS];
      acc[`${bucket}Qty`] += qty;
      acc[`${bucket}Value`] += qty * rate;
      acc.docs.add(`${r.transactionType}:${r.documentId}`);
    }

    return [...byKey.values()]
      .map(({ docs, ...rest }) => ({ ...rest, documentCount: docs.size }))
      .sort(
        (a, b) =>
          a.costCenterName.localeCompare(b.costCenterName) ||
          a.costObjectName.localeCompare(b.costObjectName),
      );
  }
}
