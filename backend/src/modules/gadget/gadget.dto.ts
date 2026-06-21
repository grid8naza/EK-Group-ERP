import { PartialType } from '@nestjs/swagger';
import { GadgetType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateGadgetDto {
  @IsInt()
  @IsNotEmpty()
  moduleId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsEnum(GadgetType) type?: GadgetType;
  @IsOptional() @IsString() code?: string; // auto-generated when omitted
  @IsOptional() @IsString() description?: string;
  // type-specific: { source } | { text } | { url, height } | { hint, icon }
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateGadgetDto extends PartialType(CreateGadgetDto) {}
