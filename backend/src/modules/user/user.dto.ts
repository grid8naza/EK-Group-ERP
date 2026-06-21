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
