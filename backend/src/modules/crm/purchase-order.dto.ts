import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
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
