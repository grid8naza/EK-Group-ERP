import { PartialType } from '@nestjs/swagger';
import { SecurityType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Modules assigned to the user within one company.
export class ModuleAssignmentDto {
  @IsInt()
  companyId: number;

  @IsArray()
  @IsInt({ each: true })
  moduleIds: number[];

  // The module that loads automatically when the user enters this company.
  // Must be one of moduleIds (the service ignores it otherwise).
  @IsOptional() @IsInt() defaultModuleId?: number | null;
}

export class CreateUserDto {
  /**
   * The employee this login belongs to. Required on create: a login is set up
   * on the person's own record (HR → Employee Master → User Access), so there
   * is always somebody it belongs to. The service checks they exist, are still
   * on the books, and hold no account already.
   */
  @IsInt()
  employeeId: number;

  @IsString()
  @IsNotEmpty()
  userCode: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsEmail() email?: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() mobileMac?: string;
  @IsOptional() @IsBoolean() webEnabled?: boolean;
  @IsOptional() @IsBoolean() mobileEnabled?: boolean;
  @IsOptional() @IsString() computerMac?: string;
  @IsOptional() @IsEnum(SecurityType) securityType?: SecurityType;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() remarks?: string;

  // Groups assigned to this user. Groups carry a companyId, so a user's group
  // (and rights) varies by company.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  groupIds?: number[];

  // Companies this user may log into.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  companyIds?: number[];

  // Branches this user may access (flat list across branch-applicable
  // companies, like groupIds). Each branch carries its own companyId.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  branchIds?: number[];

  // The user's default branch per company (the branch that loads automatically
  // when they enter that company). A subset of branchIds, at most one per
  // company; a flat list since each branch carries its own company.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  defaultBranchIds?: number[];

  // Per-company module assignment (a subset of each company's enabled modules).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleAssignmentDto)
  moduleAssignments?: ModuleAssignmentDto[];

  // Company that loads automatically after login.
  @IsOptional() @IsInt() defaultCompanyId?: number;

  // Module that loads automatically after login.
  @IsOptional() @IsInt() defaultModuleId?: number;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @IsString()
  password?: string;
}
