import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
 * One bill-wise allocation on a line — which of the party's bills this slice of
 * the amount belongs to.
 *
 * NEW names a bill coming into existence. AGAINST points back at one and settles
 * part of it. ADVANCE is money moved before there is a bill. ON_ACCOUNT is the
 * honest "we don't know yet", which stays visible as unallocated rather than
 * being forced onto the wrong invoice.
 */
export class BillAllocationInput {
  @IsIn(['NEW', 'AGAINST', 'ADVANCE', 'ON_ACCOUNT'])
  refType!: 'NEW' | 'AGAINST' | 'ADVANCE' | 'ON_ACCOUNT';

  /** The bill's own number. Required on NEW; ignored on the rest. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  billRef?: string;

  /**
   * Which way this allocation moves the balance. Defaults to the side of the
   * line it sits on, which is the ordinary case. Set it to the other side to
   * adjust a credit or debit note against what is being settled — the line's
   * amount is then the NET of them all.
   */
  @IsOptional()
  @IsIn(['DR', 'CR'])
  side?: 'DR' | 'CR';

  /**
   * What an advance or on-account amount is called. ADVANCE / ON_ACCOUNT only —
   * a bill already names itself, so this is ignored on NEW and AGAINST.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  refNote?: string;

  /** The bill being settled. Required on AGAINST. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  againstId?: number;

  @IsNumber()
  @IsPositive()
  amount!: number;

  /** Overrides the party's credit period for this bill. NEW only. */
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}

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
   * Which of the party's bills this line's amount belongs to. Required on a
   * control-account line and must sum to the line amount — that is what
   * bill-wise tracking IS.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BillAllocationInput)
  bills?: BillAllocationInput[];

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

/**
 * How a bank voucher's money moved — and, on a cheque, what was written on it.
 *
 * Asked for by the bank kinds and refused by the rest: an instrument on a
 * journal would be a fact about a payment that never happened.
 */
export class InstrumentInput {
  /** A live PAYMENT_MODE lookup value. */
  @IsInt()
  @IsPositive()
  modeValueId!: number;

  /**
   * The bank it is drawn on. Recorded whatever the posting does with it — a
   * post-dated cheque credits the holding account rather than this, and the
   * chequebook it came out of still has to be on the record.
   */
  @IsInt()
  @IsPositive()
  bankAccountId!: number;

  /** Required on a cheque; free on everything else. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  instrumentNo?: string | null;

  /** The date written on it — on a PDC, the day it may be presented. */
  @IsOptional()
  @IsISO8601()
  instrumentDate?: string | null;

  /** Required on a cheque, refused on anything else. */
  @IsOptional()
  @IsIn(['CDC', 'PDC'])
  chequeKind?: 'CDC' | 'PDC' | null;

  /**
   * Whose bank a cheque taken in was drawn on — an ISSUER_BANK lookup value.
   * A receipt only: on a payment the issuer is this company.
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  issuerBankValueId?: number | null;
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

  /** The document behind the entry — an advice number, a bill, a resolution. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

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

  /** Required on the bank kinds; refused on the others. */
  @IsOptional()
  @ValidateNested()
  @Type(() => InstrumentInput)
  instrument?: InstrumentInput;

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

  /** The document behind the entry — an advice number, a bill, a resolution. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

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

  /** Left out of a patch: the draft keeps the instrument it already had. */
  @IsOptional()
  @ValidateNested()
  @Type(() => InstrumentInput)
  instrument?: InstrumentInput;

  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class CancelVoucherDto {
  @IsString()
  @MaxLength(300)
  reason!: string;
}

/**
 * Acting on a voucher's approval task.
 *
 * The verbs are the engine's, not the books': what a step DOES on approval is
 * configured on the step, and the caller says only which of the five it is
 * taking. A comment is the reviewer's own words — worth having on a rejection
 * above all, since the writer has to know what to correct.
 */
export class ActVoucherDto {
  @IsString()
  @IsEnum(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action!: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** The day the bank saw a line — null takes it back off the statement. */
export class BankDateDto {
  @IsOptional()
  @IsISO8601()
  bankDate?: string | null;
}

/**
 * Moving a post-dated cheque on — banked, cleared, bounced, presented again,
 * replaced, torn up.
 *
 * One shape for all of them, because they are all the same fact: it became
 * something else, on a day, for a reason worth writing down. Which moves are
 * open from where is the service's business — see PDC_TRANSITIONS.
 */
export class PdcMoveDto {
  @IsIn([
    'SUBMITTED',
    'CLEARED',
    'BOUNCED',
    'RESUBMITTED',
    'REPLACED',
    'CANCELLED',
  ])
  status!:
    | 'SUBMITTED'
    | 'CLEARED'
    | 'BOUNCED'
    | 'RESUBMITTED'
    | 'REPLACED'
    | 'CANCELLED';

  /** The day it happened, which is rarely the day it is being entered. */
  @IsISO8601()
  date!: string;

  /** Short, and required where somebody will later ask why. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  remark?: string;
}
