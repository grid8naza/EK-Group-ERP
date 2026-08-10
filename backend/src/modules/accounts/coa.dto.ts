import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AccountNature,
  BalanceSide,
  MainGroup,
  PartyKind,
} from '@prisma/client';

/** Adopt or drop an account for the active company. */
export class UpdateAdoptionDto {
  @IsOptional()
  @IsBoolean()
  adopted?: boolean;

  /** Company-specific label; blank clears it and the master name shows. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  localName?: string;

  @IsOptional()
  @IsBoolean()
  allowPosting?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * An account is settled the moment it is created. Everything about it —
 * its code, its group, what an entry to it is asked for, whether it takes a
 * hand-written journal — is decided then and fixed after, because each of them
 * changes what a posting to it MEANS, and the postings already made cannot be
 * asked to mean something else.
 *
 * That leaves two things: correcting a name, and taking an account out of use.
 * Anything else is a new account, which is a decision someone makes on purpose.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * The real bank account behind a ledger marked `isBank`, for the ACTIVE company.
 *
 * Unlike the master account this hangs from, all of it stays editable: a branch
 * moves, a bank merges and renames itself, a mandate is reissued in a different
 * name. None of that changes what a posting to the ledger means, which is what
 * fixes the master's fields at creation.
 *
 * Everything but the bank and the number is optional — a company that banks
 * domestically has no IBAN, and one holding a foreign account has no IFSC.
 * Blank clears a code rather than being ignored, so a wrong one can be removed.
 */
export class UpsertBankDetailsDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  bankName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  branchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  branchAddress?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  accountNumber!: string;

  /** A BANK_ACCOUNT_TYPE lookup value — current, savings, overdraft… */
  @IsOptional()
  @IsInt()
  @IsPositive()
  accountTypeValueId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  accountHolderName?: string;

  /**
   * The routing codes. Their formats are checked in CoaService rather than here,
   * so the same rule holds whichever way a row is written and the message can
   * name the code that is wrong.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ifscCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  micrCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  swiftCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  iban?: string;

  /** Set only where the account is held in something other than the company's
   *  own currency. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  currencyId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Where a new account belongs — the shared master, or one company's own books. */
export enum AccountScope {
  GROUP = 'GROUP',
  PRIVATE = 'PRIVATE',
}

/**
 * A new ledger account. Nature and statement are absent by design: both come
 * from the group, which is what keeps a balance in the statement its group rolls
 * up into.
 */
export class CreateAccountDto {
  @IsInt()
  @IsPositive()
  groupId!: number;

  /** Blank takes the next free code in the group. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: 'An account code is five digits.' })
  code?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsEnum(AccountScope)
  scope!: AccountScope;

  /** Defaults to the group's side; set only to flip a contra account. */
  @IsOptional()
  @IsEnum(BalanceSide)
  normalSide?: BalanceSide;

  @IsOptional()
  @IsBoolean()
  isContra?: boolean;

  @IsOptional()
  @IsBoolean()
  isControl?: boolean;

  @IsOptional()
  @IsEnum(PartyKind)
  controlParty?: PartyKind;

  @IsOptional()
  @IsBoolean()
  hasCostCenter?: boolean;

  @IsOptional()
  @IsBoolean()
  hasCostObject?: boolean;

  @IsOptional()
  @IsBoolean()
  isGstRelevant?: boolean;

  /** Money in hand. Mutually exclusive with isBank — see CoaService. */
  @IsOptional()
  @IsBoolean()
  isCash?: boolean;

  /** Money at a bank. */
  @IsOptional()
  @IsBoolean()
  isBank?: boolean;

  /** Where a post-dated cheque we wrote waits until it is presented. */
  @IsOptional()
  @IsBoolean()
  isPdcIssued?: boolean;

  /** Where a post-dated cheque we were given waits until it clears. */
  @IsOptional()
  @IsBoolean()
  isPdcReceived?: boolean;

  @IsOptional()
  @IsBoolean()
  isReconcilable?: boolean;

  @IsOptional()
  @IsBoolean()
  allowManualJe?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** A new group heading. Its nature comes from the parent when it has one. */
export class CreateGroupDto {
  @IsString()
  @Matches(/^\d{3}00$/, {
    message: 'A group code is five digits ending in 00.',
  })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  parentGroupId?: number;

  /** Required for a root group; ignored for a child, which follows its parent. */
  @IsOptional()
  @IsEnum(AccountNature)
  nature?: AccountNature;

  @IsOptional()
  @IsEnum(BalanceSide)
  normalSide?: BalanceSide;

  /** The schedule this block reports under. Top-level groups only. */
  @IsOptional()
  @IsEnum(MainGroup)
  mainGroup?: MainGroup;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tallyGroup?: string;
}

/**
 * As with an account: a group's shape is fixed once it exists. Its code, its
 * parent, what it holds and the schedule it reports under all decide where the
 * balances beneath it are presented, and moving any of them would restate
 * statements already published.
 */
export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
