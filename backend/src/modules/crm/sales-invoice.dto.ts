import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EInvoiceStatus, GstSupplyType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSalesInvoiceDto {
  /** The delivery note being billed — a stock transaction of type SALE. */
  @ApiProperty()
  @IsInt()
  deliveryNoteId: number;

  /** Overrides the note's own customer. Rarely needed. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  customerId?: number;

  /** Defaults to the delivery note's date — the day the goods went. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  invoiceDate?: string;

  /**
   * The 2-digit GST state code the supply is made to. Resolved from the
   * customer's GSTIN or state when omitted; give it only to override.
   */
  @ApiPropertyOptional({ example: '32' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  placeOfSupplyCode?: string;

  @ApiPropertyOptional({ enum: GstSupplyType })
  @IsOptional()
  @IsEnum(GstSupplyType)
  supplyType?: GstSupplyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reverseCharge?: boolean;

  /** The contract this delivery was made under, for the record. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  contractId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Only what is ours to change on a draft. Lines come from the delivery note. */
export class UpdateSalesInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  invoiceDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reverseCharge?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * What the Invoice Registration Portal returned.
 *
 * Entered by hand today; the shape is the IRP's own, so wiring the upload later
 * changes who calls this, not what it stores.
 */
export class EInvoiceDto {
  /** The 64-character Invoice Reference Number. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  irn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ackNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  ackDate?: string;

  /** The signed QR the IRP returns (a JWT), printed on the bill. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  signedQrCode?: string;

  @ApiPropertyOptional({ enum: EInvoiceStatus })
  @IsOptional()
  @IsEnum(EInvoiceStatus)
  status?: EInvoiceStatus;

  /** What the IRP rejected it for, where it did. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

/** The e-way bill the portal issued for this consignment. */
export class EwayBillDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ewbNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  ewbDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  ewbValidUntil?: string;

  /** Kilometres — what decides the bill's validity period. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  distanceKm?: number;

  @ApiPropertyOptional({ example: 'Road' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  transportMode?: string;

  /** The transporter's GSTIN or enrolment id. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  transporterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transporterName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehicleNo?: string;
}
