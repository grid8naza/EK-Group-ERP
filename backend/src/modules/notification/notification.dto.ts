import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { NotificationCategory } from '@prisma/client';

/** The categories a reader may address a preference to. */
const CATEGORIES = Object.values(NotificationCategory);

export class SetPreferenceDto {
  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category!: string;

  /** Off means the alert is never raised for this person (see the schema). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  /** Reserved for FR-COM-06 — stored now, honoured when a transport ships. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  push?: boolean;
}
