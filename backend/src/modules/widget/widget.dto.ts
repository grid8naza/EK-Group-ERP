import { PartialType } from '@nestjs/swagger';
import { WidgetType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateWidgetDto {
  @IsInt()
  @IsNotEmpty()
  moduleId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsEnum(WidgetType) type?: WidgetType;
  @IsOptional() @IsString() code?: string; // auto-generated when omitted
  @IsOptional() @IsString() description?: string;
  // type-specific: { source } | { text } | { url, height } | { hint, icon }
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateWidgetDto extends PartialType(CreateWidgetDto) {}

export class MetricValuesDto {
  // Metric keys to compute for the active company/branch, e.g.
  // ['production.orders.planned', 'inventory.items.total'].
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  keys: string[];
}
