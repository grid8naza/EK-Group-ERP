import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UnitType } from '@prisma/client';

/// One rung of a CHAINING unit's ladder, top → bottom: `1 (level above) =
/// quantity × the unit identified by unitId`.
export class ChainLinkInput {
  @IsInt()
  unitId!: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class CreateUnitDto {
  // System-generated when omitted (the UI never asks for one). Seeds may still
  // pass a fixed code — honoured when present.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;

  @IsEnum(UnitType)
  type!: UnitType;

  // COMPOUND only — the simple base unit and the conversion factor.
  @IsOptional()
  @IsInt()
  baseUnitId?: number | null;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  conversionFactor?: number | null;

  // CHAINING only — the ordered ladder of rungs (top → bottom). The resolved
  // baseUnitId/conversionFactor are computed from this on the server.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChainLinkInput)
  chainLinks?: ChainLinkInput[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;

  @IsOptional()
  @IsEnum(UnitType)
  type?: UnitType;

  @IsOptional()
  @IsInt()
  baseUnitId?: number | null;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  conversionFactor?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChainLinkInput)
  chainLinks?: ChainLinkInput[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
