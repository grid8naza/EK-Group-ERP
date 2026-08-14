import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SaveNumberingRuleDto {
  @IsInt()
  documentId!: number;

  @IsOptional()
  @IsBoolean()
  prefixEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  prefixValue?: string | null;

  /** Whether the branch code leads the number. Ignored where the company has no branches. */
  @IsOptional()
  @IsBoolean()
  branchPrefix?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  startingNo?: number;

  @IsOptional()
  @IsBoolean()
  suffixEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  suffixValue?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  paddingLength?: number;

  @IsOptional()
  @IsIn(['NEVER', 'MONTHLY', 'YEARLY'])
  renumber?: 'NEVER' | 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @IsIn(['BEFORE_SUFFIX', 'AFTER_SUFFIX'])
  periodPosition?: 'BEFORE_SUFFIX' | 'AFTER_SUFFIX';
}
