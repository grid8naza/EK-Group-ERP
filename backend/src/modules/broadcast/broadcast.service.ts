import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BroadcastAudienceKind,
  BroadcastPriority,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { richTextToPlain, sanitizeRichText } from '../../common/rich-text';
import {
  AudienceSpec,
  USER_LOOKUP,
  UserLookupPort,
  UserSummary,
} from '../../contracts/user-lookup.port';
import { BroadcastAudienceDto, SendBroadcastDto } from './broadcast.dto';

/** How many announcements a feed page holds. */
const PAGE_SIZE = 25;

/**
 * The most people one broadcast may reach. Same ceiling as a circular: enough
 * for the whole group, low enough that a mis-clicked audience is caught.
 */
const MAX_RECIPIENTS = 5000;

/** How many names the audience preview spells out before counting the rest. */
const PREVIEW_NAMES = 8;

const broadcastInclude = {
  targets: true,
} satisfies Prisma.BroadcastInclude;

type BroadcastRow = Prisma.BroadcastGetPayload<{
  include: typeof broadcastInclude;
}>;

/** Total / read / dismissed for one broadcast. */
interface BroadcastStats {
  recipientCount: number;
  readCount: number;
  dismissedCount: number;
}

const NO_STATS: BroadcastStats = {
  recipientCount: 0,
  readCount: 0,
  dismissedCount: 0,
};

/**
 * Broadcasts (SRS §8.11, FR-COM-03) — announcements to a targeted audience: a
 * company, a branch, a role group, rather than everyone.
 *
 * It shares the circular's audience machinery and almost nothing else, because
 * an announcement is not a notice:
 *
 *  1. **Nobody answers for it.** There is no acknowledgement and no register to
 *     chase — the sender sees how many have seen it, and that is all a broadcast
 *     ever claims. Building acknowledgement into both would leave the group with
 *     two formal notices and no way to just tell people something.
 *
 *  2. **It is meant to go away.** It expires on its own date, and a reader can
 *     dismiss it before then. Dismissing is one reader's act: it clears their
 *     feed and touches nobody else's, and it does not un-read it for the sender.
 *
 *  3. **The audience is chosen, the people are derived** — same rule as the
 *     circular, resolved once at send through the USER_LOOKUP port, so it can
 *     never reach further than the sender could reach by name.
 *
 *  4. **Not partitioned by company.** companyId/branchId say where it was sent
 *     FROM. Same rule as mail, chat, circulars and the approvals inbox.
 */
