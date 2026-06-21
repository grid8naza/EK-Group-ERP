import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() taxNumber?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export class SetCompanyModulesDto {
  @IsArray()
  @IsInt({ each: true })
  moduleIds: number[];
}
