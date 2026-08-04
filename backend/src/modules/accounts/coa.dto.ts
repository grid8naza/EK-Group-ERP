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

  @IsOptional()
  @IsBoolean()
  isBankOrCash?: boolean;

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
