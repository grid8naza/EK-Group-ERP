import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Ceiling on a mail body. Generous — this is a letter, not a chat line. */
const MAX_BODY = 20000;

/**
 * A file already uploaded via POST /mail/attachments, handed back when the mail
 * that carries it is sent. The URL is re-checked against the mail upload prefix
 * on send — this shape arrives from the client, so it is a claim, not a fact.
 */
export class MailAttachmentRefDto {
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

export class SendMailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MaxLength(MAX_BODY)
  body!: string;

  /** Addressed directly. At least one is required — mail needs a recipient. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  to!: number[];

  /** Copied in. Same message, marked CC for the reader. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  cc?: number[];

  /** The mail this one answers, if any. */
  @IsOptional()
  @IsInt()
  replyToId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MailAttachmentRefDto)
  attachments?: MailAttachmentRefDto[];
}
