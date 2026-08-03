import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ASSET_RATE, AssetRatePort } from '../../contracts/asset-rate.port';
import { LABOUR_RATE, LabourRatePort } from '../../contracts/labour-rate.port';

/**
 * Product costing — the single source of truth for what a manufactured product
 * costs to make at TODAY's master rates.
 *
 * The Recipe Master and Packing Master editors compute the same figures in the
 * browser while you type, and write the result onto the product (`costPrice`).
 * That stored figure is a CACHE: nothing re-costs it when an ingredient's
 * purchase price, a machine's rate or a designation's rate later changes, so it
 * drifts. This service recomputes from the stored references — which is exactly
 * why BOM lines hold ids and quantities but never rate snapshots — and reports
 * the drift so it can be reviewed and written back.
 *
 * The formula mirrors the editors line for line; keep the two in step.
 */

/** Per-unit prices are held to 1 decimal, matching the editors' `round1`. */
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A cost counts as drifted once it differs at the first decimal — the precision
 * the figure is actually stored at. Anything smaller is float noise.
 */
const COST_EPSILON = 0.05;

/** Which master establishes a product's cost. */
export type CostBasis = 'RECIPE' | 'PACKING';

/**
 * Which products a costing pass covers: one company's catalogue (what a user
 * browsing Price Review sees), or `'all'` — used by the rate-change recost,
 * where a master rate has moved under every company at once and the affected
 * products cannot be known from an active company.
 */
export type CostingScope = number | undefined | 'all';

export interface CostBreakdown {
  /** Packing only: Σ (source product's per-unit cost × quantity per pack). */
  productCost: number;
  materialCost: number;
  equipmentCost: number;
  manpowerCost: number;
  fuelCost: number;
  overheadCost: number;
  /** The batch total — what the editor's "Cost Price" row shows. */
  total: number;
  yieldQty: number;
  /** total ÷ yieldQty, rounded. This is what lands on `Product.costPrice`. */
  perUnit: number;
}

export type PriceKey = 'intercompany' | 'wholesale' | 'retail';
const PRICE_KEYS: PriceKey[] = ['intercompany', 'wholesale', 'retail'];

/**
 * One product's revisions from Price Review. Prices, targets and the tolerance
 * are independent — send whichever the reviewer actually changed. A `null`
 * target clears it, which is why `targets` is keyed rather than merged: an
 * absent key means "leave alone", a present `null` means "clear".
 */
export interface Revision {
  productId: number;
  prices?: Partial<Record<PriceKey, number>>;
  targets?: Partial<Record<PriceKey, number | null>>;
  maxVariancePct?: number | null;
}

/**
 * One selling price, measured three ways.
 *
 * The target is a deliberate commercial decision held on the product; it is not
 * inferred from any price and nothing automatic writes it. The two actuals ask
 * the same question of two different costs, and the gap between them is exactly
 * the cost drift this service exists to surface:
 *
 *   targetProfitPct — what this channel is meant to earn (Product Master)
 *   masterProfitPct — what the price earns against the Product Master's cost
 *   actualProfitPct — what it earns against the recomputed cost (the truth)
 *
 * `null` target means none has been set: the channel is reported but never
 * alerted on, rather than being read as a 0% target.
 */
export interface PriceVariance {
  key: PriceKey;
  label: string;
  price: number;
  /** The margin this channel is meant to earn. Null when no target is set. */
  targetProfitPct: number | null;
  /** What the price earns against the cost the Product Master stores. */
  masterProfitPct: number;
  /** What the price earns against the recomputed cost — the real margin. */
  actualProfitPct: number;
  /** actual − target. Negative means short of target. Null without a target. */
  variancePct: number | null;
  /**
   * The variance has exceeded the product's tolerance, in EITHER direction —
   * falling short eats margin, and overshooting can mean the price is
   * uncompetitive or the target has gone stale.
   */
  alert: boolean;
  /** The price that would hit the target exactly at the recomputed cost. */
  priceAtTarget: number | null;
}

