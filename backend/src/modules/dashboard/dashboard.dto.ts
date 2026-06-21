import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateDashboardDto {
  @IsInt()
  @IsNotEmpty()
  moduleId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsInt() userGroupId?: number;
  @IsOptional() @IsInt() objectId?: number;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateDashboardDto extends PartialType(CreateDashboardDto) {}

export class WidgetDto {
  @IsInt()
  gadgetId: number;

  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsBoolean() hidden?: boolean;
}

export class SetWidgetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WidgetDto)
  widgets: WidgetDto[];
}

export class SaveLayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WidgetDto)
  widgets: WidgetDto[];
}
