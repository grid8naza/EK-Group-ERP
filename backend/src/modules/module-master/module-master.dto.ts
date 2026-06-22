import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateModuleDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isCore?: boolean;

  // Companies a user (non-core) module is available to. Ignored for core
  // modules, which are universal.
  @IsOptional() @IsArray() @IsInt({ each: true }) companyIds?: number[];
}

export class UpdateModuleDto extends PartialType(CreateModuleDto) {}
