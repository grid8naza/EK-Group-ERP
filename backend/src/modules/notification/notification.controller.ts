import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, interval, map, merge } from 'rxjs';
import { NotificationCategory } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { NotificationService } from './notification.service';
import { NotificationEventsService } from './notification-events.service';
import { SetPreferenceDto } from './notification.dto';

/** How often the open stream sends a keep-alive. */
const HEARTBEAT_MS = 25_000;

/**
 * Alerts (SRS §8.11, FR-COM-05).
 *
 * Every route is scoped to the authenticated user — an alert is reachable
 * because it was raised FOR you — so no route takes a user id, and no route
 * takes a company either: an alert follows the person, and hiding one because
 * they happen to be working in a different company today is how somebody misses
 * the thing they were told about.
 *
 * There is no POST that creates an alert. Nobody writes one: alerts are raised
 * by modules through the NOTIFICATION port, in the code where the thing
 * actually happened.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly events: NotificationEventsService,
  ) {}

  // ------------------------------------------------------------ the stream --

  /**
   * The live feed of alerts raised for this user.
   *
   * Merged with a heartbeat because an idle SSE connection is indistinguishable
   * from a dead one to any proxy between here and the browser — a frame every
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
      map((e) => ({ type: e.type, data: JSON.stringify(e.data) })),
    );
  }

  // -------------------------------------------------------------- the feed --

  /**
   * This person's alerts. `cleared=1` includes what has been resolved or put
   * down (the Alerts screen's history); by default only what still stands.
   */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('cleared') cleared?: string,
    @Query('unread') unread?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.list(user.id, {
      cleared: cleared === '1' || cleared === 'true',
      unreadOnly: unread === '1' || unread === 'true',
      // Parsed with Number(), not ParseIntPipe — an optional pipe still 400s on
      // an absent param.
      category:
        category && category in NotificationCategory
          ? (category as NotificationCategory)
          : undefined,
      page: Number(page) || undefined,
      pageSize: Number(pageSize) || undefined,
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user.id);
  }

  @Post('dismiss-all')
  dismissAll(@CurrentUser() user: AuthUser) {
    return this.service.dismissAll(user.id);
  }

  @Post(':id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.markRead(user.id, id);
  }

  @Post(':id/dismiss')
  dismiss(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.dismiss(user.id, id);
  }

  // ----------------------------------------------------------- preferences --

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.service.preferences(user.id);
  }

  @Put('preferences')
  setPreference(@CurrentUser() user: AuthUser, @Body() dto: SetPreferenceDto) {
    return this.service.setPreference(user.id, dto);
  }
}
