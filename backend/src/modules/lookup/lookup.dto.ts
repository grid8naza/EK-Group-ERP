import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLookupDto {
  /**
   * Stable internal key. Optional from the UI — the server generates one from
   * the name when omitted (see LookupService.create). Seeds still pass a fixed
   * code (e.g. ASSET_BRANDS) that dropdowns resolve by.
   */
  @IsOptional() @IsString() code?: string;

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

  /**
   * Stable internal key for this value. Optional from the UI — the server
   * derives it from the label when omitted, so the label can be renamed later
   * without changing what dependent records (e.g. Asset.brand) stored.
   */
  @IsOptional() @IsString() value?: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional() @IsString() alias?: string;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateLookupValueDto extends PartialType(CreateLookupValueDto) {}
