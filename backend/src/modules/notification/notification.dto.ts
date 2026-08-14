import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
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

/** One user's whole set, as the Users & Data Security drawer saves it. */
export class SetPreferencesDto {
  @ApiProperty({ type: [SetPreferenceDto] })
  @IsArray()
  // There are eight categories; anything beyond that is a client with a bug or
  // a caller trying it on.
  @ArrayMaxSize(CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => SetPreferenceDto)
  items!: SetPreferenceDto[];
}
