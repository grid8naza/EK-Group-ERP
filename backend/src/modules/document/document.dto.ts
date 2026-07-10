import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /** Optional explicit code; auto-derived from the name when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsOptional()
  @IsInt()
  transactionTypeId?: number | null;

  @IsOptional()
  @IsInt()
  transactionSubtypeId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsOptional()
  @IsInt()
  transactionTypeId?: number | null;

  @IsOptional()
  @IsInt()
  transactionSubtypeId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
