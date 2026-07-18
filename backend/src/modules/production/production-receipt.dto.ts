import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordProductionDto {
  /** Target store; defaults to the company/branch default store. */
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
