import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateHsnCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cgst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sgst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  igst?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHsnCodeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cgst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sgst?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  igst?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
