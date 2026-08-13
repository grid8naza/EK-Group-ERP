import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { rename } from 'fs/promises';
import { basename, extname, join } from 'path';
import { randomBytes } from 'crypto';
import { CircularAudienceKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { richTextToPlain, sanitizeRichText } from '../../common/rich-text';
import {
  AudienceSpec,
  USER_LOOKUP,
  UserLookupPort,
  UserSummary,
} from '../../contracts/user-lookup.port';
import {
  CIRCULAR_MAX_FILE_BYTES,
  CIRCULAR_MAX_RECIPIENTS,
  CIRCULAR_PAGE_SIZE,
  CIRCULAR_UPLOAD_DIR,
  CIRCULAR_URL_PREFIX,
} from './circular.constants';
import {
  CircularAttachmentRefDto,
  CircularAudienceDto,
  IssueCircularDto,
} from './circular.dto';

/** Minimal multer file shape (avoids needing @types/multer). */
export interface UploadedCircularFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** What a list row shows under the title. */
const PREVIEW_CHARS = 200;

/** How many names the audience preview spells out before counting the rest. */
const PREVIEW_NAMES = 8;

const circularInclude = {
  targets: true,
  attachments: true,
} satisfies Prisma.CircularInclude;

type CircularRow = Prisma.CircularGetPayload<{
  include: typeof circularInclude;
}>;

/** Total / read / acknowledged for one circular. */
interface CircularStats {
  recipientCount: number;
  readCount: number;
  ackCount: number;
}

const NO_STATS: CircularStats = {
  recipientCount: 0,
  readCount: 0,
  ackCount: 0,
};

/**
 * Circulars (SRS §8.11, FR-COM-04) — formal notices issued to an audience, with
 * acknowledgement tracking and an archive.
 *
 * Four rules shape it:
 *
 *  1. **An audience is chosen, the people are derived.** The issuer picks a
 *     company, a branch, a role group; the port turns that into people, and both
 *     halves are stored — the targets for the archive to read ("all of Bake
 *     House"), the recipients for the register to count. Resolved once, at
 *     issue: somebody who joins the branch next week did not fail to acknowledge
 *     a notice sent before they arrived.
 *
 *  2. **Reading and acknowledging are different acts.** Opening it sets readAt,
 *     as mail does. Acknowledging is a button somebody presses, and that is the
 *     fact the SRS wants: a circular you can prove was seen. Nothing else may
 *     set it — not the issuer, not opening it twice.
 *
 *  3. **A circular is a record, so it is never deleted.** The issuer may archive
 *     one when it is superseded; it leaves the live lists and keeps its
 *     register. A recipient cannot remove theirs at all — unlike mail, where
 *     what is in your inbox is your business.
 *
 *  4. **Not partitioned by company.** companyId/branchId say where it was issued
 *     FROM; the audience says who it is for, and a group circular crosses all
 *     three companies by design. Same rule as mail, chat and the approvals
 *     inbox.
 */
@Injectable()
export class CircularService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  // -------------------------------------------------------------- audience --

  /** The companies, branches and groups this person may aim a circular at. */
  audienceOptions(userId: number) {
    return this.users.audienceOptions(userId);
  }

  /** Everybody this user can name individually, for the "and also…" line. */
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

  /**
   * Who an audience would reach, before it is issued to.
   *
   * Worth its own round trip: "all of Regency Bakers" is an abstraction, and
   * nobody should discover that it meant 240 people by sending to them.
   */
  async preview(userId: number, audience: CircularAudienceDto) {
    const ids = await this.users.resolveAudience(
      userId,
      CircularService.toSpec(audience),
    );
    const names = await this.users.findByIds(ids.slice(0, PREVIEW_NAMES));
    return {
      count: ids.length,
      names: names.map((u) => u.name).sort((a, b) => a.localeCompare(b)),
      overLimit: ids.length > CIRCULAR_MAX_RECIPIENTS,
    };
  }

  // ----------------------------------------------------------------- issue --

  /**
   * Issue one circular to an audience.
   *
   * The audience is resolved here rather than trusted from the request, and the
   * targets are labelled from the options the issuer is actually offered — so a
   * label in the archive is a name this system gave the group, not a string the
   * client made up.
   */
  async issue(
    userId: number,
    dto: IssueCircularDto,
    companyId?: number,
    branchId?: number,
  ) {
    const title = dto.title.trim();
    // Sanitised HERE, once, on the way in — see common/rich-text.ts. What is
    // stored is already safe to render, so no reader has to remember to be
    // careful with it.
    const body = sanitizeRichText(dto.body);
    const bodyText = richTextToPlain(body);
    if (!title) throw new BadRequestException('Give the circular a title.');

    const spec = CircularService.toSpec(dto.audience);
    if (!CircularService.hasAudience(spec)) {
      throw new BadRequestException('Choose who the circular is for.');
    }

    const recipientIds = await this.users.resolveAudience(userId, spec);
    if (recipientIds.length === 0) {
      throw new BadRequestException(
        'That audience reaches nobody — a circular needs at least one branch and one role under the same company.',
      );
    }
    if (recipientIds.length > CIRCULAR_MAX_RECIPIENTS) {
      throw new BadRequestException(
        `A circular may go to at most ${CIRCULAR_MAX_RECIPIENTS} people. Narrow the audience.`,
      );
    }

    const targets = await this.describeTargets(userId, spec);
    const attachments = (dto.attachments ?? []).map((a) =>
      CircularService.validateAttachment(a),
    );

    const requiresAck = dto.requiresAck ?? true;
    const ackDueAt = dto.ackDueAt ? new Date(dto.ackDueAt) : null;
    if (ackDueAt && Number.isNaN(ackDueAt.getTime())) {
      throw new BadRequestException('That acknowledgement date is not a date.');
    }

    const data = {
      title,
      body,
      bodyText,
      issuerId: userId,
      companyId: companyId ?? null,
      branchId: branchId ?? null,
      requiresAck,
      // A deadline on a circular nobody has to acknowledge would be a date
      // against nothing — drop it rather than store a promise we never keep.
      ackDueAt: requiresAck ? ackDueAt : null,
      targets: { create: targets },
      recipients: { create: recipientIds.map((id) => ({ userId: id })) },
      attachments: attachments.length ? { create: attachments } : undefined,
    };

    const created = await this.createWithReference(data);
    return this.view(created, userId);
  }

  // ----------------------------------------------------------------- lists --

  /** Circulars this person has issued, newest first, each with its register. */
  async issued(
    userId: number,
    opts: { q?: string; archived?: boolean; page?: number } = {},
  ) {
    const { skip, take } = CircularService.pageWindow(opts.page);
    const needle = opts.q?.trim().toLowerCase();

    const rows = await this.prisma.circular.findMany({
      where: {
        issuerId: userId,
        archivedAt: opts.archived ? { not: null } : null,
        ...CircularService.textFilter(needle),
      },
      include: circularInclude,
      orderBy: { issuedAt: 'desc' },
      skip,
      take: take + 1, // one extra: tells the client whether to offer another page
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const [stats, names] = await Promise.all([
      this.statsFor(page.map((c) => c.id)),
      this.namesFor([userId]),
    ]);

    return {
      hasMore,
      items: page.map((c) =>
        this.listItem(c, userId, names, stats.get(c.id) ?? NO_STATS, null),
      ),
    };
  }

  /**
   * Circulars issued TO this person.
   *
   * Read off CircularRecipient rather than Circular: the (userId,
   * acknowledgedAt) index is exactly this query, and what one reader has done
   * about a notice never needs to look at what anybody else has.
   */
  async received(
    userId: number,
    opts: {
      q?: string;
      pendingOnly?: boolean;
      archived?: boolean;
      page?: number;
    } = {},
  ) {
    const { skip, take } = CircularService.pageWindow(opts.page);
    const needle = opts.q?.trim().toLowerCase();

    const rows = await this.prisma.circularRecipient.findMany({
      where: {
        userId,
        ...(opts.pendingOnly ? { acknowledgedAt: null } : {}),
        circular: {
          archivedAt: opts.archived ? { not: null } : null,
          // Only a circular that ASKS for one can be awaiting acknowledgement —
          // an information notice has no acknowledgedAt to wait for, and would
          // otherwise sit in the outstanding list for ever.
          ...(opts.pendingOnly ? { requiresAck: true } : {}),
          ...CircularService.textFilter(needle),
        },
      },
      include: { circular: { include: circularInclude } },
      orderBy: { circular: { issuedAt: 'desc' } },
      skip,
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const [stats, names] = await Promise.all([
      this.statsFor(page.map((r) => r.circularId)),
      this.namesFor(page.map((r) => r.circular.issuerId)),
    ]);

    return {
      hasMore,
      items: page.map((r) =>
        this.listItem(
          r.circular,
          userId,
          names,
          stats.get(r.circularId) ?? NO_STATS,
          { readAt: r.readAt, acknowledgedAt: r.acknowledgedAt },
        ),
      ),
    };
  }

  /** Circulars still awaiting this person's acknowledgement, for the badge. */
  async pendingCount(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.circularRecipient.count({
      where: {
        userId,
        acknowledgedAt: null,
        circular: { requiresAck: true, archivedAt: null },
      },
    });
    return { count };
  }

  // ------------------------------------------------------------ one notice --

  /**
   * Open a circular. Opening it as a recipient marks it read — the register's
   * first column. Acknowledging is a separate, deliberate act (see acknowledge).
   */
  async get(userId: number, id: number) {
    const { circular, recipient } = await this.assertVisible(userId, id);

    if (recipient && recipient.readAt === null) {
      const readAt = new Date();
      await this.prisma.circularRecipient.update({
        where: { id: recipient.id },
        data: { readAt },
      });
      recipient.readAt = readAt;
    }

    return this.view(circular, userId);
  }

  /**
   * Confirm you have seen it. Only a recipient can, only once — a second press
   * keeps the first stamp, because when somebody acknowledged is the fact being
   * recorded and re-stamping it would quietly rewrite the record.
   */
  async acknowledge(userId: number, id: number, note?: string) {
    const { circular, recipient } = await this.assertVisible(userId, id);
    if (!recipient) {
      throw new ForbiddenException(
        'Only somebody the circular was issued to can acknowledge it.',
      );
    }
    if (!circular.requiresAck) {
      throw new BadRequestException(
        'This circular does not ask for an acknowledgement.',
      );
    }
    if (recipient.acknowledgedAt === null) {
      await this.prisma.circularRecipient.update({
        where: { id: recipient.id },
        data: {
          acknowledgedAt: new Date(),
          readAt: recipient.readAt ?? new Date(),
          ackNote: note?.trim() || null,
        },
      });
    }
    return this.view(circular, userId);
  }

  /**
   * Take a circular out of the live lists, or put it back. The issuer's call
   * alone — it is their notice — and it destroys nothing: the text and the whole
   * register stay exactly as they were, which is the point of an archive.
   */
  async setArchived(userId: number, id: number, archived: boolean) {
    const circular = await this.prisma.circular.findUnique({ where: { id } });
    if (!circular) throw new NotFoundException('No such circular.');
    if (circular.issuerId !== userId) {
      throw new ForbiddenException(
        'Only the person who issued a circular can archive it.',
      );
    }
    const updated = await this.prisma.circular.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      include: circularInclude,
    });
    return this.view(updated, userId);
  }

  // ----------------------------------------------------------- attachments --

  /**
   * Store an uploaded file and describe it back to the client, which sends the
   * description with the circular that carries it. Same shape as mail's: the
   * file is renamed onto a random name of our own, keeping only the extension,
   * so the original name is shown from the database and never used as a path.
   */
  async saveAttachment(
    file: UploadedCircularFile,
  ): Promise<CircularAttachmentRefDto> {
    if (!file) throw new BadRequestException('No file uploaded.');
    if (file.size > CIRCULAR_MAX_FILE_BYTES) {
      throw new BadRequestException('That file is larger than 25 MB.');
    }
    const ext = extname(file.originalname).slice(0, 12);
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    await rename(file.path, join(CIRCULAR_UPLOAD_DIR, name));
    return {
      fileName: basename(file.originalname).slice(0, 255),
      url: `${CIRCULAR_URL_PREFIX}/${name}`,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  // ---------------------------------------------------------------- guards --

  /**
   * The circular, plus the caller's own recipient row when they have one.
   *
   * 404 rather than 403: whether a circular exists is itself private, and a
   * notice you were not issued is not one you should be able to probe for.
   */
  private async assertVisible(userId: number, id: number) {
    const circular = await this.prisma.circular.findUnique({
      where: { id },
      include: circularInclude,
    });
    if (!circular) throw new NotFoundException('No such circular.');

    const recipient = await this.prisma.circularRecipient.findUnique({
      where: { circularId_userId: { circularId: id, userId } },
    });
    if (circular.issuerId !== userId && !recipient) {
      throw new NotFoundException('No such circular.');
    }
    return { circular, recipient };
  }

  // --------------------------------------------------------------- helpers --

  /**
   * Give the circular its reference and write it.
   *
   * The number is MAX+1 over the references already issued this year, derived
   * from the rows themselves rather than a stored counter — the rule every
   * number in this system follows. Two issued in the same instant would collide
   * on the unique index; that is what the retry is for, and it is cheaper than
   * serialising every issue behind a lock for an event that happens about never.
   */
  private async createWithReference(
    data: Omit<Prisma.CircularUncheckedCreateInput, 'reference'>,
  ): Promise<CircularRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = await this.nextReference();
      try {
        return await this.prisma.circular.create({
          data: { ...data, reference },
          include: circularInclude,
        });
      } catch (e) {
        const taken =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!taken) throw e;
      }
    }
    throw new BadRequestException(
      'Could not allocate a circular number. Try again.',
    );
  }

  /** CIR/YYYY/NNNN — the highest issued this year, plus one. */
  private async nextReference(): Promise<string> {
    const prefix = `CIR/${new Date().getFullYear()}/`;
    const rows = await this.prisma.circular.findMany({
      where: { reference: { startsWith: prefix } },
      select: { reference: true },
      orderBy: { reference: 'desc' },
      take: 50,
    });
    let max = 0;
    for (const { reference } of rows) {
      const seq = Number(reference.slice(prefix.length));
      // A reference that does not parse belongs to some older shape — ignore it
      // rather than let one stray row freeze the sequence.
      if (Number.isSafeInteger(seq) && seq > max) max = seq;
    }
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  /**
   * Name every target the issuer chose, from the options they are actually
   * offered. Anything not on that list is dropped rather than labelled: it
   * reached nobody (the port intersects with the issuer's reach), so recording
   * it would put an audience in the archive that the circular never had.
   */
  private async describeTargets(userId: number, spec: AudienceSpec) {
    if (spec.everyone) {
      return [
        {
          kind: CircularAudienceKind.EVERYONE,
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
      kind: CircularAudienceKind,
    ) =>
      (wanted ?? [])
        .map((id) => list.find((o) => o.id === id))
        .filter((o): o is T => o !== undefined)
        .map((o) => ({ kind, refId: o.id, label: o.name }));

    // The company is not chosen, it is implied — by whichever headings the
    // branches and roles were picked under. Recorded all the same, and first,
    // because "Kadathy + Branch Manager" in an archive read two years later
    // needs to say which company's Kadathy.
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
          kind: CircularAudienceKind.COMPANY,
          refId: c.id,
          label: c.name,
        })),
      ...pick(options.branches, spec.branchIds, CircularAudienceKind.BRANCH),
      ...pick(options.groups, spec.userGroupIds, CircularAudienceKind.GROUP),
      ...named
        .filter((u) => reachable.has(u.id))
        .map((u) => ({
          kind: CircularAudienceKind.PERSON,
          refId: u.id,
          label: u.name,
        })),
    ];
  }

  /**
   * Total, read and acknowledged per circular, for a page of them.
   *
   * Three grouped counts rather than loading the recipient rows: a circular to
   * the whole group carries thousands, and a list of 25 of those would drag the
   * lot into memory to work out three numbers.
   */
  private async statsFor(ids: number[]): Promise<Map<number, CircularStats>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();

    const count = (where: Prisma.CircularRecipientWhereInput) =>
      this.prisma.circularRecipient.groupBy({
        by: ['circularId'],
        where: { circularId: { in: wanted }, ...where },
        _count: { _all: true },
      });

    const [all, read, acked] = await Promise.all([
      count({}),
      count({ readAt: { not: null } }),
      count({ acknowledgedAt: { not: null } }),
    ]);

    const stats = new Map<number, CircularStats>(
      wanted.map((id) => [id, { ...NO_STATS }]),
    );
    for (const row of all) {
      stats.get(row.circularId)!.recipientCount = row._count._all;
    }
    for (const row of read) {
      stats.get(row.circularId)!.readCount = row._count._all;
    }
    for (const row of acked) {
      stats.get(row.circularId)!.ackCount = row._count._all;
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
   * One circular, in full, as the caller is entitled to see it.
   *
   * The register — who has read it, who has acknowledged it — is the ISSUER's
   * view. A recipient learns what they themselves have done and how many others
   * have, but not which of their colleagues has not got round to it: that is the
   * issuer's business to chase, not a leaderboard for the audience.
   */
  private async view(circular: CircularRow, userId: number) {
    const isMine = circular.issuerId === userId;

    const recipients = await this.prisma.circularRecipient.findMany({
      where: { circularId: circular.id },
      orderBy: { id: 'asc' },
    });
    const names = await this.namesFor([
      circular.issuerId,
      ...recipients.map((r) => r.userId),
    ]);
    const mine = recipients.find((r) => r.userId === userId) ?? null;

    return {
      id: circular.id,
      reference: circular.reference,
      title: circular.title,
      body: circular.body,
      issuedAt: circular.issuedAt.toISOString(),
      companyId: circular.companyId,
      branchId: circular.branchId,
      requiresAck: circular.requiresAck,
      ackDueAt: this.iso(circular.ackDueAt),
      archivedAt: this.iso(circular.archivedAt),
      issuer: {
        id: circular.issuerId,
        name: names.get(circular.issuerId)?.name ?? `User #${circular.issuerId}`,
        username: names.get(circular.issuerId)?.username ?? '',
      },
      isMine,
      audience: circular.targets.map((t) => ({
        kind: t.kind,
        refId: t.refId,
        label: t.label,
      })),
      recipientCount: recipients.length,
      readCount: recipients.filter((r) => r.readAt !== null).length,
      ackCount: recipients.filter((r) => r.acknowledgedAt !== null).length,
      /** What I have done about it — null when I only issued it. */
      me: mine
        ? {
            readAt: this.iso(mine.readAt),
            acknowledgedAt: this.iso(mine.acknowledgedAt),
            ackNote: mine.ackNote,
          }
        : null,
      register: isMine
        ? recipients.map((r) => ({
            id: r.userId,
            name: names.get(r.userId)?.name ?? `User #${r.userId}`,
            readAt: this.iso(r.readAt),
            acknowledgedAt: this.iso(r.acknowledgedAt),
            ackNote: r.ackNote,
          }))
        : [],
      attachments: circular.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        url: a.url,
        mimeType: a.mimeType,
        size: a.size,
      })),
    };
  }

  /** One row of a list — enough to decide whether to open it. */
  private listItem(
    circular: CircularRow,
    userId: number,
    names: Map<number, UserSummary>,
    stats: CircularStats,
    mine: { readAt: Date | null; acknowledgedAt: Date | null } | null,
  ) {
    return {
      id: circular.id,
      reference: circular.reference,
      title: circular.title,
      // From the plain text, not the HTML — a list row is one line of prose.
      preview: circular.bodyText.slice(0, PREVIEW_CHARS),
      issuedAt: circular.issuedAt.toISOString(),
      issuerId: circular.issuerId,
      issuerName:
        names.get(circular.issuerId)?.name ?? `User #${circular.issuerId}`,
      isMine: circular.issuerId === userId,
      requiresAck: circular.requiresAck,
      ackDueAt: this.iso(circular.ackDueAt),
      /**
       * The deadline has passed with somebody still owing an acknowledgement —
       * worked out here so every screen agrees. Which somebody depends on who is
       * asking: for a reader it is themselves, for the issuer it is anyone in
       * the audience, because "overdue" on their list means the notice is not
       * yet answered rather than that they personally have not answered it.
       */
      isOverdue:
        circular.requiresAck &&
        circular.ackDueAt !== null &&
        circular.ackDueAt.getTime() < Date.now() &&
        (mine
          ? mine.acknowledgedAt === null
          : stats.ackCount < stats.recipientCount),
      archivedAt: this.iso(circular.archivedAt),
      audience: circular.targets.map((t) => t.label),
      recipientCount: stats.recipientCount,
      readCount: stats.readCount,
      ackCount: stats.ackCount,
      attachmentCount: circular.attachments.length,
      isRead: mine ? mine.readAt !== null : true,
      acknowledgedAt: mine ? this.iso(mine.acknowledgedAt) : null,
    };
  }

  private iso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
  }

  // ------------------------------------------------------------------ pure --

  private static pageWindow(page?: number) {
    const n = Number.isFinite(page) && (page ?? 0) > 0 ? Math.floor(page!) : 1;
    return {
      skip: (n - 1) * CIRCULAR_PAGE_SIZE,
      take: CIRCULAR_PAGE_SIZE,
    };
  }

  /**
   * Free text over a circular — its reference, its title, its words. The words
   * are read off bodyText, never the HTML: searching markup would match every
   * bulleted notice on "li".
   */
  private static textFilter(needle?: string): Prisma.CircularWhereInput {
    if (!needle) return {};
    return {
      OR: [
        { reference: { contains: needle, mode: 'insensitive' } },
        { title: { contains: needle, mode: 'insensitive' } },
        { bodyText: { contains: needle, mode: 'insensitive' } },
      ],
    };
  }

  private static toSpec(dto: CircularAudienceDto): AudienceSpec {
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

  /**
   * An attachment reference arrives from the client, so treat it as a claim.
   * The URL must be one this module minted: a path of the caller's choosing
   * would otherwise let them attach — and so hand around — any file the static
   * mount serves.
   */
  private static validateAttachment(
    a: CircularAttachmentRefDto,
  ): CircularAttachmentRefDto {
    const prefix = `${CIRCULAR_URL_PREFIX}/`;
    const name = a.url.slice(prefix.length);
    const ok =
      a.url.startsWith(prefix) &&
      name.length > 0 &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !name.includes('..');
    if (!ok) throw new BadRequestException('Unrecognised attachment.');
    return {
      fileName: a.fileName.slice(0, 255),
      url: a.url,
      mimeType: a.mimeType,
      size: a.size,
    };
  }
}
