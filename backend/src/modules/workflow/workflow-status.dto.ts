import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** A reusable document status (name + icon) shown in the listing. */
export class CreateWorkflowStatusDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  /** lucide icon name (see the frontend icon library). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkflowStatusDto extends PartialType(
  CreateWorkflowStatusDto,
) {}
