import { IsEnum, IsInt, IsOptional } from 'class-validator';
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
