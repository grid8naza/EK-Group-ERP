import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SaveBatchNumberingRuleDto {
  /** The branch this rule applies to; null/omitted = the company-level rule. */
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @IsOptional()
  @IsBoolean()
  prefixEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  prefixValue?: string | null;

  @IsOptional()
  @IsIn(['YYMMDD', 'YYYYMMDD'])
  dateFormat?: 'YYMMDD' | 'YYYYMMDD';

  @IsOptional()
  @IsInt()
  @Min(1)
  paddingLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  startingNo?: number;

  @IsOptional()
  @IsIn(['DAILY', 'MONTHLY', 'YEARLY'])
  renumber?: 'DAILY' | 'MONTHLY' | 'YEARLY';
}
