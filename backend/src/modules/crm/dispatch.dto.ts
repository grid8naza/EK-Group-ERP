import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDispatchDto {
  /** Source store; defaults to the company/branch default store. */
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  driverName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehicleNo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
