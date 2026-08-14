import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeSex, MaritalStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SEXES = Object.values(EmployeeSex);
const MARITAL_STATUSES = Object.values(MaritalStatus);

/**
 * One employee. Create and update share this shape, so every field is optional
 * here and the SERVICE decides what a create requires — the same rule the
 * recurring checklists settled on, after a partial update (which is the normal
 * case) was rejected for want of a field it was not changing.
 */
export class SaveEmployeeDto {
  // Code is system-generated (EMP-0001 per company); ignored if sent.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  // ---- the person ----

  @ApiPropertyOptional({ example: '1994-03-17' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: SEXES })
  @IsOptional()
  @IsIn(SEXES)
  sex?: EmployeeSex | null;

  @ApiPropertyOptional({ enum: MARITAL_STATUSES })
  @IsOptional()
  @IsIn(MARITAL_STATUSES)
  maritalStatus?: MaritalStatus | null;

  /** 12 digits. Checked as a shape only — nothing here verifies it with UIDAI. */
  @ApiPropertyOptional({ example: '123412341234' })
  @IsOptional()
  @Matches(/^\d{12}$/, {
    message: 'An Aadhaar number is 12 digits.',
  })
  aadhaarNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string | null;

  /** Returned by POST /hr-employees/photo. Required on create. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  photoUrl?: string;

  // ---- the job ----

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  companyId?: number;

  /** Null = the company as a whole (head office, roving staff). */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  /** Division — a cost centre of the employee's company. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  /** Department — a cost object under that division. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costObjectId?: number | null;

  /**
   * What they are. The category and group are NOT sent: a designation already
   * knows both, and accepting them would be a second answer to one question.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  designationId?: number;

  @ApiPropertyOptional({ example: '2026-08-14' })
  @IsOptional()
  @IsDateString()
  dateOfJoin?: string;

  /** Their manager — another employee of the same company. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  reportsToId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
