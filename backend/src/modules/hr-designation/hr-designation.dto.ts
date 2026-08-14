import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateHrDesignationDto {
  // Code is system-generated; ignored if sent.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  /** Leaf HR group this designation belongs to (its category is derived from it). */
  @IsInt()
  groupId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** Manpower cost rate per hour (used in recipe process costing). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  ratePerHour?: number;

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

export class UpdateHrDesignationDto {
  // The code itself is system-generated and ignored if sent — but the GROUP can
  // now be changed, which re-derives it. See the service: the row keeps its id,
  // so every recipe and packing process holding `designationId` is untouched.
  // The category is not accepted, because it follows the group.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  /** Move it to another leaf group. Its code is re-derived from that group. */
  @IsOptional()
  @IsInt()
  groupId?: number;

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
  @IsNumber()
  @Min(0)
  ratePerHour?: number;

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
