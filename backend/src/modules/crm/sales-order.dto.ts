import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** One order line — `quantity` of `productId`, measured in `unitId`. */
export class SalesOrderLineInput {
  @IsInt()
  productId!: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsInt()
  unitId!: number;
}

/** Place a sales order on a supplier company. */
export class CreateSalesOrderDto {
  /** Supplier company the order is placed on (owns / receives the order). */
  @IsInt()
  supplierCompanyId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineInput)
  lines!: SalesOrderLineInput[];
}
