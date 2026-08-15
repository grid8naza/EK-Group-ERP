import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalaryComponentKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One allowance paid or deduction taken, within a package. */
export class SalaryComponentDto {
  @ApiProperty({ enum: SalaryComponentKind })
  @IsEnum(SalaryComponentKind)
  kind: SalaryComponentKind;

  /** A SALARY_ALLOWANCE / SALARY_DEDUCTION LookupValue id. */
  @ApiProperty()
  @IsInt()
  componentId: number;

  @ApiProperty({ example: 5000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;
}

/**
 * One salary package. Create and update share this shape — the same rule the
 * rest of HR follows — and the SERVICE decides what a create requires.
 *
 * An increment is not a different kind of request: it is this, with a later
 * `effectiveFrom`.
 */
export class SaveSalaryPackageDto {
  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  /** Null = until further notice, which is what the newest package usually is. */
  @ApiPropertyOptional({ nullable: true, example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basicSalary?: number;

  @ApiPropertyOptional({ example: 'Annual increment' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string | null;

  /**
   * The whole component list. Sent entire: what arrives replaces what is
   * stored, so dropping an allowance is leaving it out. Capped at a number no
   * real package approaches, so a runaway client cannot write thousands of rows.
   */
  @ApiPropertyOptional({ type: [SalaryComponentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
