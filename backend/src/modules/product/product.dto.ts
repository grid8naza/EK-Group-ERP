import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProcessTimeUnit, ProductSource } from '@prisma/client';

/** One packing source line — `quantity` of an unpacked `sourceProductId`. */
export class PackSourceInput {
  @IsInt()
  sourceProductId!: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}

/**
 * What one company does with this product, and the costing it is traced against
 * there. The roles are not exclusive — a company can both produce and sell.
 *
 * ONE cost centre per company covers buying, making and selling alike; what
 * varies is the ACTIVITY. A producer names a cost object per activity
 * (`recipeCostObjectId` / `packingCostObjectId`); a company that only buys and
 * sells names the single `costObjectId`. The service drops whichever don't
 * apply to the role.
 */
export class ProductCompanyInput {
  @IsInt()
  companyId!: number;

  /** Makes it in-house. False means it buys the product in. */
  @IsOptional()
  @IsBoolean()
  canProduce?: boolean;

  @IsOptional()
  @IsBoolean()
  canSell?: boolean;

  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  @IsOptional()
  @IsInt()
  recipeCostObjectId?: number | null;

  @IsOptional()
  @IsInt()
  packingCostObjectId?: number | null;

  @IsOptional()
  @IsInt()
  costObjectId?: number | null;
}

/**
 * One cell of the discount matrix: the maximum discount percentage one
 * authority level may give on this product. `lookupValueId` is a DISCOUNT_LEVEL
 * LookupValue (ids, not names, so a renamed level keeps its saved percentages).
 */
export class ProductDiscountInput {
  @IsInt()
  lookupValueId!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;
}

/** Per-branch stocking parameters for a product. `branchId` is a plain
 *  cross-domain id -> Cpanel Branch. All levels default to 0 when omitted. */
export class ProductBranchStockInput {
  @IsInt()
  branchId!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  /** Replenishment lead time in days. */
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  /** Default put-away location for this product in this branch. */
  @IsOptional()
  @IsInt()
  defaultStoreId?: number | null;

  @IsOptional()
  @IsInt()
  defaultRackId?: number | null;
}

/** One BOM line — `quantity` of `itemId`, measured in `unitId`. */
export class BomLineInput {
  @IsInt()
  itemId!: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsInt()
  unitId!: number;
}

/** One manpower assignment on a process step: `workerCount` workers of a
 * designation. `designationId` is a plain cross-domain id → HR Designation. */
export class ManpowerInput {
  @IsInt()
  @Min(1)
  designationId!: number;

  @IsInt()
  @Min(1)
  workerCount!: number;
}

/** One production process step: an ordered stage with its time, machine and
 * assigned manpower. */
