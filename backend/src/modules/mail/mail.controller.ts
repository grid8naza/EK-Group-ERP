import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { MailService, UploadedMailFile } from './mail.service';
import { MAIL_MAX_FILE_BYTES, MAIL_UPLOAD_DIR } from './mail.constants';
import { SendMailDto } from './mail.dto';

/**
 * Internal mail (SRS §8.11, FR-COM-01).
 *
 * Every route is scoped to the authenticated user — a mail is reachable because
 * you sent it or were addressed on it, never because of the company you happen
 * to be working in — so no route takes a user id, and X-Company-Id / X-Branch-Id
 * are read only to stamp where a mail was written.
 */
@ApiTags('mail')
@ApiBearerAuth()
@Controller('mail')
export class MailController {
  constructor(private readonly service: MailService) {}

  // ------------------------------------------------------------- the people --

  @Get('directory')
  directory(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.service.directory(user.id, q);
  }

  // ----------------------------------------------------------- the mailboxes --

  @Get('inbox')
  inbox(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('unread') unread?: string,
    @Query('page') page?: string,
  ) {
    return this.service.inbox(user.id, {
      q,
      // Number(), not ParseIntPipe({optional:true}) — that 400s on an absent param.
      page: Number(page) || undefined,
      unreadOnly: unread === '1' || unread === 'true',
    });
  }

  @Get('sent')
  sent(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    return this.service.sent(user.id, { q, page: Number(page) || undefined });
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadTotal(user.id);
  }

  // -------------------------------------------------------------- one mail --

  /** Declared before `:id` so the literal path is not eaten by the parameter. */
  @Post()
  send(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMailDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.send(user.id, dto, companyId, branchId);
  }

  /** Opening it as a recipient is what marks it read. */
  @Get(':id')
  open(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user.id, id);
  }

  @Post(':id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.setRead(user.id, id, true);
  }

  @Post(':id/unread')
  markUnread(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.setRead(user.id, id, false);
  }

  /** Removes it from the caller's inbox only — see MailService.remove. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user.id, id);
  }

  // --------------------------------------------------------- the attachments --

  /**
   * Upload one file, ahead of the mail that carries it. The response is handed
   * straight back in the send body's `attachments`.
   */
  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: MAIL_UPLOAD_DIR,
      limits: { fileSize: MAIL_MAX_FILE_BYTES },
    }),
  )
  upload(@UploadedFile() file: UploadedMailFile) {
    return this.service.saveAttachment(file);
  }
}
