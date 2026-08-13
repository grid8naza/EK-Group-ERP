import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Ceiling on a circular's text. A notice, not a chat line — same as mail. */
const MAX_BODY = 20000;

/**
 * Who the circular is for: branches AND roles, per company — see AudienceSpec.
 *
 * The ids are a claim. The port intersects the people they resolve to with
 * whoever the issuer could reach by name anyway, so a guessed id reaches nobody
 * new.
 */
export class CircularAudienceDto {
  /** Everybody the issuer can reach. When set, the rest are ignored. */
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

  /** Named people, on top of whatever the groups above bring in. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  userIds?: number[];
}

/**
 * A file already uploaded via POST /circulars/attachments, handed back when the
 * circular that carries it is issued. The URL is re-checked against the circular
 * upload prefix on issue — this shape arrives from the client, so it is a claim.
 */
export class CircularAttachmentRefDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(500)
  url!: string;

  @IsString()
  @MaxLength(150)
  mimeType!: string;

  @IsInt()
  @Min(0)
  size!: number;
}

export class IssueCircularDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(MAX_BODY)
  body!: string;

  @ValidateNested()
  @Type(() => CircularAudienceDto)
  audience!: CircularAudienceDto;

  /** Whether the audience must acknowledge it. Defaults to yes — see the model. */
  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;

  /** Acknowledge by (ISO date). Only meaningful when an acknowledgement is asked. */
  @IsOptional()
  @IsDateString()
  ackDueAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CircularAttachmentRefDto)
  attachments?: CircularAttachmentRefDto[];
}

/**
 * A circular being saved rather than issued.
 *
 * Everything optional — that is what a draft is. What a circular must have to
 * GO is checked when it goes, through the strict DTO above, so a draft can
 * never be a way round the rules.
 */
export class SaveCircularDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  body?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CircularAudienceDto)
  audience?: CircularAudienceDto;

  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;

  @IsOptional()
  @IsDateString()
  ackDueAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CircularAttachmentRefDto)
  attachments?: CircularAttachmentRefDto[];
}

/** What a reader says when acknowledging, if anything. */
export class AcknowledgeCircularDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Ask who an audience would reach, before issuing to it. */
export class PreviewAudienceDto {
  @ValidateNested()
  @Type(() => CircularAudienceDto)
  audience!: CircularAudienceDto;
}
