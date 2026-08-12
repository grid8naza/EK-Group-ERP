import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, interval, map, merge } from 'rxjs';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { ChatService, UploadedChatFile } from './chat.service';
import { ChatEventsService } from './chat-events.service';
import { CHAT_MAX_FILE_BYTES, CHAT_UPLOAD_DIR } from './chat.constants';
import {
  AddParticipantsDto,
  CreateGroupDto,
  EditMessageDto,
  MarkReadDto,
  RenameGroupDto,
  SendMessageDto,
  StartDirectDto,
} from './chat.dto';

/** How often the open stream sends a keep-alive. */
const HEARTBEAT_MS = 25_000;

/**
 * Internal chat (SRS §8.11, FR-COM-02).
 *
 * Everything is scoped to the authenticated user — a conversation is reachable
 * because you are IN it, never because of the company you are working in — so no
 * route takes a user id, and X-Company-Id is read only to stamp where a new
 * conversation started.
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(
    private readonly service: ChatService,
    private readonly events: ChatEventsService,
  ) {}

  // ------------------------------------------------------------ the stream --

  /**
   * The live feed of everything happening to this user's conversations.
   *
   * Merged with a heartbeat because an idle SSE connection is indistinguishable
   * from a dead one to any proxy between here and the browser — a comment every
   * 25s keeps it open and lets the client notice quickly when it is not.
   */
  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<{
    type: string;
    data: string;
  }> {
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map(() => ({ type: 'ping', data: {} as unknown })),
    );
    return merge(this.events.subscribe(user.id), heartbeat).pipe(
      // SSE frames are text; serializing here keeps the event shape identical
      // whatever the payload.
      map((e) => ({ type: e.type, data: JSON.stringify(e.data) })),
    );
  }

  // ------------------------------------------------------------- the people --

  @Get('directory')
  directory(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.service.directory(user.id, q);
  }

  // ------------------------------------------------------- the conversations --

  @Get('conversations')
  conversations(@CurrentUser() user: AuthUser) {
    return this.service.listConversations(user.id);
  }

  @Get('conversations/:id')
  conversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.getConversation(user.id, id);
  }

  @Post('conversations/direct')
  startDirect(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartDirectDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.startDirect(user.id, dto.userId, companyId, branchId);
  }

  @Post('conversations/group')
  createGroup(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGroupDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.createGroup(user.id, dto, companyId, branchId);
  }

  @Patch('conversations/:id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameGroupDto,
  ) {
    return this.service.renameGroup(user.id, id, dto.title);
  }

  @Post('conversations/:id/participants')
  addParticipants(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddParticipantsDto,
  ) {
    return this.service.addParticipants(user.id, id, dto);
  }

  /** Remove someone — or pass your own id to leave. */
  @Delete('conversations/:id/participants/:userId')
  removeParticipant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
  ) {
    return this.service.removeParticipant(user.id, id, targetUserId);
  }

  // ----------------------------------------------------------- the messages --

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    // Number(), not ParseIntPipe({optional:true}) — that 400s on an absent param.
    const beforeId = Number(before);
    const take = Number(limit);
    return this.service.listMessages(
      user.id,
      id,
      Number.isFinite(beforeId) && beforeId > 0 ? beforeId : undefined,
      Number.isFinite(take) && take > 0 ? take : undefined,
    );
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ) {
    return this.service.sendMessage(user.id, id, dto);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditMessageDto,
  ) {
    return this.service.editMessage(user.id, id, dto);
  }

  @Delete('messages/:id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.deleteMessage(user.id, id);
  }

  // ------------------------------------------------------ receipts & badges --

  @Post('conversations/:id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkReadDto,
  ) {
    return this.service.markRead(user.id, id, dto.lastMessageId);
  }

  @Post('conversations/:id/typing')
  typing(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.typing(user.id, id);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadTotal(user.id);
  }

  // --------------------------------------------------------- the attachments --

  /**
   * Upload one file, ahead of the message that carries it.
   *
   * Separate from sending so several files can upload at once, each showing its
   * own progress, and so a slow upload does not hold up the typing. The response
   * is handed straight back in the message body's `attachments`.
   */
  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: CHAT_UPLOAD_DIR,
      limits: { fileSize: CHAT_MAX_FILE_BYTES },
    }),
  )
  upload(@UploadedFile() file: UploadedChatFile) {
    return this.service.saveAttachment(file);
  }
}
