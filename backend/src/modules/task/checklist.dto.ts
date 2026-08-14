import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChecklistFrequency, TaskPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const FREQUENCIES = Object.values(ChecklistFrequency);
const PRIORITIES = Object.values(TaskPriority);

/** Minutes after local midnight — 0 to 23:59. */
const MAX_MINUTES = 24 * 60 - 1;

/**
 * One shape for create and update, so every field is OPTIONAL here — including
 * the name.
 *
 * A partial update is the normal case: Pause sends `{ isActive: false }` and
 * nothing else. Requiring the name at this layer made that a 400, which is
 * exactly what it did until somebody asked what the Pause button was for.
 * Whether a name is REQUIRED depends on whether the checklist is being created,
 * which only the service knows — and it checks (`fields`, isNew).
 */
export class SaveChecklistDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: FREQUENCIES })
  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: ChecklistFrequency;

  /** WEEKLY only. 0 = Sunday. */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  /** MONTHLY only. Clamped to the last day of shorter months. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  /** First day it may run, `YYYY-MM-DD`. Defaults to today. */
  @ApiPropertyOptional({ example: '2026-08-15' })
  @IsOptional()
  @IsDateString()
  startsOn?: string;

  /** Last day it may run. Null or absent = no end date. */
  @ApiPropertyOptional({ example: '2026-12-31', nullable: true })
  @IsOptional()
  @IsDateString()
  endsOn?: string | null;

  @ApiPropertyOptional({
    description: 'Minutes after local midnight (06:00 = 360)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  startMinutes?: number;

  @ApiPropertyOptional({
    description: 'Due by, same units. Null = end of that day.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINUTES)
  dueMinutes?: number | null;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: TaskPriority;

  /**
   * WHERE it applies. Both are chosen on the form rather than taken from the
   * company picker, because a schedule is set up for a place — often not the one
   * the person setting it up happens to be working in — and making them switch
   * company to write a checklist for another branch is a step that exists only
   * because the data model asked for it.
   *
   * Absent on a create: the active company and branch, which is the common case.
   * `branchId: null` means the whole company.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  companyId?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  assigneeIds?: number[];

  /** The lines, in order. Sent whole: the editor owns the list, not the deltas. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  items?: string[];
}
