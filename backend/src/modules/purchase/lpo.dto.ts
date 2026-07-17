import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One LPO line — `quantity` of an item OR a product, at `rate` each.
 *
 * `unitId` is deliberately absent: it's resolved server-side from the item /
 * product master, so a client can't disagree with the master.
 */
export class LpoLineInput {
  /** Exactly one of itemId / productId must be set. */
  @IsOptional()
  @IsInt()
  itemId?: number | null;

  @IsOptional()
  @IsInt()
  productId?: number | null;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  /** Agreed price per unit. Zero is allowed (e.g. a free sample). */
  @IsNumber()
  @Min(0)
  rate!: number;
}

/** Raise a Local Purchase Order on an external supplier. */
export class CreateLpoDto {
  /** The supplier the order is placed on — must belong to the active company. */
  @IsInt()
  supplierId!: number;

  /** Requested delivery date & time (ISO). */
  @IsOptional()
  @IsISO8601()
  deliveryAt?: string;

  /** Store the goods should be delivered to. */
  @IsOptional()
  @IsInt()
  storeId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LpoLineInput)
  lines!: LpoLineInput[];
}

/** Edit a draft (or an in-workflow order when the step allows editing). */
export class UpdateLpoDto {
  @IsOptional()
  @IsISO8601()
  deliveryAt?: string;

  @IsOptional()
  @IsInt()
  storeId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LpoLineInput)
  lines?: LpoLineInput[];
}

/** Act on an order's workflow task: forward / approve / reject / cancel. */
export class ActLpoDto {
  @IsString()
  @IsEnum(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action!: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
