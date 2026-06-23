import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCurrencyDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  fractionalUnit: string;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCurrencyDto extends PartialType(CreateCurrencyDto) {}
