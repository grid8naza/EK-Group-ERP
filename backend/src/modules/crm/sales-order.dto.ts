import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One sales-order line — how much of `productId` the seller commits to supply.
 *
 * Only the quantity is editable. The product, its unit and its rate all come
 * from the ICPO this order was converted from: the seller decides how much to
 * send, not what it costs — that price is what the buyer's approver signed off.
 * A line set to 0 is dropped from the order.
 */
export class SalesOrderLineInput {
  @IsInt()
  productId!: number;

  /** 0 drops the line. Negative is rejected. */
  @IsNumber()
  @Min(0)
  quantity!: number;
}

/** Edit a draft (or an in-workflow order when the step allows editing). */
export class UpdateSalesOrderDto {
  /** What the seller commits to, seeded from the buyer's requested date. */
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
  @Type(() => SalesOrderLineInput)
  lines?: SalesOrderLineInput[];
}

/** Act on an order's workflow task: forward / approve / reject / cancel. */
export class ActSalesOrderDto {
  @IsString()
  @IsEnum(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action!: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
