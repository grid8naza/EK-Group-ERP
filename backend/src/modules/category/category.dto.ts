import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  // Code is system-generated; ignored if sent. Kept optional for compatibility.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** true = available to every company; otherwise `companyIds` applies. */
  @IsOptional()
  @IsBoolean()
  allCompanies?: boolean;

  /** Companies this category is available in (when not allCompanies). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  companyIds?: number[];

  @IsOptional()
  @IsBoolean()
  forItem?: boolean;

  @IsOptional()
  @IsBoolean()
  forProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  forPacking?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  // Code is system-generated and immutable; ignored if sent.
  @IsOptional()
  @IsString()
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
  @IsBoolean()
  allCompanies?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  companyIds?: number[];

  @IsOptional()
  @IsBoolean()
  forItem?: boolean;

  @IsOptional()
  @IsBoolean()
  forProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  forPacking?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
