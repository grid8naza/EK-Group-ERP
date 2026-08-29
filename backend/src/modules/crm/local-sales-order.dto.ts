import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
 * One line of a customer order: how much of a product, at what price.
 *
 * Unlike an ICSO line, the RATE is entered rather than inherited. An ICSO is
 * converted from an ICPO whose approver already signed off a price, and its
 * batch-backed lines carry the price the goods were labelled at. A customer
 * order is the first document in its own chain — nobody has agreed a price
 * before it — so the branch states one.
 */
export class LocalSalesOrderLineDto {
  @ApiProperty()
  @IsInt()
  productId: number;

  @ApiProperty({ example: 40 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty()
  @IsInt()
  unitId: number;

  @ApiPropertyOptional({ example: 22.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;
}

export class CreateLocalSalesOrderDto {
  /** The external customer who ordered. */
  @ApiProperty()
  @IsInt()
  customerId: number;

  /** The branch supplying it. Omit where the company keeps no branches. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  /** When the customer wants it. Read by the Order Catalogue. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  deliveryAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [LocalSalesOrderLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LocalSalesOrderLineDto)
  lines: LocalSalesOrderLineDto[];
}

export class UpdateLocalSalesOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  customerId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  deliveryAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Lines are replaced wholesale when present; omit to leave them alone. */
  @ApiPropertyOptional({ type: [LocalSalesOrderLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LocalSalesOrderLineDto)
  lines?: LocalSalesOrderLineDto[];
}

/** Act on an order's workflow task: forward / approve / reject / cancel. */
export class ActLocalSalesOrderDto {
  @IsString()
  @IsEnum(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action!: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