export interface ProductCostVariance {
  productId: number;
  code: string;
  name: string;
  categoryName: string | null;
  basis: CostBasis;
  isLocked: boolean;
  /**
   * Whether the product is sold. It splits the review in two: a sellable
   * product is reviewed on PRICE (does it still earn its margin?), while one
   * that is never sold — a semi-finished intermediate — has only a cost to
   * review, and no prices to hold it against.
   */
  canSell: boolean;
  storedCost: number;
  computedCost: number;
  costDelta: number;
  hasDrift: boolean;
  /**
   * The BOM this basis costs from is entirely empty — no lines, no process, and
   * (for packing) no source. Such a product computes to zero, which is arithmetic
   * rather than a finding: any stored cost was typed into the Product Master by
   * hand and applying zero over it would destroy it. Callers must present these
   * apart from real drift and never sweep them into a bulk update.
   */
  emptyBom: boolean;
  /** Any channel whose margin has strayed further from target than allowed. */
  hasAlert: boolean;
  /**
   * How far a margin may sit from its target before alerting, in percentage
   * points, applied in both directions. One tolerance covers all three channels.
   * Null means no tolerance is set and this product never alerts.
   */
  maxVariancePct: number | null;
  breakdown: CostBreakdown;
  prices: PriceVariance[];
  /**
   * Set when a packed product's cost moved only because a source product's cost
   * did — useful to explain a delta on a product whose own BOM has not changed.
   */
  sourceNames: string[];
}

