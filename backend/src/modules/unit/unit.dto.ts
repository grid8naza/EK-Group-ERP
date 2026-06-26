import {
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
} from 'class-validator';
import { UnitType } from '@prisma/client';

export class CreateUnitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

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
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