export class ProcessInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** Product picture URL (from POST /products/image). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  timeValue?: number;

  @IsOptional()
  @IsEnum(ProcessTimeUnit)
  timeUnit?: ProcessTimeUnit;

  /** Asset (production-line machine) id — plain cross-domain id, optional. */
  @IsOptional()
  @IsInt()
  machineId?: number | null;

  /** Manpower assigned to this step (designation + worker count). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManpowerInput)
  manpower?: ManpowerInput[];
}

export class CreateProductDto {
  // Code is system-generated; ignored if sent.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** Product picture URL (from POST /products/image). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;

  /**
   * Category this product is filed under (required). Must be one of the group's
   * categories and must be a product kind (Semi-finished or Finished) — this is
   * what decides which product screen the row belongs to.
   */
  @IsInt()
  categoryId!: number;

  /** Leaf group this product belongs to (required). */
  @IsInt()
  groupId!: number;

  /** Selling / output unit (required). */
  @IsInt()
  unitId!: number;

  @IsOptional()
  @IsBoolean()
  unpacked?: boolean;

  @IsOptional()
  @IsBoolean()
  packed?: boolean;

  @IsOptional()
  @IsBoolean()
  canSell?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  /** Profit % of wholesale price over cost (may be negative). */
  @IsOptional()
  @IsNumber()
  wholesaleProfitPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intercompanyPrice?: number;

  @IsOptional()
  @IsNumber()
  intercompanyProfitPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @IsOptional()
  @IsNumber()
  retailProfitPct?: number;

  /**
   * Profit % each channel is MEANT to earn (null = no target set, so that
   * channel is left out of Price Review rather than read as a 0% target), and
   * how far the actual margin may sit from it before an alert is raised.
   */
  @IsOptional()
  @IsNumber()
  intercompanyTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  wholesaleTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  retailTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxVariancePct?: number | null;

  /** Maximum Retail Price — the single figure printed on the pack label. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  boxQty?: number;

  @IsOptional()
  @IsInt()
  boxUnitId?: number | null;

  @IsOptional()
  @IsInt()
  hsnCodeId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  shelfLife?: number; // days (0 = not tracked)

  /// Shelf-life cycles of sales history the Order Catalogue averages demand
  /// over. 1 = the last shelf life; 3 = three of them. Min 1 — a zero would ask
  /// for an empty window and divide by nothing.
  @IsOptional()
  @IsInt()
  @Min(1)
  demandCycles?: number;

  /** Days between ordering this product and having it on the shelf. Read by
   *  the Order Catalogue for a made-to-order product, where there is no next
   *  production run to bridge to and the branch carries its own wait. */
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  yieldQty?: number; // product units one recipe batch yields

  @IsOptional()
  @IsInt()
  yieldUnitId?: number | null;

  /** Packed product: the unpacked source products it is packed from, each with a
   *  quantity. Per-unit cost is read from the source product's costPrice. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackSourceInput)
  packSources?: PackSourceInput[];

  /** Per-branch stocking parameters (min/max/reorder/lead time). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductBranchStockInput)
  branchStocks?: ProductBranchStockInput[];

  /** Made in-house (MANUFACTURED) or bought in for resale (PURCHASED). */
  @IsOptional()
  @IsEnum(ProductSource)
  source?: ProductSource;

  /** A production (recipe) BOM can be created for this product. */
  @IsOptional()
  @IsBoolean()
  hasRecipe?: boolean;

  /** A packing BOM can be created for this product. */
  @IsOptional()
  @IsBoolean()
  hasPacking?: boolean;

  /** This product can be used as an ingredient in another product. */
  @IsOptional()
  @IsBoolean()
  isIngredient?: boolean;

  // ---- Production schedule: the days this product is made on. ----
  @IsOptional() @IsBoolean() prodSun?: boolean;
  @IsOptional() @IsBoolean() prodMon?: boolean;
  @IsOptional() @IsBoolean() prodTue?: boolean;
  @IsOptional() @IsBoolean() prodWed?: boolean;
  @IsOptional() @IsBoolean() prodThu?: boolean;
  @IsOptional() @IsBoolean() prodFri?: boolean;
  @IsOptional() @IsBoolean() prodSat?: boolean;
  /** Made to order — no fixed day. */
  @IsOptional() @IsBoolean() prodOccasional?: boolean;

  /**
   * Delivery Schedule: LookupValue ids from the DELIVERY_TRIP lookup. Ids rather
   * than names because the user may rename a trip, and a saved product should
   * follow the rename rather than point at a label that no longer exists.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  deliveryTripIds?: number[];

  /**
   * Discount matrix: the maximum discount percentage each authority level may
   * give on this product at billing time. Only levels the user has set appear;
   * a missing level means no discount. Cleared server-side when the product is
   * not sellable, since the matrix is a selling attribute.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDiscountInput)
  discounts?: ProductDiscountInput[];

  /**
   * Which companies handle this product, in what role, and against which
   * costing. A product is available exactly where it has a row here — there is
   * no "all companies" flag, because each company needs its own costing.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductCompanyInput)
  companies?: ProductCompanyInput[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // The two bills of materials (edited on the Production screen).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineInput)
  recipe?: BomLineInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineInput)
  packing?: BomLineInput[];

  // Production process flow (ordered steps with time + machine).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessInput)
  processes?: ProcessInput[];

  // BOM costing inputs (material cost is computed from the recipe).
  @IsOptional()
  @IsNumber()
  @Min(0)
  labourCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fuelCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCost?: number;

  @IsOptional()
  @IsNumber()
  bomMarginPct?: number;

  /** Actual cost price per yield unit (populated from the estimated cost/unit). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualCostPrice?: number;

  /** Actual sales price per yield unit (user-entered; for the sales invoice). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualSalesPrice?: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** Product picture URL (from POST /products/image). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsInt()
  groupId?: number | null;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsBoolean()
  unpacked?: boolean;

  @IsOptional()
  @IsBoolean()
  packed?: boolean;

  @IsOptional()
  @IsBoolean()
  canSell?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  wholesaleProfitPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intercompanyPrice?: number;

  @IsOptional()
  @IsNumber()
  intercompanyProfitPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @IsOptional()
  @IsNumber()
  retailProfitPct?: number;

  /**
   * Profit % each channel is MEANT to earn (null = no target set, so that
   * channel is left out of Price Review rather than read as a 0% target), and
   * how far the actual margin may sit from it before an alert is raised.
   */
  @IsOptional()
  @IsNumber()
  intercompanyTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  wholesaleTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  retailTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxVariancePct?: number | null;

  /** Maximum Retail Price — the single figure printed on the pack label. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  boxQty?: number;

  @IsOptional()
  @IsInt()
  boxUnitId?: number | null;

  @IsOptional()
  @IsInt()
  hsnCodeId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  shelfLife?: number;

  /// Shelf-life cycles of sales history the Order Catalogue averages demand
  /// over. 1 = the last shelf life; 3 = three of them. Min 1 — a zero would ask
  /// for an empty window and divide by nothing.
  @IsOptional()
  @IsInt()
  @Min(1)
  demandCycles?: number;

  /** Days between ordering this product and having it on the shelf. Read by
   *  the Order Catalogue for a made-to-order product, where there is no next
   *  production run to bridge to and the branch carries its own wait. */
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  yieldQty?: number;

  @IsOptional()
  @IsInt()
  yieldUnitId?: number | null;

  /** Packed product: the unpacked source products it is packed from, each with a
   *  quantity. Per-unit cost is read from the source product's costPrice. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackSourceInput)
  packSources?: PackSourceInput[];

  /** Per-branch stocking parameters (min/max/reorder/lead time). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductBranchStockInput)
  branchStocks?: ProductBranchStockInput[];

  @IsOptional()
  @IsEnum(ProductSource)
  source?: ProductSource;

  @IsOptional()
  @IsBoolean()
  hasRecipe?: boolean;

  @IsOptional()
  @IsBoolean()
  hasPacking?: boolean;

  @IsOptional()
  @IsBoolean()
  isIngredient?: boolean;

  // ---- Production schedule: the days this product is made on. ----
  @IsOptional() @IsBoolean() prodSun?: boolean;
  @IsOptional() @IsBoolean() prodMon?: boolean;
  @IsOptional() @IsBoolean() prodTue?: boolean;
  @IsOptional() @IsBoolean() prodWed?: boolean;
  @IsOptional() @IsBoolean() prodThu?: boolean;
  @IsOptional() @IsBoolean() prodFri?: boolean;
  @IsOptional() @IsBoolean() prodSat?: boolean;
  /** Made to order — no fixed day. */
  @IsOptional() @IsBoolean() prodOccasional?: boolean;

  /**
   * Delivery Schedule: LookupValue ids from the DELIVERY_TRIP lookup. Ids rather
   * than names because the user may rename a trip, and a saved product should
   * follow the rename rather than point at a label that no longer exists.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  deliveryTripIds?: number[];

  /**
   * Discount matrix: the maximum discount percentage each authority level may
   * give on this product at billing time. Only levels the user has set appear;
   * a missing level means no discount. Cleared server-side when the product is
   * not sellable, since the matrix is a selling attribute.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDiscountInput)
  discounts?: ProductDiscountInput[];

  /**
   * Which companies handle this product, in what role, and against which
   * costing. A product is available exactly where it has a row here — there is
   * no "all companies" flag, because each company needs its own costing.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductCompanyInput)
  companies?: ProductCompanyInput[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineInput)
  recipe?: BomLineInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineInput)
  packing?: BomLineInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessInput)
  processes?: ProcessInput[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  labourCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fuelCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCost?: number;

  @IsOptional()
  @IsNumber()
  bomMarginPct?: number;

  /** Actual cost price per yield unit (populated from the estimated cost/unit). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualCostPrice?: number;

  /** Actual sales price per yield unit (user-entered; for the sales invoice). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualSalesPrice?: number;
}

/** Which products to write the recomputed cost onto (Cost Review screen). */
export class ApplyCostingDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  productIds!: number[];
}

/** One product's revised selling prices (Cost Review → price revision). */
export class PriceRevisionDto {
  @IsInt()
  @IsPositive()
  productId!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intercompanyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  /**
   * Target resets. Independent of the prices — a reviewer may accept a new
   * margin as the intended one instead of repricing to win the old one back.
   * A null clears the target; omit the field to leave it alone.
   */
  @IsOptional()
  @IsNumber()
  intercompanyTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  wholesaleTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  retailTargetPct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxVariancePct?: number | null;
}

/** The batch of revisions saved from the Price Review screen. */
export class RevisePricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceRevisionDto)
  revisions!: PriceRevisionDto[];
}