@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  // -------------------------------------------------------------- audience --

  /** The companies, branches and groups this person may announce to. */
  audienceOptions(userId: number) {
    return this.users.audienceOptions(userId);
  }

  /** Everybody they can name individually, for the "and also…" line. */
  async directory(userId: number, q?: string): Promise<UserSummary[]> {
    const peers = await this.users.findPeers(userId);
    const needle = q?.trim().toLowerCase();
    if (!needle) return peers;
    return peers.filter((u) =>
      [u.name, u.username, u.userCode, u.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }

  /** Who an audience would reach, before it is announced to. */
  async preview(userId: number, audience: BroadcastAudienceDto) {
    const ids = await this.users.resolveAudience(
      userId,
      BroadcastService.toSpec(audience),
    );
    const names = await this.users.findByIds(ids.slice(0, PREVIEW_NAMES));
    return {
      count: ids.length,
      names: names.map((u) => u.name).sort((a, b) => a.localeCompare(b)),
      overLimit: ids.length > MAX_RECIPIENTS,
    };
  }

  // ------------------------------------------------------------------ send --

  /** Announce one thing to an audience. */
  async send(
    userId: number,
    dto: SendBroadcastDto,
    companyId?: number,
    branchId?: number,
  ) {
    const title = dto.title.trim();
    // Sanitised on the way in, once — see common/rich-text.ts.
    const body = sanitizeRichText(dto.body);
    if (!title) throw new BadRequestException('Give the broadcast a title.');

    const spec = BroadcastService.toSpec(dto.audience);
    if (!BroadcastService.hasAudience(spec)) {
      throw new BadRequestException('Choose who the broadcast is for.');
    }

    const recipientIds = await this.users.resolveAudience(userId, spec);
    if (recipientIds.length === 0) {
      throw new BadRequestException(
        'That audience reaches nobody — a broadcast needs at least one branch and one role under the same company.',
      );
    }
    if (recipientIds.length > MAX_RECIPIENTS) {
      throw new BadRequestException(
        `A broadcast may go to at most ${MAX_RECIPIENTS} people. Narrow the audience.`,
      );
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('That show-until date is not a date.');
    }

    const created = await this.prisma.broadcast.create({
      data: {
        title,
        body,
        bodyText: richTextToPlain(body),
        senderId: userId,
        companyId: companyId ?? null,
        branchId: branchId ?? null,
        priority: dto.priority ?? BroadcastPriority.NORMAL,
        expiresAt,
        targets: { create: await this.describeTargets(userId, spec) },
        recipients: { create: recipientIds.map((id) => ({ userId: id })) },
      },
      include: broadcastInclude,
    });

    return this.view(created, userId);
  }

  // ------------------------------------------------------------------ feed --

  /**
   * What has been announced TO this person.
   *
   * Live by default — not expired, not dismissed — because that is what a feed
   * of announcements is for. `past` opens the drawer on the rest of it: what
   * they waved away, and what has since run out.
   */
  async feed(
    userId: number,
    opts: { q?: string; past?: boolean; page?: number } = {},
  ) {
    const { skip, take } = BroadcastService.pageWindow(opts.page);
    const needle = opts.q?.trim().toLowerCase();
    const now = new Date();

    const text = BroadcastService.textFilter(needle);
    // AND-ed rather than spread together: both halves are an `OR`, and one key
    // cannot hold two of them — spreading would silently drop the first.
    const live: Prisma.BroadcastRecipientWhereInput = {
      dismissedAt: null,
      broadcast: {
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, text],
      },
    };
    const past: Prisma.BroadcastRecipientWhereInput = {
      OR: [
        { dismissedAt: { not: null } },
        { broadcast: { expiresAt: { lte: now } } },
      ],
      broadcast: text,
    };

    const rows = await this.prisma.broadcastRecipient.findMany({
      where: { userId, ...(opts.past ? past : live) },
      include: { broadcast: { include: broadcastInclude } },
      orderBy: { broadcast: { sentAt: 'desc' } },
      skip,
      take: take + 1, // one extra: tells the client whether to offer another page
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const [stats, names] = await Promise.all([
      this.statsFor(page.map((r) => r.broadcastId)),
      this.namesFor(page.map((r) => r.broadcast.senderId)),
    ]);

    return {
      hasMore,
      items: page.map((r) =>
        this.listItem(
          r.broadcast,
          userId,
          names,
          stats.get(r.broadcastId) ?? NO_STATS,
          { readAt: r.readAt, dismissedAt: r.dismissedAt },
        ),
      ),
    };
  }

  /** What this person has announced, newest first, each with how far it got. */
  async sent(
    userId: number,
    opts: { q?: string; past?: boolean; page?: number } = {},
  ) {
    const { skip, take } = BroadcastService.pageWindow(opts.page);
    const needle = opts.q?.trim().toLowerCase();
    const now = new Date();

    const rows = await this.prisma.broadcast.findMany({
      where: {
        senderId: userId,
        // AND-ed for the same reason as the feed's: the live filter and the
        // search are both an `OR`, and one key cannot hold two of them.
        AND: [
          opts.past
            ? { expiresAt: { lte: now } }
            : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          BroadcastService.textFilter(needle),
        ],
      },
      include: broadcastInclude,
      orderBy: { sentAt: 'desc' },
      skip,
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const [stats, names] = await Promise.all([
      this.statsFor(page.map((b) => b.id)),
      this.namesFor([userId]),
    ]);

    return {
      hasMore,
      items: page.map((b) =>
        this.listItem(b, userId, names, stats.get(b.id) ?? NO_STATS, null),
      ),
    };
  }

  /** Live announcements this person has not read, for the badge. */
  async unreadCount(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.broadcastRecipient.count({
      where: {
        userId,
        readAt: null,
        dismissedAt: null,
        broadcast: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
    });
    return { count };
  }

  // --------------------------------------------------------- one broadcast --

  /** Open one. Opening it as a recipient is what marks it read. */
  async get(userId: number, id: number) {
    const { broadcast, recipient } = await this.assertVisible(userId, id);

    if (recipient && recipient.readAt === null) {
      const readAt = new Date();
      await this.prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { readAt },
      });
      recipient.readAt = readAt;
    }

    return this.view(broadcast, userId);
  }

  /**
   * Mark it read without opening it — what the feed does when a reader scrolls
   * past a card whose text is already fully on screen. Same effect as opening
   * it; the point is that the feed shows the whole announcement, so demanding a
   * click to call it read would only make the count wrong.
   */
  async markRead(userId: number, id: number) {
    const { recipient } = await this.assertVisible(userId, id);
    if (!recipient) {
      throw new BadRequestException(
        'A broadcast you sent has no read mark of your own.',
      );
    }
    if (recipient.readAt === null) {
      await this.prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { readAt: new Date() },
      });
    }
    return { ok: true };
  }

  /**
   * Put it down. It leaves this reader's feed and nobody else's, and it stays
   * read: waving an announcement away is not un-seeing it.
   */
  async setDismissed(userId: number, id: number, dismissed: boolean) {
    const { recipient } = await this.assertVisible(userId, id);
    if (!recipient) {
      throw new ForbiddenException(
        'A broadcast you sent is not one you can dismiss — the people you sent it to still have it.',
      );
    }
    await this.prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: {
        dismissedAt: dismissed ? new Date() : null,
        // Dismissing something is having seen it. Only ever set here, never
        // cleared: bringing a card back does not make it unread again.
        readAt: dismissed ? (recipient.readAt ?? new Date()) : recipient.readAt,
      },
    });
    return { ok: true, dismissed };
  }

  /**
   * Take an announcement down for everyone — the sender's call alone.
   *
   * Expiring it now rather than deleting the row: people have already seen it,
   * and "it was announced and then withdrawn" is worth more than a hole. It
   * stays in the sender's past list and in the readers' past feed.
   */
  async withdraw(userId: number, id: number) {
    const broadcast = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundException('No such broadcast.');
    if (broadcast.senderId !== userId) {
      throw new ForbiddenException(
        'Only the person who sent a broadcast can take it down.',
      );
    }
    const updated = await this.prisma.broadcast.update({
      where: { id },
      data: { expiresAt: new Date() },
      include: broadcastInclude,
    });
    return this.view(updated, userId);
  }

  // ---------------------------------------------------------------- guards --

  /**
   * The broadcast, plus the caller's own recipient row when they have one.
   *
   * 404 rather than 403: whether a broadcast exists is itself private. A
   * dismissed one is still reachable — it is in the reader's past feed, and they
   * may bring it back.
   */
  private async assertVisible(userId: number, id: number) {
    const broadcast = await this.prisma.broadcast.findUnique({
      where: { id },
      include: broadcastInclude,
    });
    if (!broadcast) throw new NotFoundException('No such broadcast.');

    const recipient = await this.prisma.broadcastRecipient.findUnique({
      where: { broadcastId_userId: { broadcastId: id, userId } },
    });
    if (broadcast.senderId !== userId && !recipient) {
      throw new NotFoundException('No such broadcast.');
    }
    return { broadcast, recipient };
  }

  // --------------------------------------------------------------- helpers --

  /**
   * Name every target the sender chose, from the options they are actually
   * offered. Anything not on that list is dropped rather than labelled — it
   * reached nobody, so recording it would put an audience on the announcement
   * that it never had. (Same rule as the circular's.)
   */
  private async describeTargets(userId: number, spec: AudienceSpec) {
    if (spec.everyone) {
      return [
        {
          kind: BroadcastAudienceKind.EVERYONE,
          refId: null,
          label: 'Everyone in the group',
        },
      ];
    }

    const options = await this.users.audienceOptions(userId);
    const named = spec.userIds?.length
      ? await this.users.findByIds(spec.userIds)
      : [];
    const reachable = new Set(
      await this.users.resolveAudience(userId, { userIds: spec.userIds ?? [] }),
    );

    const pick = <T extends { id: number; name: string }>(
      list: T[],
      wanted: number[] | undefined,
      kind: BroadcastAudienceKind,
    ) =>
      (wanted ?? [])
        .map((id) => list.find((o) => o.id === id))
        .filter((o): o is T => o !== undefined)
        .map((o) => ({ kind, refId: o.id, label: o.name }));

    // The company is implied by the headings the branches and roles were picked
    // under, and recorded for the same reason as the circular's.
    const involved = new Set(
      [
        ...(spec.branchIds ?? []).map(
          (id) => options.branches.find((b) => b.id === id)?.companyId,
        ),
        ...(spec.userGroupIds ?? []).map(
          (id) => options.groups.find((g) => g.id === id)?.companyId,
        ),
      ].filter((id): id is number => id !== undefined),
    );

    return [
      ...options.companies
        .filter((c) => involved.has(c.id))
        .map((c) => ({
          kind: BroadcastAudienceKind.COMPANY,
          refId: c.id,
          label: c.name,
        })),
      ...pick(options.branches, spec.branchIds, BroadcastAudienceKind.BRANCH),
      ...pick(options.groups, spec.userGroupIds, BroadcastAudienceKind.GROUP),
      ...named
        .filter((u) => reachable.has(u.id))
        .map((u) => ({
          kind: BroadcastAudienceKind.PERSON,
          refId: u.id,
          label: u.name,
        })),
    ];
  }

  /**
   * Total, read and dismissed per broadcast, for a page of them — three grouped
   * counts rather than loading the recipient rows, which for an announcement to
   * the whole group would be thousands to work out three numbers.
   */
  private async statsFor(ids: number[]): Promise<Map<number, BroadcastStats>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();

    const count = (where: Prisma.BroadcastRecipientWhereInput) =>
      this.prisma.broadcastRecipient.groupBy({
        by: ['broadcastId'],
        where: { broadcastId: { in: wanted }, ...where },
        _count: { _all: true },
      });

    const [all, read, dismissed] = await Promise.all([
      count({}),
      count({ readAt: { not: null } }),
      count({ dismissedAt: { not: null } }),
    ]);

    const stats = new Map<number, BroadcastStats>(
      wanted.map((id) => [id, { ...NO_STATS }]),
    );
    for (const row of all) {
      stats.get(row.broadcastId)!.recipientCount = row._count._all;
    }
    for (const row of read) {
      stats.get(row.broadcastId)!.readCount = row._count._all;
    }
    for (const row of dismissed) {
      stats.get(row.broadcastId)!.dismissedCount = row._count._all;
    }
    return stats;
  }

  /** Ids → names, in one lookup, as a Map the view helpers can read. */
  private async namesFor(ids: number[]): Promise<Map<number, UserSummary>> {
    const wanted = [...new Set(ids.filter((id) => id > 0))];
    const found = await this.users.findByIds(wanted);
    return new Map(found.map((u) => [u.id, u]));
  }

  // ----------------------------------------------------------- view shapes --

  /**
   * One broadcast in full.
   *
   * There is no per-person register here, unlike the circular's: an announcement
   * asks nothing of anybody, so who exactly has looked at it is nobody's
   * business — the sender gets the counts, which is what "did it land" needs.
   */
  private async view(broadcast: BroadcastRow, userId: number) {
    const [stats, names] = await Promise.all([
      this.statsFor([broadcast.id]),
      this.namesFor([broadcast.senderId]),
    ]);
    const mine =
      broadcast.senderId === userId
        ? null
        : await this.prisma.broadcastRecipient.findUnique({
            where: {
              broadcastId_userId: { broadcastId: broadcast.id, userId },
            },
          });

    return {
      ...this.listItem(
        broadcast,
        userId,
        names,
        stats.get(broadcast.id) ?? NO_STATS,
        mine ? { readAt: mine.readAt, dismissedAt: mine.dismissedAt } : null,
      ),
      body: broadcast.body,
      companyId: broadcast.companyId,
      branchId: broadcast.branchId,
      audience: broadcast.targets.map((t) => ({
        kind: t.kind,
        refId: t.refId,
        label: t.label,
      })),
    };
  }

  /** One card in a feed — an announcement is short, so this IS the whole thing. */
  private listItem(
    broadcast: BroadcastRow,
    userId: number,
    names: Map<number, UserSummary>,
    stats: BroadcastStats,
    mine: { readAt: Date | null; dismissedAt: Date | null } | null,
  ) {
    return {
      id: broadcast.id,
      title: broadcast.title,
      /**
       * The full text, not a preview. A feed of announcements that made you
       * click each one to find out it said "closed on Monday" would be a worse
       * version of mail.
       */
      body: broadcast.body,
      priority: broadcast.priority,
      sentAt: broadcast.sentAt.toISOString(),
      expiresAt: this.iso(broadcast.expiresAt),
      hasExpired:
        broadcast.expiresAt !== null &&
        broadcast.expiresAt.getTime() <= Date.now(),
      senderId: broadcast.senderId,
      senderName:
        names.get(broadcast.senderId)?.name ?? `User #${broadcast.senderId}`,
      isMine: broadcast.senderId === userId,
      audienceLabels: broadcast.targets.map((t) => t.label),
      recipientCount: stats.recipientCount,
      readCount: stats.readCount,
      dismissedCount: stats.dismissedCount,
      isRead: mine ? mine.readAt !== null : true,
      dismissedAt: mine ? this.iso(mine.dismissedAt) : null,
    };
  }

  private iso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
  }

  // ------------------------------------------------------------------ pure --

  private static pageWindow(page?: number) {
    const n = Number.isFinite(page) && (page ?? 0) > 0 ? Math.floor(page!) : 1;
    return { skip: (n - 1) * PAGE_SIZE, take: PAGE_SIZE };
  }

  /** Words are read off bodyText, never the HTML — see circular.service.ts. */
  private static textFilter(needle?: string): Prisma.BroadcastWhereInput {
    if (!needle) return {};
    return {
      OR: [
        { title: { contains: needle, mode: 'insensitive' } },
        { bodyText: { contains: needle, mode: 'insensitive' } },
      ],
    };
  }

  private static toSpec(dto: BroadcastAudienceDto): AudienceSpec {
    return {
      everyone: dto.everyone === true,
      branchIds: dto.branchIds ?? [],
      userGroupIds: dto.userGroupIds ?? [],
      userIds: dto.userIds ?? [],
    };
  }

  private static hasAudience(spec: AudienceSpec): boolean {
    return (
      spec.everyone === true ||
      [spec.branchIds, spec.userGroupIds, spec.userIds].some(
        (list) => (list?.length ?? 0) > 0,
      )
    );
  }
}
