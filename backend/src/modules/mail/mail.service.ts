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
import { MailRecipientKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_LOOKUP,
  UserLookupPort,
  UserSummary,
} from '../../contracts/user-lookup.port';
import {
  MAIL_MAX_FILE_BYTES,
  MAIL_PAGE_SIZE,
  MAIL_UPLOAD_DIR,
  MAIL_URL_PREFIX,
} from './mail.constants';
import { validateAs } from '../../common/validate-dto';
import {
  MailAttachmentRefDto,
  SaveMailDraftDto,
  SendMailDto,
} from './mail.dto';

/**
 * A Json column holding a list of user ids, read back as numbers.
 *
 * Prisma hands Json back as `JsonValue`, which is "anything" — so the shape is
 * checked here rather than asserted. A draft edited by hand in the database
 * cannot make the composer blow up on somebody's screen.
 */
const idList = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter((v): v is number => Number.isSafeInteger(v))
    : [];

/** The same, for a draft's attachment list. */
const attachmentList = (value: unknown): MailAttachmentRefDto[] =>
  Array.isArray(value)
    ? (value.filter(
        (a) =>
          a &&
          typeof a === 'object' &&
          typeof (a as { url?: unknown }).url === 'string',
      ) as MailAttachmentRefDto[])
    : [];

/** Minimal multer file shape (avoids needing @types/multer). */
export interface UploadedMailFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** What a list row shows under the subject. */
const PREVIEW_CHARS = 180;

const mailInclude = {
  recipients: true,
  attachments: true,
  parent: { select: { id: true, subject: true, senderId: true, sentAt: true } },
} satisfies Prisma.MailInclude;

type MailRow = Prisma.MailGetPayload<{ include: typeof mailInclude }>;

/**
 * Internal mail (SRS §8.11, FR-COM-01) — addressed messages with subject, body,
 * attachments, an inbox, a sent list and read status per recipient.
 *
 * Three rules shape everything here:
 *
 *  1. **The mail is the sender's; what happened to it is the reader's.** One
 *     Mail row holds what was written; every recipient carries their own
 *     MailRecipient row with their read mark and their removal. So one person
 *     deleting a mail changes nothing for anybody else, and "read" is a fact
 *     about a reader rather than about the message.
 *
 *  2. **Being addressed is the only permission.** A mail is readable by its
 *     sender and its recipients — not by their manager, not by an admin of the
 *     company it was written in. Every method resolves the caller's standing on
 *     the mail first and works from that.
 *
 *  3. **Mail is not partitioned by company.** companyId/branchId record where it
 *     was WRITTEN, because the SRS asks for reach across the group; filtering by
 *     the active company would empty half of a director's inbox the moment they
 *     switched, which is the opposite of what mail is for. Same rule as chat and
 *     the approvals inbox.
 */
