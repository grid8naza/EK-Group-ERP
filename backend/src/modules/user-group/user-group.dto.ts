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

  @IsOptional() @IsBoolean() canPrint?: boolean;
  @IsOptional() @IsBoolean() canDownloadPdf?: boolean;
  @IsOptional() @IsBoolean() canDownloadExcel?: boolean;
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

  // Dashboard ids selected for this group.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  dashboardIds?: number[];
}
