import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { STOCK, StockPort, SoldQtyWindow } from '../../contracts/stock.port';
import { CONTRACT, ContractPort } from '../../contracts/contract.port';
import { addDays, appTimeZone, calendarParts, zonedParts } from '../../common/zoned-time';
import { CatalogueRow, CatalogueResult } from './catalogue.dto';

/**
 * The window to average demand over when a product declares NO shelf life.
 *
 * Shelf life is what sets the window (see Product.demandCycles), so a product
 * that doesn't track one has nothing to derive it from. A month is the fallback:
 * long enough to cover a weekly rhythm several times over, short enough that a
 * seasonal shift still shows.
 */
const NO_SHELF_LIFE_WINDOW_DAYS = 30;

/** Every production-day flag, in weekday order — index 0 = Sunday, as JS counts. */
const PRODUCTION_DAY_FIELDS = [
  'prodSun',
  'prodMon',
  'prodTue',
  'prodWed',
  'prodThu',
  'prodFri',
  'prodSat',
] as const;

/** Orders still owed to the branch — a draft counts, it is demand already voiced. */
const OPEN_ORDER_STATUSES = ['DRAFT', 'PLACED', 'APPROVED'] as const;

/**
 * The Order Catalogue — the picture a branch orders from.
 *
 * Rather than naming products one line at a time on a blank ICPO, the branch
 * manager is shown everything the supplier sells, each with its picture, its
 * price, what the branch must keep, what it actually has, and how much to order.
 * The ICPO is then raised from what they ticked.
 *
 * The suggestion is the point of the screen, and it is built from four figures:
 *
 *   average daily sales  measured over the product's OWN window — its shelf life
 *                        multiplied by `demandCycles`. A 7-day bun read over 3
 *                        cycles is judged on the last 21 days; a 30-day cake on
 *                        the last 90. One fixed window for every product would
 *                        tell you nothing about either.
 *   cover days           how long this delivery has to last: the gap to the NEXT
 *                        day the supplier makes the product. Ordering a 3-day
 *                        gap's worth on a Friday and a 1-day gap's worth on a
 *                        Monday is the whole difference between a full shelf and
 *                        a stockout over the weekend. Capped at the shelf life,
 *                        because stock that outlives the goods is waste, not
 *                        cover.
 *   available            what the branch already holds, net of its own holds.
 *   min stock            the level the branch keeps, subtracted as the buffer it
 *                        already counts on having.
 *   PO qty               what outside CUSTOMERS have ordered from this branch
 *                        for that day. ADDED, not netted: a caterer's bread is
 *                        owed to the caterer and cannot also be the bread on the
 *                        shelf.
 *   contract qty         what the supply contracts oblige that day, read through
 *                        the CONTRACT port. Added for the same reason.
 *
 *   suggested = (cover x average) - min stock - available + PO + contract
 *
 * `on order` — what is already coming on an open ICPO — is shown but NOT netted
 * off, matching the formula asked for. A branch that has already ordered today
 * will see the same suggestion again, so the column is there to be read.
 *
 * Everything here is READ-ONLY. Ticking quantities and pressing Create raises an
 * ordinary ICPO through the existing endpoint, so the approval workflow, the
 * numbering and the creator gate all still apply — the catalogue is a way of
 * filling the form in, not a second way of ordering.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STOCK) private readonly stock: StockPort,
    @Inject(CONTRACT) private readonly contracts: ContractPort,
  ) {}

  /**
   * The catalogue of one SUPPLIER company, priced and measured for ONE BRANCH of
   * the buying company.
   *
   * The branch is the active one and is not a parameter the caller may vary: an
   * ICPO belongs to the branch that raised it, and figures for a branch you
   * cannot order for would only mislead.
   *
   * `deliveryDate` (YYYY-MM-DD) is the day the goods are wanted — it decides the
   * cover days, since the gap to the next production run is measured from it.
   * Defaults to tomorrow.
   */
  async forSupplier(
    companyId: number,
    branchId: number | undefined,
    supplierCompanyId: number,
    deliveryDate?: string,
  ): Promise<CatalogueResult> {
    if (!companyId) {
      throw new BadRequestException('No active company.');
    }
    if (!branchId) {
      throw new BadRequestException(
        'The catalogue is read for a branch — select an active branch first.',
      );
    }
    if (!Number.isInteger(supplierCompanyId) || supplierCompanyId <= 0) {
      throw new BadRequestException('Choose a supplier company.');
    }
    if (supplierCompanyId === companyId) {
      throw new BadRequestException(
        'Choose a supplier company other than your own.',
      );
    }

    const today = zonedParts(new Date(), appTimeZone()).date;
    const wantedOn = deliveryDate?.slice(0, 10) || addDays(today, 1);

    // What this SUPPLIER sells — the same two tests the ICPO's product picker
    // makes: the product is sold at all, and the supplier's own company row says
    // they sell it. The second is what keeps a company that merely buys the
    // product in from being offered as a source of it.
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        canSell: true,
        companies: { some: { companyId: supplierCompanyId, canSell: true } },
      },
      select: {
        id: true,
        code: true,
        name: true,
        imageUrl: true,
        unitId: true,
        intercompanyPrice: true,
        shelfLife: true,
        leadTimeDays: true,
        demandCycles: true,
        packed: true,
        prodSun: true,
        prodMon: true,
        prodTue: true,
        prodWed: true,
        prodThu: true,
        prodFri: true,
        prodSat: true,
        prodOccasional: true,
        unit: { select: { symbol: true, code: true, decimalPlaces: true } },
        category: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        // The buyer's OWN levels for this product — set per branch in Product
        // Master. Absent means nobody has said what this branch must keep.
        branchStocks: {
          where: { branchId },
          select: {
            minStock: true,
            maxStock: true,
            reorderLevel: true,
            leadTimeDays: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    if (!products.length) {
      return { branchId, supplierCompanyId, deliveryDate: wantedOn, rows: [] };
    }

    const productIds = products.map((p) => p.id);

    // Each product is measured over its own stretch of history, so the windows
    // go down per product and the stock module buckets them.
    //
    // The window ends at TODAY, exclusive: the day is only half traded, and
    // counting a morning's sales as a day's would drag every average down. So it
    // is the last N COMPLETE days that are averaged.
    const windows: SoldQtyWindow[] = products.map((p) => ({
      productId: p.id,
      sinceDate: addDays(today, -this.windowDays(p.shelfLife, p.demandCycles)),
      untilDate: today,
    }));

    const [onHand, sold, onOrder, customerOrders, contractDue] =
      await Promise.all([
        this.stock.onHandAtBranch(companyId, branchId, productIds),
        this.stock.soldQtyAtBranch(companyId, branchId, windows),
        this.openOrderQtyFor(companyId, branchId, supplierCompanyId, productIds),
        this.customerOrderQtyFor(companyId, branchId, productIds, wantedOn),
        this.contracts.dueOn(companyId, branchId, wantedOn),
      ]);

    const onHandOf = new Map(onHand.map((s) => [s.productId, s]));
    const soldOf = new Map(sold.map((s) => [s.productId, s.qty]));
    const contractOf = new Map(contractDue.map((c) => [c.productId, c]));

    const rows: CatalogueRow[] = products.map((p) => {
      const levels = p.branchStocks[0];
      const minStock = levels?.minStock ?? 0;
      const maxStock = levels?.maxStock ?? 0;
      const reorderLevel = levels?.reorderLevel ?? 0;
      // The BRANCH's own lead time wins where somebody set one; otherwise the
      // product's, which is mostly a fact about the goods rather than about any
      // one branch. 0 on both means nobody has said, and cover falls back to a
      // single day.
      const leadTimeDays = levels?.leadTimeDays || p.leadTimeDays || 0;

      const windowDays = this.windowDays(p.shelfLife, p.demandCycles);
      const soldQty = soldOf.get(p.id) ?? 0;
      const avgDailySales = soldQty / windowDays;

      const { coverDays, nextProductionDate } = this.cover(
        p,
        wantedOn,
        leadTimeDays,
      );

      const stock = onHandOf.get(p.id);
      const available = stock?.available ?? 0;
      const pending = onOrder.get(p.id) ?? 0;
      const poQty = customerOrders.get(p.id) ?? 0;
      const contract = contractOf.get(p.id);
      const contractQty = contract?.quantity ?? 0;

      // The shelf's own need over the days this delivery must bridge.
      const target = avgDailySales * coverDays;

      // Then the two kinds of demand that are NOT the shelf: goods an outside
      // customer has already ordered from this branch, and goods a contract
      // obliges it to hand over that day. Both are owed to somebody by name, so
      // they are added on top rather than served out of shelf cover — a school's
      // bread cannot also be the bread a walk-in customer buys.
      const decimals = p.unit?.decimalPlaces ?? 0;
      const suggestedQty = this.round(
        Math.max(0, target - minStock - available + poQty + contractQty),
        decimals,
      );

      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        imageUrl: p.imageUrl,
        packed: p.packed,
        categoryId: p.category?.id ?? null,
        categoryName: p.category?.name ?? null,
        groupId: p.group?.id ?? null,
        groupName: p.group?.name ?? null,
        unitId: p.unitId,
        unitSymbol: p.unit?.symbol ?? p.unit?.code ?? '',
        decimalPlaces: decimals,
        price: p.intercompanyPrice,

        shelfLife: p.shelfLife,
        demandCycles: p.demandCycles,
        windowDays,
        soldQty: this.round(soldQty, decimals),
        avgDailySales: this.round(avgDailySales, 2),

        coverDays,
        nextProductionDate,

        minStock,
        maxStock,
        reorderLevel,
        available: this.round(available, decimals),
        onOrder: this.round(pending, decimals),
        poQty: this.round(poQty, decimals),
        contractQty: this.round(contractQty, decimals),
        contractSources: contract?.sources ?? [],

        target: this.round(target, decimals),
        suggestedQty,
        // Below the level somebody set for this branch. Purely a flag for the
        // screen to colour by — the suggestion already accounts for it.
        belowLevel:
          Math.max(reorderLevel, minStock) > 0 &&
          available < Math.max(reorderLevel, minStock),
      };
    });

    return { branchId, supplierCompanyId, deliveryDate: wantedOn, rows };
  }

  /**
   * How many days of sales history to average over: the shelf life, that many
   * times over. Falls back to a fixed month when the product tracks no shelf
   * life, and never returns 0 — the window is a divisor.
   */
  private windowDays(shelfLife: number, demandCycles: number): number {
    if (shelfLife <= 0) return NO_SHELF_LIFE_WINDOW_DAYS;
    return Math.max(1, shelfLife * Math.max(1, demandCycles));
  }

  /**
   * How long this delivery has to last, and the date of the run that ends it.
   *
   * A product made Mon/Wed/Fri and delivered on a Friday has to cover three days
   * — there is no run until Monday. Delivered on a Monday it covers two. That is
   * what the production schedule is for, and reading a flat number instead is
   * what leaves a branch short every weekend.
   *
   * Two fallbacks, neither of them a schedule:
   *  - MADE TO ORDER (or no day ticked): there is no next run to wait for, so
   *    the branch has to carry its own lead time. One day when none is set.
   *  - No production run within a week: cannot happen with a weekly schedule,
   *    but the walk is bounded at 7 so a corrupt row cannot loop.
   *
   * Finally capped at the SHELF LIFE. Ordering four days' cover of a
   * three-day product does not buy four days of shelf — it buys a day of waste.
   */
  private cover(
    product: Record<(typeof PRODUCTION_DAY_FIELDS)[number], boolean> & {
      prodOccasional: boolean;
      shelfLife: number;
    },
    deliveryDate: string,
    leadTimeDays: number,
  ): { coverDays: number; nextProductionDate: string | null } {
    const runsOn = PRODUCTION_DAY_FIELDS.map((f) => product[f]);
    const scheduled = runsOn.some(Boolean);

    let coverDays: number;
    let nextProductionDate: string | null = null;

    if (!scheduled) {
      coverDays = Math.max(1, leadTimeDays);
    } else {
      const from = calendarParts(deliveryDate).weekday;
      // Strictly AFTER the delivery: the run that brings the NEXT delivery is
      // the one this stock has to last until.
      const gap = [1, 2, 3, 4, 5, 6, 7].find((n) => runsOn[(from + n) % 7]);
      coverDays = gap ?? Math.max(1, leadTimeDays);
      if (gap) nextProductionDate = addDays(deliveryDate, gap);
    }

    if (product.shelfLife > 0) {
      coverDays = Math.min(coverDays, product.shelfLife);
    }
    return { coverDays: Math.max(1, coverDays), nextProductionDate };
  }

  /**
   * What is already coming to this branch from this supplier, per product.
   *
   * An ICPO counts until the goods actually arrive. It stops counting the moment
   * its dispatch is RECEIVED, because at that point the quantity has moved into
   * the branch's stock and is being counted a second time as `available`.
   *
   * The chain is ICPO → SalesOrder → Dispatch, one of each, so an order with no
   * sales order or no dispatch yet is simply still outstanding.
   *
   * `acceptedQty` wins where the supplier has answered — what they committed to
   * is what is actually coming, and the buyer's original ask is no longer the
   * honest figure. A line the supplier CANCELLED brings nothing.
   *
   * Read straight off CRM's tables rather than through a port: cross-DOMAIN
   * reads are ordinary Prisma (the boundary rule forbids importing another
   * module's code, which this does not do), and it is the same shortcut
   * lpo.service takes to read products and stores.
   */
  private async openOrderQtyFor(
    orderingCompanyId: number,
    orderingBranchId: number,
    supplierCompanyId: number,
    productIds: number[],
  ): Promise<Map<number, number>> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        orderingCompanyId,
        orderingBranchId,
        companyId: supplierCompanyId,
        status: { in: [...OPEN_ORDER_STATUSES] },
      },
      select: {
        id: true,
        lines: {
          where: { cancelled: false, productId: { in: productIds } },
          select: { productId: true, quantity: true, acceptedQty: true },
        },
      },
    });
    if (!orders.length) return new Map();

    // Which of them have already landed. One sales order per ICPO and one
    // dispatch per sales order, so this is a pair of straight lookups.
    const salesOrders = await this.prisma.salesOrder.findMany({
      where: { purchaseOrderId: { in: orders.map((o) => o.id) } },
      select: { id: true, purchaseOrderId: true },
    });
    const received = salesOrders.length
      ? await this.prisma.dispatch.findMany({
          where: {
            salesOrderId: { in: salesOrders.map((s) => s.id) },
            status: 'RECEIVED',
          },
          select: { salesOrderId: true },
        })
      : [];
    const receivedSalesOrders = new Set(received.map((d) => d.salesOrderId));
    const landedOrders = new Set(
      salesOrders
        .filter((s) => receivedSalesOrders.has(s.id))
        .map((s) => s.purchaseOrderId!),
    );

    const pending = new Map<number, number>();
    for (const order of orders) {
      if (landedOrders.has(order.id)) continue;
      for (const line of order.lines) {
        const qty = line.acceptedQty ?? line.quantity;
        pending.set(line.productId, (pending.get(line.productId) ?? 0) + qty);
      }
    }
    return pending;
  }

  /**
   * What outside CUSTOMERS have already ordered from this branch, per product.
   *
   * The mirror of `openOrderQtyFor`, and it moves the suggestion the OTHER way.
   * An ICPO is stock coming IN, so it is netted off; a customer order is stock
   * promised OUT, so it is added — goods a caterer has ordered are goods the
   * branch must have on top of what its own shelf needs.
   *
   * A local sales order (`customerId` set) rather than an intercompany one:
   * `buyerCompanyId` is another group company, whose demand reaches this branch
   * as an ICPO of its own and would otherwise be counted twice.
   *
   * Only orders wanted ON OR BEFORE the delivery date count. An order for next
   * month is real, but it is not what this delivery has to carry, and adding it
   * would have the branch order a month of a customer's bread today.
   */
  private async customerOrderQtyFor(
    companyId: number,
    branchId: number,
    productIds: number[],
    wantedOn: string,
  ): Promise<Map<number, number>> {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        companyId,
        branchId,
        customerId: { not: null },
        status: { in: ['DRAFT', 'PLACED', 'APPROVED'] },
        OR: [
          { deliveryAt: null },
          { deliveryAt: { lte: new Date(`${wantedOn}T23:59:59.999Z`) } },
        ],
      },
      select: {
        id: true,
        lines: {
          where: { productId: { in: productIds } },
          select: { productId: true, quantity: true },
        },
      },
    });
    if (!orders.length) return new Map();

    // An order already shipped is no longer demand — the goods have gone.
    const dispatched = await this.prisma.dispatch.findMany({
      where: { salesOrderId: { in: orders.map((o) => o.id) } },
      select: { salesOrderId: true },
    });
    const shipped = new Set(dispatched.map((d) => d.salesOrderId));

    const owed = new Map<number, number>();
    for (const order of orders) {
      if (shipped.has(order.id)) continue;
      for (const line of order.lines) {
        owed.set(
          line.productId,
          (owed.get(line.productId) ?? 0) + line.quantity,
        );
      }
    }
    return owed;
  }

  /** To the unit's own precision — a suggestion of 64.7 pieces helps nobody. */
  private round(value: number, decimals: number): number {
    const factor = 10 ** Math.max(0, decimals);
    return Math.round(value * factor) / factor;
  }
}
