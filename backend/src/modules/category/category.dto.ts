import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** GLOBAL = visible to all companies; COMPANY = only the active company. */
export type CategoryScope = 'GLOBAL' | 'COMPANY';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsIn(['GLOBAL', 'COMPANY'])
  scope!: CategoryScope;

  @IsOptional()
  @IsBoolean()
  forItem?: boolean;

  @IsOptional()
  @IsBoolean()
  forProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsIn(['GLOBAL', 'COMPANY'])
  scope?: CategoryScope;

  @IsOptional()
  @IsBoolean()
  forItem?: boolean;

  @IsOptional()
  @IsBoolean()
  forProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
