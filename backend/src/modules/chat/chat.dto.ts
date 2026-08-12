import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Ceiling on a single message. Long enough for a paragraph, short of an essay. */
const MAX_BODY = 4000;

/**
 * A file already uploaded via POST /chat/attachments, handed back when the
 * message that carries it is sent.
 *
 * Two steps rather than one multipart send, because a message can carry several
 * files and the user expects each to show its own progress as it goes. The URL
 * is re-checked against the chat upload prefix on send — this shape arrives from
 * the client, so it is a claim, not a fact.
 */
export class ChatAttachmentRefDto {
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

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  body?: string;

  /** The message being quoted, if any. Must be in the same conversation. */
  @IsOptional()
  @IsInt()
  replyToId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentRefDto)
  attachments?: ChatAttachmentRefDto[];
}

export class EditMessageDto {
  @IsString()
  @MaxLength(MAX_BODY)
  body!: string;
}

/** Start a one-to-one chat. Existing thread with that person is reused. */
export class StartDirectDto {
  @IsInt()
  userId!: number;
}

export class CreateGroupDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  /** Members besides the creator, who is always added as its admin. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @IsInt({ each: true })
  userIds!: number[];
}

export class RenameGroupDto {
  @IsString()
  @MaxLength(120)
  title!: string;
}

export class AddParticipantsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @IsInt({ each: true })
  userIds!: number[];
}

/**
 * How far the reader has got. Sent explicitly rather than assumed to be the end
 * of the thread: a person scrolled up in a long conversation has not read the
 * newest message, and marking it read would lose their place.
 */
export class MarkReadDto {
  @IsInt()
  lastMessageId!: number;
}
