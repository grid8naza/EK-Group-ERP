import { PartialType } from '@nestjs/swagger';
import { ObjectType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class ReorderDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids: number[];
}

export class CreateMainMenuDto {
  @IsInt()
  @IsNotEmpty()
  moduleId: number;

  @IsOptional() @IsInt() sortOrder?: number;

  @IsString()
  @IsNotEmpty()
  menuName: string;

  @IsOptional() @IsEnum(ObjectType) objectType?: ObjectType;
  @IsOptional() @IsBoolean() isUserMenu?: boolean;
  @IsOptional() @IsString() icon?: string;
}

export class UpdateMainMenuDto extends PartialType(CreateMainMenuDto) {}

export class CreateSubMenuDto {
  @IsInt()
  @IsNotEmpty()
  mainMenuId: number;

  @IsOptional() @IsInt() objectId?: number;
  @IsOptional() @IsInt() sortOrder?: number;

  @IsString()
  @IsNotEmpty()
  subMenuName: string;

  @IsOptional() @IsEnum(ObjectType) objectType?: ObjectType;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsString() icon?: string;
}

export class UpdateSubMenuDto extends PartialType(CreateSubMenuDto) {}
