import { PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductionStatus } from '@prisma/client';

export class CreateProductionOrderDto {
  // Auto-generated (PO-0001, per company) when omitted.
  @IsOptional() @IsString() orderNo?: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsEnum(ProductionStatus) status?: ProductionStatus;
  @IsOptional() @IsDateString() plannedDate?: string;
  @IsOptional() @IsDateString() completedDate?: string;
  @IsOptional() @IsInt() assignedUserId?: number;
  @IsOptional() @IsString() remarks?: string;
}

export class UpdateProductionOrderDto extends PartialType(
  CreateProductionOrderDto,
) {}
