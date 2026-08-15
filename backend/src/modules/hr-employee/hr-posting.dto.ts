import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * One posting. Create and update share this shape — the house rule in HR — and
 * the SERVICE decides what a create requires.
 *
 * A promotion and a transfer are not different requests: both are this, with a
 * later `effectiveFrom` and something changed.
 */
export class SavePostingDto {
  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  /** Null = still there, which the newest posting usually is. */
  @ApiPropertyOptional({ nullable: true, example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  companyId?: number;

  /** Only where the company is branch-applicable; the service checks the flag. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  /** Division — a cost centre of that company, where the company uses them. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  /** Department — a cost object under that division. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costObjectId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  designationId?: number;

  @ApiPropertyOptional({ example: 'Promoted to Supervisor' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string | null;
}
