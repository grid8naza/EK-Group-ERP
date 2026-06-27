import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Header banner appearance. All optional; unset fields fall back to the
// default brand-blue gradient and the standard subtitle.
export class DashboardHeaderDto {
  @IsOptional()
  @IsString()
  @IsIn(['blue', 'emerald', 'violet', 'amber', 'rose', 'slate', 'custom'])
  theme?: string;

  @IsOptional() @IsString() gradientFrom?: string; // hex, used when theme = custom
  @IsOptional() @IsString() gradientTo?: string; // hex, used when theme = custom
  @IsOptional() @IsBoolean() solid?: boolean; // solid fill (gradientFrom) instead of gradient
  @IsOptional() @IsString() subtitle?: string; // override subtitle text
  @IsOptional() @IsBoolean() pattern?: boolean; // decorative circle, default true
  @IsOptional() @IsBoolean() hidden?: boolean; // hide the banner entirely

  @IsOptional()
  @IsString()
  @IsIn(['left', 'center'])
  align?: string;

  @IsOptional()
  @IsString()
  @IsIn(['sm', 'md', 'lg'])
  size?: string; // banner padding / height
}

export class CreateDashboardDto {
  @IsInt()
  @IsNotEmpty()
  moduleId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsInt() branchId?: number | null; // null = company-wide
  @IsOptional() @IsInt() objectId?: number;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardHeaderDto)
  header?: DashboardHeaderDto;
}

export class UpdateDashboardDto extends PartialType(CreateDashboardDto) {}

export class SetHeaderDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardHeaderDto)
  header?: DashboardHeaderDto | null;
}

export class WidgetDto {
  @IsInt()
  widgetId: number;

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
