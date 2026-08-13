import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { BroadcastService } from './broadcast.service';
import { PreviewBroadcastAudienceDto, SendBroadcastDto } from './broadcast.dto';

/**
 * Broadcasts (SRS §8.11, FR-COM-03).
 *
 * Every route is scoped to the authenticated user — a broadcast is reachable
 * because you sent it or it was aimed at you — so no route takes a user id, and
 * X-Company-Id / X-Branch-Id are read only to stamp where one was sent from.
 */
@ApiTags('broadcasts')
@ApiBearerAuth()
@Controller('broadcasts')
export class BroadcastController {
  constructor(private readonly service: BroadcastService) {}

  // -------------------------------------------------------------- audience --

  @Get('audience')
  audience(@CurrentUser() user: AuthUser) {
    return this.service.audienceOptions(user.id);
  }

  @Get('directory')
  directory(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.service.directory(user.id, q);
  }

  @Post('audience/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Body() dto: PreviewBroadcastAudienceDto,
  ) {
    return this.service.preview(user.id, dto.audience);
  }

  // ------------------------------------------------------------------ feed --

  /** Announcements aimed at this person. `past=1` for dismissed and expired. */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('past') past?: string,
    @Query('page') page?: string,
  ) {
    return this.service.feed(user.id, {
      q,
      past: past === '1' || past === 'true',
      // Number(), not ParseIntPipe({optional:true}) — that 400s on an absent param.
      page: Number(page) || undefined,
    });
  }

  /** Announcements this person has sent. `past=1` for the expired ones. */
  @Get('sent')
  sent(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('past') past?: string,
    @Query('page') page?: string,
  ) {
    return this.service.sent(user.id, {
      q,
      past: past === '1' || past === 'true',
      page: Number(page) || undefined,
    });
  }

  /** Live and unread, for the badge. */
  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  // --------------------------------------------------------- one broadcast --

  /** Declared before `:id` so the literal path is not eaten by the parameter. */
  @Post()
  send(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendBroadcastDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.send(user.id, dto, companyId, branchId);
  }

  @Get(':id')
  open(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user.id, id);
  }

  /** Seen it in the feed, without opening anything. */
  @Post(':id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.markRead(user.id, id);
  }

  /** Clears it from the caller's own feed only. */
  @Post(':id/dismiss')
  dismiss(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.setDismissed(user.id, id, true);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.setDismissed(user.id, id, false);
  }

  /**
   * Take it down for everyone — the sender's call. It expires now rather than
   * being deleted, so it stays in the past lists (see BroadcastService.withdraw).
   */
  @Delete(':id')
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.withdraw(user.id, id);
  }
}
