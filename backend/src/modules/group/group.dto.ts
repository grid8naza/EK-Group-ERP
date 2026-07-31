import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGroupDto {
  /**
   * Categories this group serves — at least one. A group is shared, so "Bakery"
   * can name both the semi-finished and the finished category instead of being
   * entered under each. A sub-group's categories must be a subset of its
   * parent's.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  categoryIds!: number[];

  /** When set, this is a sub-group under that (sub-group-applicable) group. */
  @IsOptional()
  @IsInt()
  parentGroupId?: number | null;

  /** true = this group holds sub-groups (a container) and cannot hold items. */
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

export class UpdateGroupDto {
  /**
   * Categories may be re-picked after creation (unlike the parent and level,
   * which are baked into the code) — the service rejects a set that would
   * strand a sub-group, item or product already under this one.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  categoryIds?: number[];

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
