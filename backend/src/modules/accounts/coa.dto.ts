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
import { AccountNature, BalanceSide, PartyKind } from '@prisma/client';

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
 * The master fields that may be edited. Code, group, nature, side and statement
 * are deliberately absent — they decide which statement an account lands in, so
 * changing one after the fact would move balances silently.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Ask for a cost centre on a line to this account. */
  @IsOptional()
  @IsBoolean()
  hasCostCenter?: boolean;

  /** Ask for a cost object too. Implies hasCostCenter. */
  @IsOptional()
  @IsBoolean()
  hasCostObject?: boolean;

  @IsOptional()
  @IsBoolean()
  allowManualJe?: boolean;

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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tallyGroup?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tallyGroup?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
