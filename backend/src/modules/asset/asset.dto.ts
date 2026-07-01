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

export class CreateAssetDto {
  // Code is system-generated; ignored if sent.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  // Category is derived from the group; ignored if sent.
  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  /** Leaf asset group this asset belongs to (required). */
  @IsInt()
  groupId!: number;

  /** Machine / asset name. */
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity?: number;

  /** Unit the capacity is measured in (Unit master id). */
  @IsOptional()
  @IsInt()
  capacityUnitId?: number | null;

  /** The "per" basis unit (e.g. Minutes, Hour) — Unit master id. */
  @IsOptional()
  @IsInt()
  perUnitId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  lifeSpanYears?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  purchasedFrom?: string;

  @IsOptional()
  @ValidateIf((o) => o.purchaseDate != null)
  @IsDateString()
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warrantyPeriod?: string;

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

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  // categoryId / groupId are immutable (part of the code) and ignored.
  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsInt()
  groupId?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsInt()
  capacityUnitId?: number | null;

  @IsOptional()
  @IsInt()
  perUnitId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  lifeSpanYears?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  purchasedFrom?: string;

  @IsOptional()
  @ValidateIf((o) => o.purchaseDate != null)
  @IsDateString()
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warrantyPeriod?: string;

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
