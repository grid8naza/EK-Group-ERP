import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One order line — `quantity` of `productId`, measured in `unitId`. */
export class PurchaseOrderLineInput {
  @IsInt()
  productId!: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsInt()
  unitId!: number;
}

/** Raise a Purchase Order - IC on a supplier company. */
export class CreatePurchaseOrderDto {
  /** Supplier company the order is placed on (owns / receives the order). */
  @IsInt()
  supplierCompanyId!: number;

  /** Requested delivery date & time (ISO). Carried to the sales order later. */
  @IsOptional()
  @IsISO8601()
  deliveryAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInput)
  lines!: PurchaseOrderLineInput[];
}

/** Edit a draft (or an in-workflow order when the step allows editing). */
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsISO8601()
  deliveryAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInput)
  lines?: PurchaseOrderLineInput[];
}

/**
 * The supplier's answer to one line, set by Customer Relations while the order
 * is with them.
 *
 * Only these two fields move. The product, the unit, the rate and the buyer's
 * quantity are all off-limits — the demand has to stay legible beside what was
 * committed, and the rate is what the buyer's approver signed off.
 */
export class ReviewLineInput {
  /** Identifies the line. Lines can't be added or removed by a reviewer. */
  @IsInt()
  lineId!: number;

  /**
   * What we'll supply. MAY exceed stock — reserve takes what exists and the rest
   * is produced. Ignored when `cancelled`.
   */
  @IsNumber()
  @Min(0)
  acceptedQty!: number;

  /** Refuse the line: accepted forced to 0 and any hold released. */
  @IsOptional()
  @IsBoolean()
  cancelled?: boolean;
}

/** Customer Relations' review of an incoming order. */
export class ReviewPurchaseOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReviewLineInput)
  lines!: ReviewLineInput[];
}

/** Act on an order's workflow task: forward / approve / reject / cancel. */
export class ActPurchaseOrderDto {
  @IsString()
  @IsEnum(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action!: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
