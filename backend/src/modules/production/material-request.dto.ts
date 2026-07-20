import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { MaterialRequestStatus } from '@prisma/client';

export class GenerateMaterialRequestsDto {
  /** Optional target store; defaults to the company/branch default store. */
  @IsOptional()
  @IsInt()
  storeId?: number;
}

export class SetMaterialRequestStatusDto {
  @IsEnum(MaterialRequestStatus)
  status: MaterialRequestStatus;
}

/** What the store hands over for one requested line. */
export class IssueMaterialLineDto {
  @IsInt()
  lineId!: number;

  /** Never more than was requested; less is a short issue. */
  @IsNumber()
  @Min(0)
  issuedQty!: number;
}

export class IssueMaterialRequestDto {
  /** Omit a line to issue it in full; send 0 to issue nothing of it. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => IssueMaterialLineDto)
  lines?: IssueMaterialLineDto[];
}
