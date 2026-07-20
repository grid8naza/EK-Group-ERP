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

/** One stock-transaction line — an item OR product moved at a store. */
export class StockTransactionLineInput {
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

  /** Supplier/external batch number on the goods (IN types only). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  batchNo2?: string | null;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string | null;
}

export class CreateStockTransactionDto {
  @IsInt()
  storeId!: number;

  @IsISO8601()
  docDate!: string;

  /** Goods Receipt Note only: supplier the goods came from. */
  @IsOptional()
  @IsInt()
  supplierId?: number | null;

  /** Goods Receipt Note only: the purchase order reference (free text for now). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  purchaseOrderRef?: string | null;

  /**
   * Goods Receipt Note only: receive an intercompany Dispatch. Every line must
   * be a product the dispatch shipped, and no line may accept more than was
   * shipped — accepting less is the short/damaged case.
   */
  @IsOptional()
  @IsInt()
  dispatchId?: number | null;

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
  @Type(() => StockTransactionLineInput)
  lines!: StockTransactionLineInput[];
}

export class UpdateStockTransactionDto {
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsISO8601()
  docDate?: string;

  @IsOptional()
  @IsInt()
  supplierId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  purchaseOrderRef?: string | null;

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
  @Type(() => StockTransactionLineInput)
  lines?: StockTransactionLineInput[];
}
