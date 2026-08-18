import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** The last minute of a day — 23:59. */
const MAX_MINUTES = 24 * 60 - 1;

// ---------------------------------------------------------------- settings --

export class SaveAttendanceSettingDto {
  /** Null / absent = the company's own default, used by branches without one. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @ApiProperty({ description: 'Minutes after local midnight (09:00 = 540)' })
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  defaultTimeIn: number;

  @ApiProperty({ description: 'Minutes after local midnight (18:00 = 1080)' })
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  defaultTimeOut: number;

  /** An ATTENDANCE_TYPE LookupValue — what a fresh line says. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  defaultTypeId?: number | null;

  /** 0 = Sunday … 6 = Saturday. */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @ArrayMaxSize(7)
  weeklyOffDays?: number[];
}

// ---------------------------------------------------------------- holidays --

export class SaveHolidayDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name: string;
}

// ------------------------------------------------------------------ sheets --

/** One employee's line as the incharge left it. */
export class AttendanceEntryDto {
  @ApiProperty()
  @IsInt()
  employeeId: number;

  @ApiProperty({ description: 'An ATTENDANCE_TYPE LookupValue id' })
  @IsInt()
  typeId: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Minutes after midnight',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  timeIn?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  timeOut?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string | null;
}

export class SaveAttendanceSheetDto {
  @ApiProperty({ example: '2026-03-18' })
  @IsDateString()
  date: string;

  /**
   * Whose sheet this is. Null / absent = the branch's own — everybody there
   * who is in no team, which is the only sheet a branch without teams has.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  teamId?: number | null;

  /** About the day as a whole, not about one person. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string | null;

  @ApiProperty({ type: [AttendanceEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];
}

/** Approve / forward / reject / cancel the sheet's workflow task. */
export class ActAttendanceDto {
  @ApiProperty({
    enum: ['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'],
  })
  @IsIn(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
