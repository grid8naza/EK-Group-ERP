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
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProcessTimeUnit } from '@prisma/client';

/** One packing source line — `quantity` of an unpacked `sourceProductId`. */
export class PackSourceInput {
  @IsInt()
  sourceProductId!: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;
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

  // Category is derived from the group; ignored if sent.
  @IsOptional()
  @IsInt()
  categoryId?: number | null;

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

  @IsOptional()
  @IsBoolean()
  allCompanies?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  companyIds?: number[];

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
  @IsBoolean()
  hasRecipe?: boolean;

  @IsOptional()
  @IsBoolean()
  hasPacking?: boolean;

  @IsOptional()
  @IsBoolean()
  isIngredient?: boolean;

  @IsOptional()
  @IsBoolean()
  allCompanies?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  companyIds?: number[];

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
