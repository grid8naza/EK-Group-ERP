import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProductionPlanDto {
  /** Optional note; the plan itself is built from all pending work orders. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