type UnitRow = {
  id: number;
  baseUnitId: number | null;
  /** Nullable in the Unit master; an unset factor costs as 1 (see `factorOf`). */
  conversionFactor: number | null;
};
type ItemRow = { id: number; unitId: number; lastPurchasePrice: number };

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_RATE) private readonly assetRates: AssetRatePort,
    @Inject(LABOUR_RATE) private readonly labourRates: LabourRatePort,
  ) {}

  /**
   * Recost every manufactured product that carries a recipe or a packing BOM,
   * and report it against what the Product Master currently stores.
   *
   * `companyId` scopes which products are visible, matching the rest of the
   * Product Master; the costing itself is company-independent (the rates are
   * global masters).
   */
  async variance(scope: CostingScope): Promise<ProductCostVariance[]> {
    const products = await this.loadProducts(scope);
    if (!products.length) return [];

    const refs = await this.loadRefs(products);
    // A pack source is not always costed in this pass — it may be a purchased
    // product, or out of the active company's scope. Its stored cost is still
    // what packing consumes, so fetch those rather than reading them as zero.
    const storedCostOf = await this.loadSourceCosts(products);
    const costed = new Map<number, CostBreakdown & { basis: CostBasis }>();

    // Resolve in dependency order: a packed product's cost includes the cost of
    // the product it is packed from, so that source must be costed first. Depth
    // first with a guard, so a mis-configured cycle degrades to the stored cost
    // instead of hanging.
    const resolving = new Set<number>();
    const byId = new Map(products.map((p) => [p.id, p]));

    const perUnitOf = (productId: number): number => {
      resolve(productId);
      const done = costed.get(productId);
      if (done) return done.perUnit;
      // Not costed here (a purchased product, one with no BOM, or a cycle):
      // fall back to whatever the master stores for it.
      return byId.get(productId)?.costPrice ?? storedCostOf.get(productId) ?? 0;
    };

    const resolve = (productId: number): void => {
      if (costed.has(productId) || resolving.has(productId)) return;
      const product = byId.get(productId);
      if (!product) return;
      const basis = this.basisOf(product);
      if (!basis) return;
      resolving.add(productId);
      costed.set(productId, {
        basis,
        ...this.compute(product, basis, refs, perUnitOf),
      });
      resolving.delete(productId);
    };

    for (const p of products) resolve(p.id);

    const rows: ProductCostVariance[] = [];
    for (const p of products) {
      const result = costed.get(p.id);
      if (!result) continue;
      const { basis, ...breakdown } = result;
      const storedCost = p.costPrice ?? 0;
      const costDelta = round1(breakdown.perUnit - storedCost);
      const prices = this.priceVariances(p, storedCost, breakdown.perUnit);
      const emptyBom =
        !p.bomLines.some((l) => l.kind === (basis === 'PACKING' ? 'PACKING' : 'RECIPE')) &&
        !p.processes.length &&
        (basis !== 'PACKING' || !p.packSources.length);
      rows.push({
        productId: p.id,
        code: p.code,
        name: p.name,
        categoryName: p.category?.name ?? null,
        basis,
        isLocked: !!p.isLocked,
        canSell: !!p.canSell,
        storedCost,
        computedCost: breakdown.perUnit,
        costDelta,
        hasDrift: Math.abs(breakdown.perUnit - storedCost) >= COST_EPSILON,
        emptyBom,
        hasAlert: prices.some((x) => x.alert),
        maxVariancePct: p.maxVariancePct,
        breakdown,
        prices,
        sourceNames:
          basis === 'PACKING'
            ? p.packSources
                .map((s) => byId.get(s.sourceProductId)?.name)
                .filter((n): n is string => !!n)
            : [],
      });
    }

    // Biggest drift first — that is what a reviewer wants to see.
    return rows.sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta));
  }

  /**
   * Write the recomputed cost onto the given products — the COST AND NOTHING
   * ELSE.
   *
   * Neither the selling prices nor their profit percentages are touched. The
   * prices are commercial decisions, and each stored profit % is the margin its
   * price was set to earn — the benchmark this whole screen exists to check
   * against. Rewriting it here would move the goalposts to wherever the new cost
   * happens to land, and a product could never be found selling below target.
   *
   * Locked products are skipped rather than failing the batch. Figures are
   * recomputed here rather than accepted from the caller — the client never gets
   * to name a product's cost.
   */
  async apply(companyId: number | undefined, productIds: number[]) {
    const wanted = new Set(productIds);
    const rows = (await this.variance(companyId)).filter((r) =>
      wanted.has(r.productId),
    );

    const updated: number[] = [];
    const skippedLocked: string[] = [];
    const skippedEmpty: string[] = [];
    for (const row of rows) {
      if (row.isLocked) {
        skippedLocked.push(row.name);
        continue;
      }
      // Refused server-side, not merely hidden in the UI: writing a computed
      // zero over a hand-entered cost destroys the only figure the product has.
      if (row.emptyBom) {
        skippedEmpty.push(row.name);
        continue;
      }
      await this.prisma.product.update({
        where: { id: row.productId },
        data: {
          costPrice: row.computedCost,
          actualCostPrice: row.computedCost,
        },
      });
      updated.push(row.productId);
    }

    return {
      updated: updated.length,
      updatedIds: updated,
      skippedLocked,
      skippedEmpty,
      // Ids asked for that had nothing to update (already in step, or not costed
      // here at all) — reported so the caller can tell "done" from "ignored".
      notFound: [...wanted].filter(
        (id) => !rows.some((r) => r.productId === id),
      ),
    };
  }

  /**
   * Revise selling prices after review — the deliberate human decision this
   * screen leads up to.
   *
   * This is the ONE path that rewrites a profit %, and it must: setting a price
   * is what establishes the margin it is meant to earn, so the new % (worked out
   * against the freshly recomputed cost) becomes the new target. That is exactly
   * what Recipe Master and Packing Master do when a price is typed into them.
   *
   * There is one storage for these figures — `Product.intercompanyPrice` and its
   * siblings. Recipe Master, Packing Master and the Product Master all read and
   * write those same columns, so writing here updates every screen at once;
   * there is no second copy to keep in step.
   *
   * Only the prices actually sent are touched, so revising retail alone leaves
   * wholesale and intercompany (and their targets) exactly as they were.
   */
  async revisePrices(
    companyId: number | undefined,
    revisions: Revision[],
  ) {
    const byId = new Map(revisions.map((r) => [r.productId, r]));
    const rows = (await this.variance(companyId)).filter((r) =>
      byId.has(r.productId),
    );

    const updated: string[] = [];
    const skippedLocked: string[] = [];
    for (const row of rows) {
      if (row.isLocked) {
        skippedLocked.push(row.name);
        continue;
      }
      const wanted = byId.get(row.productId)!;
      // Margins are worked out against the CURRENT cost of making the product —
      // the recomputed one, not a stale cache the reviewer cannot see. Where
      // there is no BOM to compute from, the stored cost is all there is.
      const cost = row.emptyBom ? row.storedCost : row.computedCost;
      const data: Record<string, number | null> = {};

      for (const key of PRICE_KEYS) {
        const price = wanted.prices?.[key];
        if (price != null) {
          data[`${key}Price`] = round1(price);
          // The profit % follows the price it was set from. It is a derived
          // figure — what this price earns — so Recipe Master, Packing Master
          // and the Product Master all show the new margin straight away.
          data[`${key}ProfitPct`] = cost ? round1(((price - cost) / cost) * 100) : 0;
        }
        // Resetting a target is a separate decision from repricing: it accepts
        // a new margin as the intended one rather than trying to win the old
        // one back. Either may be sent alone. `null` clears the target.
        if (key in (wanted.targets ?? {})) {
          const target = wanted.targets![key];
          data[`${key}TargetPct`] = target == null ? null : round1(target);
        }
      }
      if ('maxVariancePct' in wanted) {
        data.maxVariancePct =
          wanted.maxVariancePct == null ? null : round1(wanted.maxVariancePct);
      }

      // A price was set against the recomputed cost, so that cost must be what
      // the Product Master holds — otherwise it would show a price, a cost and
      // a profit % that do not agree with one another. Skipped where there is
      // no BOM, since the computed zero would destroy a hand-entered cost.
      if (!row.emptyBom && row.hasDrift && Object.keys(data).length) {
        data.costPrice = row.computedCost;
        data.actualCostPrice = row.computedCost;
      }

      if (!Object.keys(data).length) continue;
      await this.prisma.product.update({
        where: { id: row.productId },
        data,
      });
      updated.push(row.name);
    }

    return { updated: updated.length, updatedNames: updated, skippedLocked };
  }

  /**
   * Recost after a MASTER RATE moved — a machine's cost/hour or a designation's
   * rate/hour. Writes the refreshed cost onto the products that rate actually
   * reaches, and nothing else.
   *
   * Cost is a calculation, so it may follow a rate without asking. Selling
   * prices are not touched, and neither are the profit targets they are judged
   * against: the point of moving a cost automatically is that the margin change
   * then SHOWS UP in Price Review for someone to decide about.
   *
   * Deliberately targeted rather than "apply everything that has drifted". A
   * product may be drifted for an unrelated reason — an ingredient repriced last
   * week that nobody has reviewed yet — and saving a machine rate is no reason
   * to silently accept that too. The affected set is: every product whose
   * process flow references the changed asset/designation, plus everything
   * packed from those, transitively (a packed product's cost contains its
   * source's, so it moves when the source does).
   */
  async recostForRateChange(input: {
    assetIds?: number[];
    designationIds?: number[];
  }): Promise<{ productId: number; name: string; from: number; to: number }[]> {
    const assetIds = input.assetIds?.filter(Number.isFinite) ?? [];
    const designationIds = input.designationIds?.filter(Number.isFinite) ?? [];
    if (!assetIds.length && !designationIds.length) return [];

    // Products whose own process flow uses the changed rate.
    const touched = await this.prisma.productProcess.findMany({
      where: {
        OR: [
          ...(assetIds.length ? [{ machineId: { in: assetIds } }] : []),
          ...(designationIds.length
            ? [{ manpower: { some: { designationId: { in: designationIds } } } }]
            : []),
        ],
      },
      select: { productId: true },
    });
    const affected = new Set(touched.map((t) => t.productId));
    if (!affected.size) return [];

    // Walk forward through packing: whatever is packed from an affected product
    // is affected too, however long the chain.
    const links = await this.prisma.productPackSource.findMany({
      select: { productId: true, sourceProductId: true },
    });
    const packedFrom = new Map<number, number[]>();
    for (const l of links) {
      const list = packedFrom.get(l.sourceProductId) ?? [];
      list.push(l.productId);
      packedFrom.set(l.sourceProductId, list);
    }
    const queue = [...affected];
    while (queue.length) {
      const id = queue.pop()!;
      for (const next of packedFrom.get(id) ?? []) {
        // The `add`-then-check guard also terminates a mis-configured cycle.
        if (affected.has(next)) continue;
        affected.add(next);
        queue.push(next);
      }
    }

    const rows = (await this.variance('all')).filter(
      (r) =>
        affected.has(r.productId) && r.hasDrift && !r.emptyBom && !r.isLocked,
    );

    const changed: { productId: number; name: string; from: number; to: number }[] =
      [];
    for (const row of rows) {
      await this.prisma.product.update({
        where: { id: row.productId },
        data: {
          costPrice: row.computedCost,
          actualCostPrice: row.computedCost,
        },
      });
      changed.push({
        productId: row.productId,
        name: row.name,
        from: row.storedCost,
        to: row.computedCost,
      });
    }
    return changed;
  }

  // ---- internals ----

  /** Which master owns this product's cost, or null when neither does. */
  private basisOf(p: { source: string; hasRecipe: boolean; hasPacking: boolean }) {
    if (p.source !== 'MANUFACTURED') return null;
    // Packing wins when a product somehow carries both: it is the step that
    // completes the product, and its cost already includes the recipe's via the
    // pack source.
    if (p.hasPacking) return 'PACKING' as const;
    if (p.hasRecipe) return 'RECIPE' as const;
    return null;
  }

  private async loadProducts(scope: CostingScope) {
    return this.prisma.product.findMany({
      where: {
        AND: [
          // A product is available exactly where it has a company row; with no
          // active company nothing is in scope. Same rule as ProductService.findAll.
          // 'all' is for the rate-change recost, which is not a user browsing a
          // company but a master rate moving under every company at once.
          scope === 'all'
            ? {}
            : scope
              ? { companies: { some: { companyId: scope } } }
              : { id: -1 },
          { source: 'MANUFACTURED' },
          { OR: [{ hasRecipe: true }, { hasPacking: true }] },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        source: true,
        hasRecipe: true,
        hasPacking: true,
        isLocked: true,
        canSell: true,
        unitId: true,
        yieldQty: true,
        costPrice: true,
        fuelCost: true,
        overheadCost: true,
        intercompanyPrice: true,
        intercompanyProfitPct: true,
        wholesalePrice: true,
        wholesaleProfitPct: true,
        retailPrice: true,
        retailProfitPct: true,
        intercompanyTargetPct: true,
        wholesaleTargetPct: true,
        retailTargetPct: true,
        maxVariancePct: true,
        category: { select: { name: true } },
        bomLines: {
          select: { kind: true, itemId: true, quantity: true, unitId: true },
        },
        processes: {
          select: {
            timeValue: true,
            timeUnit: true,
            machineId: true,
            manpower: { select: { designationId: true, workerCount: true } },
          },
        },
        packSources: { select: { sourceProductId: true, quantity: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Stored cost of every pack source that the pass does not cost itself, so a
   * packed product still values what it packs. Keyed by product id.
   */
  private async loadSourceCosts(
    products: Awaited<ReturnType<typeof this.loadProducts>>,
  ): Promise<Map<number, number>> {
    const known = new Set(products.map((p) => p.id));
    const missing = [
      ...new Set(
        products.flatMap((p) =>
          p.packSources
            .map((s) => s.sourceProductId)
            .filter((id) => !known.has(id)),
        ),
      ),
    ];
    if (!missing.length) return new Map();
    const rows = await this.prisma.product.findMany({
      where: { id: { in: missing } },
      select: { id: true, costPrice: true },
    });
    return new Map(rows.map((r) => [r.id, r.costPrice ?? 0]));
  }

  /** Every rate + unit the pass needs, fetched once. */
  private async loadRefs(products: Awaited<ReturnType<typeof this.loadProducts>>) {
    const itemIds = products.flatMap((p) => p.bomLines.map((l) => l.itemId));
    const machineIds = products.flatMap((p) =>
      p.processes.map((x) => x.machineId).filter((id): id is number => id != null),
    );
    const designationIds = products.flatMap((p) =>
      p.processes.flatMap((x) => x.manpower.map((m) => m.designationId)),
    );

    const [items, units, assetRates, labourRates] = await Promise.all([
      this.prisma.item.findMany({
        where: { id: { in: [...new Set(itemIds)] } },
        select: { id: true, unitId: true, lastPurchasePrice: true },
      }),
      this.prisma.unit.findMany({
        select: { id: true, baseUnitId: true, conversionFactor: true },
      }),
      this.assetRates.costPerHourFor(machineIds),
      this.labourRates.ratePerHourFor(designationIds),
    ]);

    return {
      itemById: new Map<number, ItemRow>(
        items.map((i) => [
          i.id,
          { id: i.id, unitId: i.unitId, lastPurchasePrice: i.lastPurchasePrice ?? 0 },
        ]),
      ),
      unitById: new Map<number, UnitRow>(units.map((u) => [u.id, u])),
      assetRates,
      labourRates,
    };
  }

  private compute(
    p: Awaited<ReturnType<typeof this.loadProducts>>[number],
    basis: CostBasis,
    refs: Awaited<ReturnType<typeof this.loadRefs>>,
    perUnitOf: (productId: number) => number,
  ): CostBreakdown {
    // Material: an item's last purchase price is per its OWN stock unit, so it
    // is converted into the BOM line's unit through their shared base unit
    // (e.g. 210/Kg entered as grams → 0.21/Gm). No shared base, no conversion.
    const baseOf = (u?: UnitRow) => (u ? (u.baseUnitId ?? u.id) : undefined);
    const factorOf = (u?: UnitRow) => u?.conversionFactor ?? 1;
    const rateOf = (line: { itemId: number; unitId: number }) => {
      const item = refs.itemById.get(line.itemId);
      if (!item) return 0;
      const price = item.lastPurchasePrice;
      const iu = refs.unitById.get(item.unitId);
      const lu = refs.unitById.get(line.unitId);
      if (!iu || !lu || iu.id === lu.id) return price;
      if (baseOf(iu) !== baseOf(lu)) return price;
      return (price * factorOf(lu)) / factorOf(iu);
    };

    // A recipe costs its RECIPE lines, packing its PACKING lines — one table,
    // told apart by `kind`.
    const wantKind = basis === 'PACKING' ? 'PACKING' : 'RECIPE';
    const materialCost = p.bomLines
      .filter((l) => l.kind === wantKind)
      .reduce((s, l) => s + l.quantity * rateOf(l), 0);

    // Process time may be entered in minutes; both rates are per hour.
    const hoursOf = (x: { timeValue: number; timeUnit: string }) =>
      x.timeUnit === 'HR' ? x.timeValue : x.timeValue / 60;
    const equipmentCost = p.processes.reduce(
      (s, x) =>
        s + (x.machineId ? (refs.assetRates.get(x.machineId) ?? 0) : 0) * hoursOf(x),
      0,
    );
    const manpowerCost = p.processes.reduce(
      (s, x) =>
        s +
        x.manpower.reduce(
          (ss, m) =>
            ss +
            (refs.labourRates.get(m.designationId) ?? 0) *
              hoursOf(x) *
              (m.workerCount || 0),
          0,
        ),
      0,
    );

    // Packing carries the cost of what it packs; a recipe starts from raw items.
    const productCost =
      basis === 'PACKING'
        ? p.packSources.reduce(
            (s, src) => s + src.quantity * perUnitOf(src.sourceProductId),
            0,
          )
        : 0;

    const fuelCost = p.fuelCost ?? 0;
    const overheadCost = p.overheadCost ?? 0;
    const total =
      productCost +
      materialCost +
      equipmentCost +
      manpowerCost +
      fuelCost +
      overheadCost;
    const yieldQty = p.yieldQty || 1;

    return {
      productCost,
      materialCost,
      equipmentCost,
      manpowerCost,
      fuelCost,
      overheadCost,
      total,
      yieldQty,
      perUnit: round1(total / yieldQty),
    };
  }

  /**
   * Each selling price against its target, measured at both the stored and the
   * recomputed cost. A price of zero is not offered at all, so it is left out.
   */
  private priceVariances(
    p: {
      intercompanyPrice: number;
      intercompanyTargetPct: number | null;
      wholesalePrice: number;
      wholesaleTargetPct: number | null;
      retailPrice: number;
      retailTargetPct: number | null;
      maxVariancePct: number | null;
    },
    storedCost: number,
    computedCost: number,
  ): PriceVariance[] {
    const cols: {
      key: PriceKey;
      label: string;
      price: number;
      target: number | null;
    }[] = [
      {
        key: 'intercompany',
        label: 'Intercompany',
        price: p.intercompanyPrice ?? 0,
        target: p.intercompanyTargetPct,
      },
      {
        key: 'wholesale',
        label: 'Wholesale',
        price: p.wholesalePrice ?? 0,
        target: p.wholesaleTargetPct,
      },
      {
        key: 'retail',
        label: 'Retail',
        price: p.retailPrice ?? 0,
        target: p.retailTargetPct,
      },
    ];

    const pctAt = (price: number, cost: number) =>
      cost ? round1(((price - cost) / cost) * 100) : 0;

    return cols
      .filter((c) => c.price > 0)
      .map((c) => {
        const actualProfitPct = pctAt(c.price, computedCost);
        const variancePct =
          c.target == null ? null : round1(actualProfitPct - c.target);
        return {
          key: c.key,
          label: c.label,
          price: c.price,
          targetProfitPct: c.target,
          masterProfitPct: pctAt(c.price, storedCost),
          actualProfitPct,
          variancePct,
          // No target or no tolerance set means no alerting for this channel —
          // silence is the right default for something nobody has configured.
          alert:
            variancePct != null &&
            p.maxVariancePct != null &&
            Math.abs(variancePct) > p.maxVariancePct,
          priceAtTarget:
            c.target == null ? null : round1(computedCost * (1 + c.target / 100)),
        };
      });
  }
}
