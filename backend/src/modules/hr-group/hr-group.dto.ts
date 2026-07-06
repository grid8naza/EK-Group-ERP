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

export class CreateHrGroupDto {
  /** Parent HR category this group belongs to (ignored for a sub-group,
   * which inherits its parent group's category). */
  @IsInt()
  categoryId!: number;

  /** When set, this is a sub-group under that (sub-group-applicable) group. */
  @IsOptional()
  @IsInt()
  parentGroupId?: number | null;

  /** true = this group holds sub-groups (a container). */
  @IsOptional()
  @IsBoolean()
  subGroupApplicable?: boolean;

  // Code is system-generated; ignored if sent.
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

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  companyIds?: number[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHrGroupDto {
  // categoryId / parentGroupId are immutable (part of the code) and ignored.
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsBoolean()
  subGroupApplicable?: boolean;

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
  isActive?: boolean;
}
