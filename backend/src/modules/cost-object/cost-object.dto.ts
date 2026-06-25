import { OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCostObjectDto {
  // The parent cost center. The company is derived from it.
  @IsInt()
  costCenterId: number;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// A cost object can't be moved between cost centers, so costCenterId is not
// updatable.
export class UpdateCostObjectDto extends PartialType(
  OmitType(CreateCostObjectDto, ['costCenterId'] as const),
) {}
