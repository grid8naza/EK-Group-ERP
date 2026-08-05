import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
 * One line of a voucher. A line carries EITHER a debit or a credit — both, or
 * neither, is refused rather than quietly resolved, because a line that means
 * two things means nothing to the ledger.
 */
export class VoucherLineInput {
  @IsInt()
  @IsPositive()
  accountId!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  /** Named only where the account asks for one. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  costCenterId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  costObjectId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  narration?: string;

  /**
   * WHOSE balance this line moves. Required when the account is a control
   * account (Sundry Debtors, Sundry Creditors) — its balance is only a total,
   * and without this the books cannot say whose.
   *
   * The kind is taken from the account's own `controlParty`, so it is not asked
   * for here: naming a customer against a creditors account would be a second
   * way to say something the chart already decided.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  partyId?: number;

  /**
   * What the transaction WAS, where this line differs from the header — one
   * voucher may carry both a B2B and a B2C line. Left unset, the line inherits
   * the header's classification.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  transactionTypeId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  transactionSubtypeId?: number;
}

export class CreateVoucherDto {
  @IsInt()
  @IsPositive()
  voucherTypeId!: number;

  @IsISO8601()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  narration?: string;

  /**
   * What the transaction was, over and above which kind of voucher recorded it:
   * a sale, and a B2C one. The subtype must belong to the type — see
   * VoucherService.resolveTransaction.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  transactionTypeId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  transactionSubtypeId?: number;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => VoucherLineInput)
  lines!: VoucherLineInput[];

  /** Write it straight to the books rather than leaving it as a draft. */
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

/** A draft may be rewritten entirely; a posted voucher may not be touched. */
export class UpdateVoucherDto {
  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  narration?: string;

  /**
   * What the transaction was, over and above which kind of voucher recorded it:
   * a sale, and a B2C one. The subtype must belong to the type — see
   * VoucherService.resolveTransaction.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  transactionTypeId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  transactionSubtypeId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => VoucherLineInput)
  lines?: VoucherLineInput[];

  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class CancelVoucherDto {
  @IsString()
  @MaxLength(300)
  reason!: string;
}
