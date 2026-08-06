import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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

  /** Always in the stockable's STOCK unit — what actually moves. */
  @IsNumber()
  @Min(0)
  quantity!: number;

  /** Always per STOCK unit, to match `quantity`. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  /**
   * What was written on the delivery note / invoice when the line was entered in
   * the pack: 1 (Bottle) behind a quantity of 200 (Gram). Kept for the document
   * only — stock is posted from `quantity`. Omit for a line typed in stock units.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  enteredQty?: number | null;

  @IsOptional()
  @IsInt()
  enteredUnitId?: number | null;

  /** The rate as invoiced, per pack (50 a bottle beside unitPrice's 0.25 a gram). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  enteredUnitPrice?: number | null;

  /**
   * Tax RATES on this line (%), per head — cgst + sgst within the state, igst
   * across it. Defaulted on the screen from the stockable's HSN code and
   * editable there, because what the supplier charged is a fact about the bill.
   *
   * Rates only: the AMOUNTS are computed from qty × unitPrice on the way in and
   * never taken from the caller, so what the register foots to cannot be a
   * figure the client made up.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cgst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sgst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  igst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cess?: number;

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

  /** Delivery Note only: the customer the goods went to, and their order. */
  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  salesOrderRef?: string | null;

  /**
   * Goods Receipt Note only: receive an intercompany Dispatch. Every line must
   * be a product the dispatch shipped, and no line may accept more than was
   * shipped — accepting less is the short/damaged case.
   */
  @IsOptional()
  @IsInt()
  dispatchId?: number | null;

  /**
   * Costing the document is charged to. Meant for the Goods Issue Note, where
   * raw-material items have no costing to inherit; when set it overrides the
   * per-line product costing for every line.
   */
  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  @IsOptional()
  @IsInt()
  costObjectId?: number | null;

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
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  salesOrderRef?: string | null;

  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  @IsOptional()
  @IsInt()
  costObjectId?: number | null;

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
