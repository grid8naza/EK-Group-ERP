import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Create a new database backup. Gated by the high security password. */
export class CreateBackupDto {
  @IsString()
  @MinLength(1)
  highSecurityPassword!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Restore the database from an existing server-side backup file. */
export class RestoreBackupDto {
  @IsString()
  @MinLength(1)
  highSecurityPassword!: string;

  /** File name of a backup that exists on the server (see GET /backup). */
  @IsString()
  @MinLength(1)
  fileName!: string;
}

/** Change the high security password (requires the current one). */
export class ChangeSecurityPasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  newPassword!: string;
}
