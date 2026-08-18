import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAX_MINUTES = 24 * 60 - 1;

export class CreateHrShiftDto {
  /**
   * The branches that work this shift. Empty or absent = every branch, which
   * is the default and the only answer for a company that keeps none.
   */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  branchIds?: number[];

  /** The short form a roster is read by — M, N, GEN. */
  @ApiProperty({ example: 'M' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  @ApiProperty({ example: 'Morning' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiProperty({ description: 'Minutes after local midnight (06:00 = 360)' })
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  timeIn: number;

  @ApiProperty({ description: 'Same units. At or before timeIn = overnight.' })
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  timeOut: number;

  /** Unpaid break inside the shift, in minutes. */
  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  breakMinutes?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHrShiftDto extends CreateHrShiftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  declare code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  declare name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  declare timeIn: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  declare timeOut: number;
}

/** One line of the roster — this person, this shift, from this day. */
export class SaveShiftAssignmentDto {
  @ApiProperty()
  @IsInt()
  shiftId: number;

  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  effectiveFrom: string;

  /** Null = until changed, which the newest row usually is. */
  @ApiPropertyOptional({ nullable: true, example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string | null;
}
