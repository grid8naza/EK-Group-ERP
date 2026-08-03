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

/**
 * One selling price measured against the margin it was set to earn.
 *
 * The stored profit % IS the target. It was written when a human last decided
 * this price — in Recipe Master, Packing Master or the Product Master — so it
 * records the margin that price was meant to give. Nothing derived may overwrite
 * it: a cost rise must show up as the ACTUAL margin falling below the target,
 * not as the target quietly moving down to meet the new cost.
 */
export interface PriceVariance {
  key: PriceKey;
  label: string;
  price: number;
  /** The margin this price was set to earn. Never rewritten by a recost. */
  targetProfitPct: number;
  /** What it actually earns at the recomputed cost. */
  actualProfitPct: number;
  /** actual − target. Negative means the margin has eroded. */
  profitPctDelta: number;
  /** True once the price no longer earns the margin it was set for. */
  belowTarget: boolean;
  /** The price that would restore the target margin at the recomputed cost. */
  priceAtTarget: number;
}

export interface ProductCostVariance {
  productId: number;
  code: string;
  name: string;
  categoryName: string | null;
  basis: CostBasis;
  isLocked: boolean;
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
  /** Any selling price no longer earning the margin it was set for. */
  belowTarget: boolean;
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
  async variance(companyId: number | undefined): Promise<ProductCostVariance[]> {
    const products = await this.loadProducts(companyId);
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
      const prices = this.priceVariances(p, breakdown.perUnit);
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
        storedCost,
        computedCost: breakdown.perUnit,
        costDelta,
        hasDrift: Math.abs(breakdown.perUnit - storedCost) >= COST_EPSILON,
        emptyBom,
        belowTarget: prices.some((x) => x.belowTarget),
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
    revisions: { productId: number; prices: Partial<Record<PriceKey, number>> }[],
  ) {
    const byId = new Map(revisions.map((r) => [r.productId, r.prices]));
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
      // Margins are worked out against the CURRENT cost of making the product,
      // which is the recomputed one — not a stale cache the reviewer cannot see.
      const cost = row.emptyBom ? row.storedCost : row.computedCost;
      const data: Record<string, number> = {};
      for (const key of ['intercompany', 'wholesale', 'retail'] as PriceKey[]) {
        const price = wanted[key];
        if (price == null) continue;
        data[`${key}Price`] = round1(price);
        data[`${key}ProfitPct`] = cost
          ? round1(((price - cost) / cost) * 100)
          : 0;
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

  private async loadProducts(companyId: number | undefined) {
    return this.prisma.product.findMany({
      where: {
        AND: [
          // A product is available exactly where it has a company row; with no
          // active company nothing is in scope. Same rule as ProductService.findAll.
          companyId ? { companies: { some: { companyId } } } : { id: -1 },
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
   * How each selling price's margin reads before and after the refreshed cost.
   * A price of zero is not offered (nothing is sold at it), so it is left out.
   */
  private priceVariances(
    p: {
      intercompanyPrice: number;
      intercompanyProfitPct: number;
      wholesalePrice: number;
      wholesaleProfitPct: number;
      retailPrice: number;
      retailProfitPct: number;
    },
    computedCost: number,
  ): PriceVariance[] {
    const cols: { key: PriceVariance['key']; label: string; price: number; pct: number }[] =
      [
        {
          key: 'intercompany',
          label: 'Intercompany',
          price: p.intercompanyPrice ?? 0,
          pct: p.intercompanyProfitPct ?? 0,
        },
        {
          key: 'wholesale',
          label: 'Wholesale',
          price: p.wholesalePrice ?? 0,
          pct: p.wholesaleProfitPct ?? 0,
        },
        {
          key: 'retail',
          label: 'Retail',
          price: p.retailPrice ?? 0,
          pct: p.retailProfitPct ?? 0,
        },
      ];

    return cols
      .filter((c) => c.price > 0)
      .map((c) => {
        const actualProfitPct = computedCost
          ? round1(((c.price - computedCost) / computedCost) * 100)
          : 0;
        return {
          key: c.key,
          label: c.label,
          price: c.price,
          targetProfitPct: c.pct,
          actualProfitPct,
          profitPctDelta: round1(actualProfitPct - c.pct),
          // A margin counts as eroded once it slips a tenth of a point below
          // target — the precision the percentages are held at.
          belowTarget: actualProfitPct < c.pct - 0.05,
          priceAtTarget: round1(computedCost * (1 + c.pct / 100)),
        };
      });
  }
}
