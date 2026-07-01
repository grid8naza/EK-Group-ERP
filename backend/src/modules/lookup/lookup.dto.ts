import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLookupDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() description?: string;
  /** Module this lookup belongs to (null = global / all modules). */
  @IsOptional() @IsInt() moduleId?: number | null;
  @IsOptional() @IsBoolean() isSystem?: boolean;
}

export class UpdateLookupDto extends PartialType(CreateLookupDto) {}

export class CreateLookupValueDto {
  @IsInt()
  @IsNotEmpty()
  lookupId: number;

  @IsString()
  @IsNotEmpty()
  value: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional() @IsString() alias?: string;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateLookupValueDto extends PartialType(CreateLookupValueDto) {}
