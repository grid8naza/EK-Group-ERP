import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ContractStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One product on the contract: how much goes out on each supply day, on which
 * days, and at what price.
 */
export class ContractLineDto {
  @ApiProperty()
  @IsInt()
  productId: number;

  /** How much goes out ON EACH SUPPLY DAY — not per week, not for the term. */
  @ApiProperty({ example: 40 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty()
  @IsInt()
  unitId: number;

  /** The price agreed for this contract, per unit. */
  @ApiPropertyOptional({ example: 22.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() supSun?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supMon?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supTue?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supWed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supThu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supFri?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() supSat?: boolean;
}

export class CreateContractDto {
  @ApiProperty()
  @IsInt()
  customerId: number;

  /** The branch that supplies it. Omit where the company keeps no branches. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @ApiPropertyOptional({ example: 'Little Flower School, 2026-27' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  /** Both INCLUSIVE. YYYY-MM-DD. */
  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ example: '2027-03-31' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [ContractLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContractLineDto)
  lines: ContractLineDto[];
}

export class UpdateContractDto extends PartialType(CreateContractDto) {
  /** Lines are replaced wholesale when present; omit to leave them alone. */
  @ApiPropertyOptional({ type: [ContractLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractLineDto)
  lines?: ContractLineDto[];
}

/**
 * What the contracts oblige a branch to hand over on one date, per product.
 *
 * This is what the Order Catalogue reads: the day's order has to carry the
 * contract supply on top of what the shelf needs, or the branch discovers on
 * Wednesday morning that the school's bread went to walk-in customers.
 */
export interface ContractDueLine {
  productId: number;
  /** Summed across every live contract that supplies this product that day. */
  quantity: number;
  unitId: number;
  /** Which contracts made it up — so a branch can see WHY it owes 120. */
  sources: {
    contractId: number;
    contractNo: string;
    customerName: string;
    quantity: number;
    rate: number;
  }[];
}
