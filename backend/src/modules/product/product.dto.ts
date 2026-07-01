import {
  ArrayUnique,
  IsArray,
  IsBoolean,
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
}
