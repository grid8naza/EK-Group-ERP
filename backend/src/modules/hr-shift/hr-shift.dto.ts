import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
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

/**
 * One change, one start date, a list of people.
 *
 * Rostering — or moving — a bakery of ninety by opening ninety records is not
 * a job anybody does, so this is the same assignment applied down a list. Each
 * person still goes through the ordinary rules.
 *
 * Every field below is OPTIONAL and absent means "leave it as it is": a
 * transfer that also changes the shift is one action, and so is a transfer that
 * does not. At least one of them has to be given, which the service checks.
 */
export class BulkAssignDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @ArrayNotEmpty()
  employeeIds: number[];

  /** The day it all takes effect — the posting and the shift alike. */
  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  effectiveFrom: string;

  /** Only meaningful for the shift; a posting runs until the next one. */
  @ApiPropertyOptional({ nullable: true, example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  shiftId?: number;

  /** Where they work from that day. Absent = leave them where they are. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  branchId?: number;

  /** Division — a Cpanel CostCenter, as on the employee and the posting. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  costCenterId?: number;

  /** Department — the CostObject under that division. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  costObjectId?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string | null;
}
