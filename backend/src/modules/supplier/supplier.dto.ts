import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  gstNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  /** Days until a bill falls due — what an ageing report counts against. */
  @IsOptional()
  @IsInt()
  @Min(0)
  creditDays?: number | null;

  /** The most that may stand unpaid at once. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number | null;

  /**
   * Which control account this party's balance is part of — its main ledger.
   * Required: a supplier under no control account is part of no total.
   */
  @IsInt({ message: 'Choose the main ledger this supplier is kept under.' })
  controlAccountId!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  gstNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  /** Days until a bill falls due — what an ageing report counts against. */
  @IsOptional()
  @IsInt()
  @Min(0)
  creditDays?: number | null;

  /** The most that may stand unpaid at once. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number | null;

  /**
   * Which control account this party's balance is part of — its main ledger.
   * May be left out of a patch, but not sent empty: it cannot be cleared.
   */
  @IsOptional()
  @IsInt()
  controlAccountId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
