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

/**
 * Credit terms are what an ageing report counts against: `creditDays` decides
 * when a bill falls due, `creditLimit` how much may stand unpaid at once. Both
 * optional — a cash customer has neither.
 */
export class CreateCustomerDto {
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

  @IsOptional()
  @IsInt()
  @Min(0)
  creditDays?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number | null;

  /**
   * Which control account this party's balance is part of — its main ledger.
   * Required: a customer under no control account is part of no total.
   */
  @IsInt({ message: 'Choose the main ledger this customer is kept under.' })
  controlAccountId!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCustomerDto {
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

  @IsOptional()
  @IsInt()
  @Min(0)
  creditDays?: number | null;

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
