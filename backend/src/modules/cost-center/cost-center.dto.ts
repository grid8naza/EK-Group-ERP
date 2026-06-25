import { OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCostCenterDto {
  @IsInt()
  companyId: number;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// A cost center can't be moved between companies, so companyId is not updatable.
export class UpdateCostCenterDto extends PartialType(
  OmitType(CreateCostCenterDto, ['companyId'] as const),
) {}
