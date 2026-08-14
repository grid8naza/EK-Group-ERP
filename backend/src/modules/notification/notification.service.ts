import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_LOOKUP, UserLookupPort } from '../../contracts/user-lookup.port';
import {
  NotificationAudience,
  PublishNotification,
} from '../../contracts/notification.port';
import { NotificationEventsService } from './notification-events.service';
import { SetPreferenceDto } from './notification.dto';

/** How many alerts the bell asks for. The Alerts screen pages properly. */
const BELL_LIMIT = 20;
/** Hard ceiling on one page of the Alerts screen. */
const MAX_PAGE = 100;

/** Every category, in the order the settings panel lists them. */
const CATEGORIES: NotificationCategory[] = [
  'APPROVAL',
  'TASK',
  'STOCK',
  'EXPIRY',
  'PAYMENT',
  'LEAVE',
  'MESSAGE',
  'SYSTEM',
];

/** What a reader gets back — no internal columns, no Prisma types. */
const FEED_SELECT = {
  id: true,
  category: true,
  priority: true,
  title: true,
  body: true,
  route: true,
  documentId: true,
  companyId: true,
  branchId: true,
  readAt: true,
  dismissedAt: true,
  resolvedAt: true,
  createdAt: true,
} as const;

/**
 * Alerts — raised by things happening, delivered to people (SRS §8.11,
 * FR-COM-05).
 *
 * Two audiences use this class and they want opposite things. PUBLISHERS (every
 * other module, through the NOTIFICATION port) want to say what happened and be
 * done with it. READERS want a bell that is short, current, and does not lie
 * about how much is in it. Everything below is one of those two jobs.
 *
 * The reader's rules, stated once:
 *  - **read** ≠ **resolved**. Looking at an approval does not approve it, so a
 *    read alert stays in the feed; only the condition ending removes it.
 *  - **dismissed** is the reader's own decision and outranks both: put down means
 *    gone from their feed, still true or not.
 *  - a **muted** category is never raised for that person at all (see
 *    notification.prisma) — a feed that hides rows it did write would misreport
 *    its own count.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
    private readonly events: NotificationEventsService,
  ) {}

  // ------------------------------------------------------------ publishing --

  /**
   * Raise an alert for whoever the audience resolves to. Returns how many people
   * it reached; zero is an ordinary answer (everybody muted it, everybody
   * already holds it, or the audience is empty).
   *
   * Never throws at the publisher. An alert is a side effect of somebody else's
   * operation — failing an approval because the bell could not be rung would be
   * the tail wagging the dog — so a failure is logged and swallowed.
   */
  async publish(input: PublishNotification): Promise<number> {
    try {
      return await this.publishOrThrow(input);
    } catch (e) {
      this.logger.error(
        `alert "${input.title}" could not be raised: ${String(e)}`,
      );
      return 0;
    }
  }

  private async publishOrThrow(input: PublishNotification): Promise<number> {
    const audience = await this.resolveAudience(input.audience);
    const userIds = audience.filter((id) => id !== input.excludeUserId);
    if (!userIds.length) return 0;

    const category = input.category as NotificationCategory;

    // Who has switched this category off. Only rows that exist say anything;
    // no row means on, so a new category needs no seeding for anybody.
    const muted = new Set(
      (
        await this.prisma.notificationPreference.findMany({
          where: { userId: { in: userIds }, category, inApp: false },
          select: { userId: true },
        })
      ).map((p) => p.userId),
    );

    // Who already holds a live alert for this exact condition. Dismissed rows
    // count as held — otherwise the next scan would put back what the reader
    // just put down, every fifteen minutes, forever. Only resolving the
    // condition frees the key.
    const held = input.sourceKey
      ? new Set(
          (
            await this.prisma.notification.findMany({
              where: {
                sourceKey: input.sourceKey,
                userId: { in: userIds },
                resolvedAt: null,
              },
              select: { userId: true },
            })
          ).map((n) => n.userId),
        )
      : new Set<number>();

    const recipients = userIds.filter((id) => !muted.has(id) && !held.has(id));
    if (!recipients.length) return 0;

    const data: Prisma.NotificationCreateManyInput[] = recipients.map((id) => ({
      userId: id,
      category,
      priority: input.priority ?? 'NORMAL',
      title: input.title,
      body: input.body,
      route: input.route ?? null,
      documentId: input.documentId ?? null,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
      sourceKey: input.sourceKey ?? null,
    }));

    // The high-water mark before the insert, so the rows can be read back by id
    // afterwards. Matching them on their contents instead would pick up older
    // identical alerts — "Stock is low" is the same sentence every time.
    const highest = await this.prisma.notification.aggregate({
      _max: { id: true },
    });
    await this.prisma.notification.createMany({ data });

    // Push the rows themselves so an open bell updates without refetching. Read
    // back rather than echoed from `data`, because the client needs the ids it
    // will mark read with.
    const created = await this.prisma.notification.findMany({
      where: { id: { gt: highest._max.id ?? 0 }, userId: { in: recipients } },
      select: { ...FEED_SELECT, userId: true },
    });
    for (const { userId, ...row } of created) {
      this.events.emit([userId], { type: 'alert.new', data: row });
    }

    return recipients.length;
  }

  /** Take every live alert on these keys off the bell. */
  async resolve(sourceKeys: string[]): Promise<void> {
    const keys = [...new Set(sourceKeys.filter(Boolean))];
    if (!keys.length) return;
    await this.clear({ sourceKey: { in: keys } });
  }

  /**
   * Resolve everything under a key prefix except what is still true — how a
   * scanner says "this is the whole picture now" without remembering what it
   * published last time.
   */
  async resolveMissing(prefix: string, keep: string[]): Promise<void> {
    const live = [...new Set(keep.filter(Boolean))];
    await this.clear({
      sourceKey: live.length
        ? { startsWith: prefix, notIn: live }
        : { startsWith: prefix },
    });
  }

  /** Mark matching live alerts resolved and tell any open bells they are gone. */
  private async clear(where: Prisma.NotificationWhereInput): Promise<void> {
    const doomed = await this.prisma.notification.findMany({
      where: { ...where, resolvedAt: null },
      select: { id: true, userId: true },
    });
    if (!doomed.length) return;

    await this.prisma.notification.updateMany({
      where: { id: { in: doomed.map((d) => d.id) } },
      data: { resolvedAt: new Date() },
    });

    const byUser = new Map<number, number[]>();
    for (const d of doomed) {
      byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d.id]);
    }
    for (const [userId, ids] of byUser) {
      this.events.emit([userId], { type: 'alert.stale', data: { ids } });
    }
  }

  /**
   * An audience is either named people, or everybody who may work in a module of
   * a company. The second is the only honest answer for an operational alert —
   * "the flour is running out" is for whoever runs Inventory here — and it is
   * the user module's fact, asked through the port.
   */
  private async resolveAudience(
    audience: NotificationAudience,
  ): Promise<number[]> {
    if ('userIds' in audience) {
      return [...new Set(audience.userIds.filter((id) => id > 0))];
    }
    return this.users.usersWithModuleAccess(
      audience.companyId,
      audience.moduleCode,
    );
  }

  // --------------------------------------------------------------- reading --

  /**
   * One person's alerts.
   *
   * `cleared` is the whole difference between the bell and the archive: by
   * default a feed shows what still stands, and the Alerts screen can ask for
   * everything — including what has since been resolved or put down — because
   * "what was I told last Tuesday" is a fair question.
   */
  async list(
    userId: number,
    opts: {
      cleared?: boolean;
      unreadOnly?: boolean;
      category?: NotificationCategory;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const pageSize = Math.min(opts.pageSize || BELL_LIMIT, MAX_PAGE);
    const page = Math.max(opts.page || 1, 1);

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(opts.cleared ? {} : { resolvedAt: null, dismissedAt: null }),
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: FEED_SELECT,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: rows,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  /** The bell's badge: live, unread, not put down. */
  async unreadCount(userId: number) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null, resolvedAt: null, dismissedAt: null },
    });
    return { count };
  }

  async markRead(userId: number, id: number) {
    const done = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    // A second press is not an error — it is the same reader, on a second tab.
    if (!done.count) await this.assertOwn(userId, id);
    return { success: true };
  }

  async markAllRead(userId: number) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, resolvedAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }

  /**
   * Put one down. Reading it too — an alert somebody has actively cleared has
   * certainly been seen, and leaving it counted as unread would be nonsense.
   */
  async dismiss(userId: number, id: number) {
    await this.assertOwn(userId, id);
    const now = new Date();
    await this.prisma.notification.updateMany({
      where: { id, userId, dismissedAt: null },
      data: { dismissedAt: now, readAt: now },
    });
    return { success: true };
  }

  /** Clear the whole live feed at once. */
  async dismissAll(userId: number) {
    const now = new Date();
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, dismissedAt: null, resolvedAt: null },
      data: { dismissedAt: now, readAt: now },
    });
    return { count };
  }

  private async assertOwn(userId: number, id: number) {
    const found = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    // 404 rather than 403: whether somebody ELSE has an alert with this id is
    // not this reader's business either.
    if (!found) throw new NotFoundException('Notification not found');
    return found;
  }

  // ----------------------------------------------------------- preferences --

  /**
   * Every category with this person's effective setting — categories they have
   * never touched come back as on, which is what no row means.
   */
  async preferences(userId: number) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { category: true, inApp: true, push: true },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    return CATEGORIES.map((category) => ({
      category,
      inApp: byCategory.get(category)?.inApp ?? true,
      push: byCategory.get(category)?.push ?? true,
    }));
  }

  async setPreference(userId: number, dto: SetPreferenceDto) {
    const category = dto.category as NotificationCategory;
    await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      create: {
        userId,
        category,
        inApp: dto.inApp ?? true,
        push: dto.push ?? true,
      },
      update: {
        ...(dto.inApp === undefined ? {} : { inApp: dto.inApp }),
        ...(dto.push === undefined ? {} : { push: dto.push }),
      },
    });
    return this.preferences(userId);
  }
}
