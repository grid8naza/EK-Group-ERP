import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AssetBookingStatus } from '@prisma/client';

// "HH:mm" 24-hour clock (00:00–23:59).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A production-line booking reserves a machine for a product/batch over a time
 * slot on a day. Created/updated from the Production module while planning. The
 * Product is referenced by plain id (Inventory domain) with a name snapshot.
 */
export class CreateAssetBookingDto {
  @IsInt()
  assetId!: number;

  /** Inventory Product id (optional — a snapshot name is always kept). */
  @IsOptional()
  @IsInt()
  productId?: number | null;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  productName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  batchNo?: string;

  /** Booking day (ISO date; time is carried by timeFrom/timeTo). */
  @IsString()
  date!: string;

  @Matches(TIME_RE, { message: 'timeFrom must be "HH:mm".' })
  timeFrom!: string;

  @Matches(TIME_RE, { message: 'timeTo must be "HH:mm".' })
  timeTo!: string;

  @IsOptional()
  @IsEnum(AssetBookingStatus)
  status?: AssetBookingStatus;
}

export class UpdateAssetBookingDto {
  @IsOptional()
  @IsInt()
  productId?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  batchNo?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'timeFrom must be "HH:mm".' })
  timeFrom?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'timeTo must be "HH:mm".' })
  timeTo?: string;

  @IsOptional()
  @IsEnum(AssetBookingStatus)
  status?: AssetBookingStatus;
}
