import { BroadcastPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Ceiling on an announcement. Shorter than a circular on purpose. */
const MAX_BODY = 5000;

/**
 * Who the broadcast is for — the same shape the circular takes, because it is
 * the same question: branches AND roles, per company (see AudienceSpec). The
 * ids are a claim; the port intersects the people they resolve to with whoever
 * the sender could reach by name anyway.
 */
export class BroadcastAudienceDto {
  @IsOptional()
  @IsBoolean()
  everyone?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  branchIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  userGroupIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  userIds?: number[];
}

export class SendBroadcastDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(MAX_BODY)
  body!: string;

  @ValidateNested()
  @Type(() => BroadcastAudienceDto)
  audience!: BroadcastAudienceDto;

  @IsOptional()
  @IsEnum(BroadcastPriority)
  priority?: BroadcastPriority;

  /** Show until (ISO date). Absent = until each reader dismisses it. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/** Ask who an audience would reach, before announcing to it. */
export class PreviewBroadcastAudienceDto {
  @ValidateNested()
  @Type(() => BroadcastAudienceDto)
  audience!: BroadcastAudienceDto;
}
