import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One opening-stock line — a lot of an item OR product at a store. */
export class OpeningStockLineInput {
  @IsOptional()
  @IsInt()
  itemId?: number | null;

  @IsOptional()
  @IsInt()
  productId?: number | null;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  /** Supplier's batch number printed on the goods (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  batchNo2?: string | null;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string | null;
}

export class CreateOpeningStockDto {
  @IsInt()
  storeId!: number;

  @IsISO8601()
  docDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OpeningStockLineInput)
  lines!: OpeningStockLineInput[];
}

export class UpdateOpeningStockDto {
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsISO8601()
  docDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OpeningStockLineInput)
  lines?: OpeningStockLineInput[];
}