@Injectable()
export class MailService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  // ---------------------------------------------------------------- people --

  /** Everybody this user can address, for the To/Cc picker. */
  async directory(userId: number, q?: string): Promise<UserSummary[]> {
    const peers = await this.users.findPeers(userId);
    const needle = q?.trim().toLowerCase();
    if (!needle) return peers;
    return peers.filter((u) => MailService.matches(u, needle));
  }

  // ------------------------------------------------------------------ send --

  /**
   * Write one mail to everyone addressed.
   *
   * Recipients are resolved against the caller's colleagues rather than trusted
   * from the request: an id is a claim, and mail is the one screen where a
   * guessed id would otherwise reach a stranger's inbox. Addressing yourself is
   * allowed — a note to self is a real use, unlike a chat with yourself.
   */
  async send(
    userId: number,
    dto: SendMailDto,
    companyId?: number,
    branchId?: number,
  ) {
    const subject = dto.subject.trim();
    const body = dto.body.trim();
    if (!subject) throw new BadRequestException('Give the mail a subject.');

    const to = await this.resolveRecipients(userId, dto.to);
    const ccIds = (dto.cc ?? []).filter((id) => !to.has(id));
    const cc = await this.resolveRecipients(userId, ccIds, {
      allowEmpty: true,
    });
    if (to.size === 0) throw new BadRequestException('Address it to someone.');

    const attachments = (dto.attachments ?? []).map((a) =>
      MailService.validateAttachment(a),
    );

    // A reply must answer a mail the sender can actually see — otherwise the
    // thread link becomes a way to learn that a mail exists.
    if (dto.replyToId) {
      const parent = await this.prisma.mail.findUnique({
        where: { id: dto.replyToId },
        include: { recipients: { select: { userId: true } } },
      });
      const visible =
        parent &&
        (parent.senderId === userId ||
          parent.recipients.some((r) => r.userId === userId));
      if (!visible) {
        throw new BadRequestException(
          'The mail being replied to is not one of yours.',
        );
      }
    }

    const created = await this.prisma.mail.create({
      data: {
        subject,
        body,
        senderId: userId,
        companyId: companyId ?? null,
        branchId: branchId ?? null,
        parentId: dto.replyToId ?? null,
        recipients: {
          create: [
            ...[...to].map((id) => ({
              userId: id,
              kind: MailRecipientKind.TO,
            })),
            ...[...cc].map((id) => ({
              userId: id,
              kind: MailRecipientKind.CC,
            })),
          ],
        },
        attachments: attachments.length ? { create: attachments } : undefined,
      },
      include: mailInclude,
    });

    return this.view(created, userId);
  }

  // ----------------------------------------------------------------- lists --

  /**
   * What has been sent TO this user, newest first.
   *
   * Read off MailRecipient rather than Mail: the (userId, deletedAt) index is
   * exactly this query, and the read mark and removal being on that same row
   * means one person's inbox never needs to look at anybody else's.
   */
  async inbox(
    userId: number,
    opts: { q?: string; unreadOnly?: boolean; page?: number } = {},
  ) {
    const { skip, take } = MailService.pageWindow(opts.page);
    const needle = opts.q?.trim().toLowerCase();

    const where: Prisma.MailRecipientWhereInput = {
      userId,
      deletedAt: null,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(needle ? { mail: await this.searchFilter(userId, needle) } : {}),
    };

    const rows = await this.prisma.mailRecipient.findMany({
      where,
      include: { mail: { include: mailInclude } },
      orderBy: { mail: { sentAt: 'desc' } },
      skip,
      take: take + 1, // one extra: tells the client whether to offer another page
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const names = await this.namesFor(
      page.flatMap((r) => [
        r.mail.senderId,
        ...r.mail.recipients.map((x) => x.userId),
      ]),
    );

    return {
      hasMore,
      items: page.map((r) =>
        this.listItem(r.mail, userId, names, {
          isRead: r.readAt !== null,
          readAt: r.readAt,
          kind: r.kind,
        }),
      ),
    };
  }

  /** What this user has sent, newest first, each with how far it has been read. */
  async sent(userId: number, opts: { q?: string; page?: number } = {}) {
    const { skip, take } = MailService.pageWindow(opts.page);
    const needle = opts.q?.trim().toLowerCase();

    const rows = await this.prisma.mail.findMany({
      where: {
        senderId: userId,
        ...(needle ? await this.searchFilter(userId, needle) : {}),
      },
      include: mailInclude,
      orderBy: { sentAt: 'desc' },
      skip,
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const names = await this.namesFor(
      page.flatMap((m) => [m.senderId, ...m.recipients.map((r) => r.userId)]),
    );

    return {
      hasMore,
      items: page.map((m) => this.listItem(m, userId, names, { isRead: true })),
    };
  }

  // -------------------------------------------------------------- one mail --

  /**
   * Open a mail. Opening it as a recipient is what marks it read — the SRS asks
   * for read status, and a separate "mark as read" the reader has to remember
   * would report on their diligence rather than on the mail.
   */
  async get(userId: number, mailId: number) {
    const { mail, recipient } = await this.assertVisible(userId, mailId);

    if (recipient && recipient.readAt === null) {
      await this.prisma.mailRecipient.update({
        where: { id: recipient.id },
        data: { readAt: new Date() },
      });
      recipient.readAt = new Date();
    }

    return this.view(mail, userId);
  }

  /** Flip a mail's read mark by hand — "keep this one for later". */
  async setRead(userId: number, mailId: number, read: boolean) {
    const { recipient } = await this.assertVisible(userId, mailId);
    if (!recipient) {
      throw new BadRequestException(
        'A mail you sent has no read mark of your own.',
      );
    }
    await this.prisma.mailRecipient.update({
      where: { id: recipient.id },
      data: { readAt: read ? (recipient.readAt ?? new Date()) : null },
    });
    return { ok: true, isRead: read };
  }

  /**
   * Take a mail out of THIS person's inbox. The mail itself survives, because
   * the sender's copy and every other recipient's are theirs, not the caller's.
   */
  async remove(userId: number, mailId: number) {
    const { recipient } = await this.assertVisible(userId, mailId);
    if (!recipient) {
      throw new ForbiddenException(
        'A sent mail cannot be removed — the people you sent it to still have it.',
      );
    }
    await this.prisma.mailRecipient.update({
      where: { id: recipient.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  /** Unread mails in this user's inbox, for the badge. */
  async unreadTotal(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.mailRecipient.count({
      where: { userId, deletedAt: null, readAt: null },
    });
    return { count };
  }

  // --------------------------------------------------------------- drafts --

  /**
   * This person's unsent mail, most recently touched first.
   *
   * A draft is the author's alone — not addressed to anybody yet, whatever the
   * To line says, because nothing has been sent. Every method below resolves it
   * by (id, authorId) so there is no route to somebody else's half-written
   * letter.
   */
  async drafts(userId: number) {
    const rows = await this.prisma.mailDraft.findMany({
      where: { authorId: userId },
      orderBy: { updatedAt: 'desc' },
    });
    const names = await this.namesFor(
      rows.flatMap((d) => [...idList(d.to), ...idList(d.cc)]),
    );
    return rows.map((d) => this.draftView(d, names));
  }

  async draft(userId: number, id: number) {
    const row = await this.ownDraft(userId, id);
    const names = await this.namesFor([...idList(row.to), ...idList(row.cc)]);
    return this.draftView(row, names);
  }

  /**
   * Save a half-written mail, or update the one being written.
   *
   * Nothing here is required and nothing is resolved: the recipients are kept
   * as the ids they were picked as, and whether they can still be written to is
   * settled when the mail is sent. Somebody who has left the company between
   * Monday and Friday should fail on Friday, loudly, not have been quietly
   * dropped from a draft on Monday.
   */
  async saveDraft(
    userId: number,
    dto: SaveMailDraftDto,
    id?: number,
    companyId?: number,
    branchId?: number,
  ) {
    const data = {
      subject: (dto.subject ?? '').slice(0, 200),
      body: dto.body ?? '',
      to: dto.to ?? [],
      cc: dto.cc ?? [],
      replyToId: dto.replyToId ?? null,
      // Validated on the way in as well as on the way out: an attachment url is
      // a claim whenever it arrives, and a draft is a request like any other.
      attachments: (dto.attachments ?? []).map((a) =>
        MailService.validateAttachment(a),
      ) as unknown as Prisma.InputJsonValue,
      companyId: companyId ?? null,
      branchId: branchId ?? null,
    };

    const row = id
      ? await this.prisma.mailDraft.update({
          // Scoped by author as well as id, so an id from somewhere else
          // updates nothing rather than somebody else's draft.
          where: { id: (await this.ownDraft(userId, id)).id },
          data,
        })
      : await this.prisma.mailDraft.create({
          data: { ...data, authorId: userId },
        });

    const names = await this.namesFor([...idList(row.to), ...idList(row.cc)]);
    return this.draftView(row, names);
  }

  /** Throw a draft away. Nothing was sent, so nothing survives it. */
  async deleteDraft(userId: number, id: number) {
    const row = await this.ownDraft(userId, id);
    await this.prisma.mailDraft.delete({ where: { id: row.id } });
    return { ok: true };
  }

  /**
   * Send what a draft says, then throw the draft away.
   *
   * The content goes through the strict SendMailDto by hand (see
   * common/validate-dto.ts) and then through the ordinary send path — the same
   * checks on the same rules. A draft is a place to keep a mail, never a way to
   * send one that could not have been sent directly.
   */
  async sendDraft(
    userId: number,
    id: number,
    companyId?: number,
    branchId?: number,
  ) {
    const row = await this.ownDraft(userId, id);
    const dto = validateAs(SendMailDto, {
      subject: row.subject,
      body: row.body,
      to: idList(row.to),
      cc: idList(row.cc),
      replyToId: row.replyToId ?? undefined,
      attachments: row.attachments ?? [],
    });

    const sent = await this.send(
      userId,
      dto,
      companyId ?? row.companyId ?? undefined,
      branchId ?? row.branchId ?? undefined,
    );
    // Only once it has actually gone: a send that threw must leave the draft
    // exactly where its author left it.
    await this.prisma.mailDraft.delete({ where: { id: row.id } });
    return sent;
  }

  /** The caller's own draft, or nothing. 404 either way — see assertVisible. */
  private async ownDraft(userId: number, id: number) {
    const row = await this.prisma.mailDraft.findFirst({
      where: { id, authorId: userId },
    });
    if (!row) throw new NotFoundException('No such draft.');
    return row;
  }

  /** One draft, as the composer needs it back — ids resolved to names. */
  private draftView(
    draft: Prisma.MailDraftGetPayload<object>,
    names: Map<number, UserSummary>,
  ) {
    const person = (id: number) => ({
      id,
      name: names.get(id)?.name ?? `User #${id}`,
    });
    return {
      id: draft.id,
      subject: draft.subject,
      body: draft.body,
      to: idList(draft.to).map(person),
      cc: idList(draft.cc).map(person),
      replyToId: draft.replyToId,
      attachments: attachmentList(draft.attachments),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  // ----------------------------------------------------------- attachments --

  /**
   * Store an uploaded file and describe it back to the client, which sends the
   * description with the mail that carries it. Uploading ahead of the send keeps
   * a slow attachment from holding up the writing, and lets several go at once.
   *
   * The file is renamed off multer's temp name onto a random one of our own,
   * keeping only the extension: the original name is shown from the database and
   * never used as a path.
   */
  async saveAttachment(file: UploadedMailFile): Promise<MailAttachmentRefDto> {
    if (!file) throw new BadRequestException('No file uploaded.');
    if (file.size > MAIL_MAX_FILE_BYTES) {
      throw new BadRequestException('That file is larger than 25 MB.');
    }
    const ext = extname(file.originalname).slice(0, 12);
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    await rename(file.path, join(MAIL_UPLOAD_DIR, name));
    return {
      fileName: basename(file.originalname).slice(0, 255),
      url: `${MAIL_URL_PREFIX}/${name}`,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  // ---------------------------------------------------------------- guards --

  /**
   * The mail, plus the caller's own recipient row when they have one.
   *
   * 404 rather than 403 throughout: whether a mail exists is itself private, and
   * a removed mail is gone for the person who removed it even though the row
   * survives for everybody else.
   */
  private async assertVisible(userId: number, mailId: number) {
    const mail = await this.prisma.mail.findUnique({
      where: { id: mailId },
      include: mailInclude,
    });
    if (!mail) throw new NotFoundException('No such mail.');

    const recipient = mail.recipients.find((r) => r.userId === userId) ?? null;
    const visible =
      mail.senderId === userId || (recipient && recipient.deletedAt === null);
    if (!visible) throw new NotFoundException('No such mail.');
    return {
      mail,
      recipient: recipient?.deletedAt === null ? recipient : null,
    };
  }

  // --------------------------------------------------------------- helpers --

  /**
   * The ids this user may address. Resolved through the port, so "who can I
   * write to" is the same question the rest of the app answers — anyone sharing
   * a company, plus every super admin — and never a raw id from the request.
   */
  private async resolveRecipients(
    userId: number,
    ids: number[],
    opts: { allowEmpty?: boolean } = {},
  ): Promise<Set<number>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) {
      if (opts.allowEmpty) return new Set();
      throw new BadRequestException('Address it to someone.');
    }
    const peers = await this.users.findPeers(userId);
    const allowed = new Set(peers.map((p) => p.id));
    allowed.add(userId); // a note to self is a mail like any other
    for (const id of wanted) {
      if (!allowed.has(id)) {
        // One answer for "no such user", "inactive" and "not a colleague":
        // which it is would say something about people the caller has no
        // business knowing about.
        throw new BadRequestException(
          'One of those people cannot be written to.',
        );
      }
    }
    return new Set(wanted);
  }

  /**
   * Free-text search over a mailbox: the words in the mail, or the name of a
   * person on it.
   *
   * The name half is resolved to ids first, through the port — the mail domain
   * holds no names of its own (senderId is a plain cross-domain Int), so a join
   * is not available even in principle.
   */
  private async searchFilter(
    userId: number,
    needle: string,
  ): Promise<Prisma.MailWhereInput> {
    const peers = await this.users.findPeers(userId);
    const peopleIds = peers
      .filter((p) => MailService.matches(p, needle))
      .map((p) => p.id);

    return {
      OR: [
        { subject: { contains: needle, mode: 'insensitive' } },
        { body: { contains: needle, mode: 'insensitive' } },
        ...(peopleIds.length
          ? [
              { senderId: { in: peopleIds } },
              { recipients: { some: { userId: { in: peopleIds } } } },
            ]
          : []),
      ],
    };
  }

  /** Ids → names, in one lookup, as a Map the view helpers can read. */
  private async namesFor(ids: number[]): Promise<Map<number, UserSummary>> {
    const wanted = [...new Set(ids.filter((id) => id > 0))];
    const found = await this.users.findByIds(wanted);
    return new Map(found.map((u) => [u.id, u]));
  }

  // ----------------------------------------------------------- view shapes --

  /** One mail, in full, as the caller is entitled to see it. */
  private async view(mail: MailRow, userId: number) {
    const names = await this.namesFor([
      mail.senderId,
      ...mail.recipients.map((r) => r.userId),
      mail.parent?.senderId ?? 0,
    ]);
    const isSender = mail.senderId === userId;
    const mine = mail.recipients.find((r) => r.userId === userId) ?? null;

    const person = (r: (typeof mail.recipients)[number]) => ({
      id: r.userId,
      name: names.get(r.userId)?.name ?? `User #${r.userId}`,
      username: names.get(r.userId)?.username ?? '',
      // Read receipts are the sender's to see. A recipient learns whether THEY
      // have read it, and nothing about who else has.
      readAt: isSender || r.userId === userId ? this.iso(r.readAt) : null,
    });

    return {
      id: mail.id,
      subject: mail.subject,
      body: mail.body,
      sentAt: mail.sentAt.toISOString(),
      companyId: mail.companyId,
      branchId: mail.branchId,
      sender: {
        id: mail.senderId,
        name: names.get(mail.senderId)?.name ?? `User #${mail.senderId}`,
        username: names.get(mail.senderId)?.username ?? '',
      },
      isMine: isSender,
      isRead: mine ? mine.readAt !== null : true,
      to: mail.recipients
        .filter((r) => r.kind === MailRecipientKind.TO)
        .map(person),
      cc: mail.recipients
        .filter((r) => r.kind === MailRecipientKind.CC)
        .map(person),
      readCount: mail.recipients.filter((r) => r.readAt !== null).length,
      recipientCount: mail.recipients.length,
      attachments: mail.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        url: a.url,
        mimeType: a.mimeType,
        size: a.size,
      })),
      replyTo: mail.parent
        ? {
            id: mail.parent.id,
            subject: mail.parent.subject,
            senderName: names.get(mail.parent.senderId)?.name ?? 'Someone',
            sentAt: mail.parent.sentAt.toISOString(),
          }
        : null,
    };
  }

  /** One row of a mailbox list — enough to decide whether to open it. */
  private listItem(
    mail: MailRow,
    userId: number,
    names: Map<number, UserSummary>,
    mine: { isRead: boolean; readAt?: Date | null; kind?: MailRecipientKind },
  ) {
    const nameOf = (id: number) => names.get(id)?.name ?? `User #${id}`;
    return {
      id: mail.id,
      subject: mail.subject,
      preview: mail.body.slice(0, PREVIEW_CHARS),
      sentAt: mail.sentAt.toISOString(),
      senderId: mail.senderId,
      senderName: nameOf(mail.senderId),
      isMine: mail.senderId === userId,
      isRead: mine.isRead,
      /** How I was addressed — the reader's "to me" / "cc" marker. */
      myKind: mine.kind ?? null,
      to: mail.recipients
        .filter((r) => r.kind === MailRecipientKind.TO)
        .map((r) => ({ id: r.userId, name: nameOf(r.userId) })),
      cc: mail.recipients
        .filter((r) => r.kind === MailRecipientKind.CC)
        .map((r) => ({ id: r.userId, name: nameOf(r.userId) })),
      readCount: mail.recipients.filter((r) => r.readAt !== null).length,
      recipientCount: mail.recipients.length,
      attachmentCount: mail.attachments.length,
      hasReply: mail.parentId !== null,
    };
  }

  private iso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
  }

  // ------------------------------------------------------------------ pure --

  private static pageWindow(page?: number) {
    const n = Number.isFinite(page) && (page ?? 0) > 0 ? Math.floor(page!) : 1;
    return { skip: (n - 1) * MAIL_PAGE_SIZE, take: MAIL_PAGE_SIZE };
  }

  private static matches(user: UserSummary, needle: string): boolean {
    return [user.name, user.username, user.userCode, user.email]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  }

  /**
   * An attachment reference arrives from the client, so treat it as a claim.
   * The URL must be one this module minted: a path of the caller's choosing
   * would otherwise let them attach — and so hand around — any file the static
   * mount serves.
   */
  private static validateAttachment(
    a: MailAttachmentRefDto,
  ): MailAttachmentRefDto {
    const prefix = `${MAIL_URL_PREFIX}/`;
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
