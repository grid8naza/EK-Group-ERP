import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateUserGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() description?: string;

  /**
   * Discount authority of this group's members — a DISCOUNT_LEVEL LookupValue
   * (Inventory > Lookups). Billing reads it to turn the logged-in user into a
   * discount ceiling, then indexes the product's discount matrix by it. Null =
   * this group may give no discount.
   */
  @IsOptional() @IsInt() discountLevelId?: number | null;

  // One or more modules this group can manage.
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  moduleIds: number[];
}

export class UpdateUserGroupDto extends PartialType(CreateUserGroupDto) {}

export class MainMenuAccessDto {
  @IsInt()
  mainMenuId: number;

  @IsBoolean()
  visible: boolean;
}

export class SubMenuPrivilegeDto {
  @IsInt()
  subMenuId: number;

  @IsBoolean()
  canMenu: boolean;

  @IsBoolean()
  canView: boolean;

  @IsBoolean()
  canAdd: boolean;

  @IsBoolean()
  canEdit: boolean;

  @IsBoolean()
  canDelete: boolean;

  @IsOptional() @IsBoolean() canLock?: boolean;
  @IsOptional() @IsBoolean() canUnlock?: boolean;

  @IsOptional() @IsBoolean() canPrint?: boolean;
  @IsOptional() @IsBoolean() canDownloadPdf?: boolean;
  @IsOptional() @IsBoolean() canDownloadExcel?: boolean;
}

/** Whether this group sees one tab of a multi-tab screen. */
export class SubMenuTabAccessDto {
  @IsInt()
  subMenuTabId: number;

  @IsBoolean()
  visible: boolean;
}

export class UpdatePrivilegesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MainMenuAccessDto)
  mainMenuAccess: MainMenuAccessDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubMenuPrivilegeDto)
  subMenuPrivileges: SubMenuPrivilegeDto[];

  // Tab visibility for the multi-tab screens on show. Optional so a client that
  // predates tabs still saves everything else.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubMenuTabAccessDto)
  subMenuTabs?: SubMenuTabAccessDto[];

  // Dashboard ids selected for this group.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  dashboardIds?: number[];
}
