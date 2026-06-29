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
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

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

  /** Selling / output unit (required). */
  @IsInt()
  unitId!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intercompanyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number;

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
  @IsNumber()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intercompanyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retailPrice?: number;

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
