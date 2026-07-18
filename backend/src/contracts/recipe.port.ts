/**
 * Port — how the Production module obtains recipe (BOM) data it does not own:
 * exploding a set of product demands into aggregated raw-material requirements,
 * and reporting each product's primary group (for division grouping). Owned and
 * implemented by the product/inventory module; bound in contracts.module.ts.
 */

/** DI token for the recipe port. Inject with `@Inject(RECIPE)`. */
export const RECIPE = Symbol('RECIPE');

/** One product and how much of it is to be produced. */
export interface RecipeDemand {
  productId: number;
  quantity: number;
}

/** A product to produce, with the data Production needs to group it. */
export interface PlannedProduct {
  productId: number;
  productName: string;
  unitId: number;
  /** Root (level-1) group of the product, or null if it has none. */
  primaryGroupId: number | null;
}

/** An aggregated raw-material (Item) requirement across the demand. */
export interface MaterialNeed {
  itemId: number;
  itemName: string;
  quantity: number;
  unitId: number;
}

export interface RecipeExplosion {
  products: PlannedProduct[];
  materials: MaterialNeed[];
}

export interface RecipePort {
  /**
   * Explode the demand: for each product, take its recipe BOM scaled by
   * quantity / yield, and aggregate the item requirements across all products.
   * Also returns each product's primary group for division grouping. Single
   * level — recipe ingredients are Items, not sub-manufactured products.
   */
  explode(companyId: number, demand: RecipeDemand[]): Promise<RecipeExplosion>;
}
