import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PackingLineInput {
  /** The packed product to produce. */
  @IsInt()
  productId: number;

  @IsNumber()
  @Min(0.0001)
  quantity: number;
}

export class CreatePackingDto {
  /** Target store; defaults to the company/branch default store. */
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PackingLineInput)
  lines: PackingLineInput[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
