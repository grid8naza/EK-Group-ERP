import { TaskPriority, TaskStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Ceiling on a description. A task is an instruction, not a document. */
const MAX_DESCRIPTION = 5000;

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION)
  description?: string;

  /** Who it is for. Empty is allowed: a note to yourself is a task too. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  assigneeIds?: number[];

  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsDateString() dueAt?: string;

  /**
   * Company-wide rather than for the active branch. The branch a task belongs
   * to otherwise comes from the header, not from the client — see TaskService.
   */
  @IsOptional() @IsBoolean() companyWide?: boolean;

  /** The checklist, written with the task rather than added afterwards. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  checklist?: string[];
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;

  @IsOptional() @IsString() @MaxLength(MAX_DESCRIPTION) description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  assigneeIds?: number[];

  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;

  /** Null clears the due date — "when you can" is a real answer. */
  @IsOptional() dueAt?: string | null;

  @IsOptional() @IsBoolean() companyWide?: boolean;
}

export class SetStatusDto {
  @IsEnum(TaskStatus) status!: TaskStatus;

  /** Where in the column it was dropped. Absent = leave the order alone. */
  @IsOptional() @IsInt() sortOrder?: number;
}

export class ChecklistItemDto {
  @IsString() @MinLength(1) @MaxLength(300) text!: string;
}

export class ToggleChecklistDto {
  @IsBoolean() isDone!: boolean;
}

export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
