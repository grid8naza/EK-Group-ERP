import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateItemDto {
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

  /** Leaf group this item belongs to (required). */
  @IsInt()
  groupId!: number;

  /** Stock unit (required). */
  @IsInt()
  unitId!: number;

  /** Last purchase price — maintained by the purchase flow; set here as an
   *  opening value. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  lastPurchasePrice?: number;

  /** Last purchase date (ISO). null clears it. */
  @IsOptional()
  @ValidateIf((o) => o.lastPurchaseDate != null)
  @IsDateString()
  lastPurchaseDate?: string | null;

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
  @IsNumber()
  @Min(0)
  minimumStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTime?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shelfLife?: number; // days (0 = not tracked)

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
}

export class UpdateItemDto {
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
  lastPurchasePrice?: number;

  @IsOptional()
  @ValidateIf((o) => o.lastPurchaseDate != null)
  @IsDateString()
  lastPurchaseDate?: string | null;

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
  @IsNumber()
  @Min(0)
  minimumStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTime?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shelfLife?: number; // days (0 = not tracked)

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
}
