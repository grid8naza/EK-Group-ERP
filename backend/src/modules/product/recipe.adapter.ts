import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MaterialNeed,
  PackConsumeItem,
  PackConsumeProduct,
  PackingExplosion,
  PlannedProduct,
  RecipeDemand,
  RecipeExplosion,
  RecipePort,
} from '../../contracts/recipe.port';

/**
 * Recipe port implementation. Lives in the product module — which owns the
 * Product master and its recipe BOM — and reads only inventory-domain tables it
 * already manages (Product, ProductBomLine, Item, Group).
 */
@Injectable()
export class RecipeAdapter implements RecipePort {
  constructor(private readonly prisma: PrismaService) {}

  async explode(
    _companyId: number,
    demand: RecipeDemand[],
  ): Promise<RecipeExplosion> {
    const productIds = [...new Set(demand.map((d) => d.productId))];
    if (!productIds.length) return { products: [], materials: [] };

    const [products, bom] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          unitId: true,
          groupId: true,
          yieldQty: true,
        },
      }),
      // Only the RECIPE bill of materials (not PACKING) drives material need.
      this.prisma.productBomLine.findMany({
        where: { productId: { in: productIds }, kind: 'RECIPE' },
        select: { productId: true, itemId: true, quantity: true, unitId: true },
      }),
    ]);

    const qtyOf = new Map(demand.map((d) => [d.productId, d.quantity]));
    const primaryOf = await this.primaryGroupMap(
      products.map((p) => p.groupId).filter((g): g is number => g != null),
    );

    // Aggregate item requirement, keyed by item + unit.
    const matMap = new Map<string, MaterialNeed>();
    for (const p of products) {
      const qty = qtyOf.get(p.id) ?? 0;
      // BOM quantities are per YIELD BATCH (one batch yields `yieldQty` units).
      const batches = qty / (p.yieldQty || 1);
      if (batches <= 0) continue;
      for (const line of bom) {
        if (line.productId !== p.id) continue;
        const need = line.quantity * batches;
        const key = `${line.itemId}:${line.unitId}`;
        const cur = matMap.get(key);
        if (cur) cur.quantity += need;
        else
          matMap.set(key, {
            itemId: line.itemId,
            itemName: '',
            quantity: need,
            unitId: line.unitId,
          });
      }
    }

    const itemIds = [...new Set([...matMap.values()].map((m) => m.itemId))];
    const items = itemIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, name: true },
        })
      : [];
    const itemName = new Map(items.map((i) => [i.id, i.name]));

    const materials = [...matMap.values()].map((m) => ({
      ...m,
      itemName: itemName.get(m.itemId) ?? `#${m.itemId}`,
    }));

    const plannedProducts: PlannedProduct[] = products.map((p) => ({
      productId: p.id,
      productName: p.name,
      unitId: p.unitId,
      primaryGroupId: p.groupId != null ? (primaryOf.get(p.groupId) ?? null) : null,
    }));

    return { products: plannedProducts, materials };
  }

  async explodePacking(
    _companyId: number,
    demand: RecipeDemand[],
  ): Promise<PackingExplosion> {
    const productIds = [...new Set(demand.map((d) => d.productId))];
    if (!productIds.length)
      return { produce: [], consumeProducts: [], consumeItems: [] };

    const [products, packSources, packBom] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, unitId: true, yieldQty: true },
      }),
      this.prisma.productPackSource.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, sourceProductId: true, quantity: true },
      }),
      // Packing materials — the PACKING bill of materials (not RECIPE).
      this.prisma.productBomLine.findMany({
        where: { productId: { in: productIds }, kind: 'PACKING' },
        select: { productId: true, itemId: true, quantity: true, unitId: true },
      }),
    ]);

    const qtyOf = new Map(demand.map((d) => [d.productId, d.quantity]));
    const batchesOf = new Map(
      products.map((p) => [p.id, (qtyOf.get(p.id) ?? 0) / (p.yieldQty || 1)]),
    );

    const produce = products.map((p) => ({
      productId: p.id,
      productName: p.name,
      quantity: qtyOf.get(p.id) ?? 0,
      unitId: p.unitId,
    }));

    // Aggregate source-product consumption by source product.
    const srcMap = new Map<number, number>();
    for (const s of packSources) {
      const batches = batchesOf.get(s.productId) ?? 0;
      if (batches <= 0) continue;
      srcMap.set(
        s.sourceProductId,
        (srcMap.get(s.sourceProductId) ?? 0) + s.quantity * batches,
      );
    }
    const srcIds = [...srcMap.keys()];
    const srcProducts = srcIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: srcIds } },
          select: { id: true, name: true, unitId: true },
        })
      : [];
    const srcById = new Map(srcProducts.map((p) => [p.id, p]));
    const consumeProducts: PackConsumeProduct[] = srcIds.map((id) => ({
      productId: id,
      productName: srcById.get(id)?.name ?? `#${id}`,
      quantity: srcMap.get(id) ?? 0,
      unitId: srcById.get(id)?.unitId ?? 0,
    }));

    // Aggregate packing-material consumption by item + unit.
    const itemMap = new Map<string, PackConsumeItem>();
    for (const b of packBom) {
      const batches = batchesOf.get(b.productId) ?? 0;
      if (batches <= 0) continue;
      const key = `${b.itemId}:${b.unitId}`;
      const cur = itemMap.get(key);
      const need = b.quantity * batches;
      if (cur) cur.quantity += need;
      else
        itemMap.set(key, {
          itemId: b.itemId,
          itemName: '',
          quantity: need,
          unitId: b.unitId,
        });
    }
    const itemIds = [...new Set([...itemMap.values()].map((m) => m.itemId))];
    const items = itemIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, name: true },
        })
      : [];
    const itemName = new Map(items.map((i) => [i.id, i.name]));
    const consumeItems = [...itemMap.values()].map((m) => ({
      ...m,
      itemName: itemName.get(m.itemId) ?? `#${m.itemId}`,
    }));

    return { produce, consumeProducts, consumeItems };
  }

  /** Map each leaf groupId to its root (level-1 / no-parent) group by walking up. */
  private async primaryGroupMap(
    groupIds: number[],
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    const cache = new Map<
      number,
      { id: number; parentGroupId: number | null } | null
    >();
    const load = async (id: number) => {
      if (cache.has(id)) return cache.get(id);
      const g = await this.prisma.group.findUnique({
        where: { id },
        select: { id: true, parentGroupId: true },
      });
      cache.set(id, g);
      return g;
    };
    for (const start of [...new Set(groupIds)]) {
      let cur = await load(start);
      // Guard against a malformed cycle with a depth cap (hierarchy ≤ 5 levels).
      for (let depth = 0; cur && cur.parentGroupId != null && depth < 10; depth++) {
        cur = await load(cur.parentGroupId);
      }
      if (cur) result.set(start, cur.id);
    }
    return result;
  }
}
