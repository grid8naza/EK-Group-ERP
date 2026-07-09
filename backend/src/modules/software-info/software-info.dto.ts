import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Save the software-info singleton. All fields optional so a partial save keeps
 * the rest. `logoUrl` is normally set by the upload endpoint, not here.
 */
export class SaveSoftwareInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  softwareName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  softwareVersion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  licenceKey?: string | null;

  @IsOptional()
  @IsISO8601()
  subscriptionExpiry?: string | null;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(16)
  @Max(56)
  logoSize?: number | null;
}
