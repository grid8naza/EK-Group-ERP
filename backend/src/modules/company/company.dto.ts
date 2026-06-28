import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() logo?: string;

  // --- Financial / statutory details ---
  @IsOptional() @IsInt() @Min(1) @Max(12) financialYearStartMonth?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) financialYearEndMonth?: number;
  @IsOptional() @IsDateString() booksStartDate?: string;
  @IsOptional() @IsBoolean() costCenterApplicable?: boolean;
  @IsOptional() @IsBoolean() costObjectApplicable?: boolean;
  @IsOptional() @IsBoolean() branchApplicable?: boolean;
  @IsOptional() @IsInt() currencyId?: number;
  @IsOptional() @IsString() @MaxLength(21) cin?: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @IsOptional() @IsString() @MaxLength(12) pan?: string;
  @IsOptional() @IsString() @MaxLength(10) tan?: string;
  @IsOptional() @IsString() @MaxLength(12) ptrn?: string;
  @IsOptional() @IsString() @MaxLength(12) ptec?: string;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export class SetCompanyModulesDto {
  @IsArray()
  @IsInt({ each: true })
  moduleIds: number[];
}
