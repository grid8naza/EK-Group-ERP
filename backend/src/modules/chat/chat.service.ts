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
import {
  ChatMessageKind,
  ChatParticipantRole,
  ConversationKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_LOOKUP,
  UserLookupPort,
  UserSummary,
} from '../../contracts/user-lookup.port';
import { ChatEventsService } from './chat-events.service';
import {
  CHAT_MAX_FILE_BYTES,
  CHAT_PAGE_SIZE,
  CHAT_UPLOAD_DIR,
  CHAT_URL_PREFIX,
} from './chat.constants';
import {
  AddParticipantsDto,
  ChatAttachmentRefDto,
  CreateGroupDto,
  EditMessageDto,
  SendMessageDto,
} from './chat.dto';

/** Minimal multer file shape (avoids needing @types/multer). */
export interface UploadedChatFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** A person, as a conversation shows them. */
export interface ChatUserView {
  id: number;
  name: string;
  username: string;
  role: ChatParticipantRole;
  isOnline: boolean;
  hasLeft: boolean;
  lastReadMessageId: number | null;
}

const messageInclude = {
  attachments: true,
  replyTo: {
    select: { id: true, senderId: true, body: true, deletedAt: true },
  },
} satisfies Prisma.ChatMessageInclude;

type MessageRow = Prisma.ChatMessageGetPayload<{
  include: typeof messageInclude;
}>;

const conversationInclude = {
  participants: true,
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

/**
 * Internal chat (SRS §8.11, FR-COM-02) — one-to-one and group conversations,
 * attachments, quoted replies, edits, deletes and read receipts.
 *
 * Two rules shape everything here:
 *
 *  1. **Membership is the only permission.** A conversation is readable by its
 *     participants and by nobody else — not by their manager, not by an admin of
 *     the company it was started in. Every method therefore begins by resolving
 *     the caller's participant row, and works from that row rather than from the
 *     id it was handed.
 *
 *  2. **A conversation is not partitioned by company.** companyId/branchId
 *     record where a thread STARTED because the SRS asks for reach "across the
 *     group, its companies and branches" — filtering by the active company would
 *     hide half of a director's conversations the moment they switched, which is
 *     the opposite of what a messenger is for.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ChatEventsService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  // ---------------------------------------------------------------- people --

  /** Everybody this user may start a conversation with, newest names first. */
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

  // --------------------------------------------------------- conversations --

  /**
   * Every conversation this user is in, newest activity first, each with its
   * unread count and how far the others have read.
   */
  async listConversations(userId: number) {
    const memberships = await this.prisma.conversationParticipant.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true },
    });
    const ids = memberships.map((m) => m.conversationId);
    if (ids.length === 0) return [];

    const [conversations, unread] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { id: { in: ids } },
        include: conversationInclude,
      }),
      this.unreadByConversation(userId),
    ]);

    const names = await this.namesFor(
      conversations.flatMap((c) => c.participants.map((p) => p.userId)),
    );

    return conversations
      .map((c) =>
        this.viewConversation(c, userId, names, unread.get(c.id) ?? 0),
      )
      .sort((a, b) => {
        // Threads that have never been used sort by creation, not to the bottom
        // for ever — a group just created is the one you are about to type in.
        const at = a.lastMessageAt ?? a.createdAt;
        const bt = b.lastMessageAt ?? b.createdAt;
        return bt.localeCompare(at);
      });
  }

  /** One conversation, if the caller is in it. */
  async getConversation(userId: number, conversationId: number) {
    const { conversation } = await this.assertMember(userId, conversationId);
    const names = await this.namesFor(
      conversation.participants.map((p) => p.userId),
    );
    const unread = await this.unreadByConversation(userId, [conversationId]);
    return this.viewConversation(
      conversation,
      userId,
      names,
      unread.get(conversationId) ?? 0,
    );
  }

  /**
   * Open the one-to-one thread with somebody, creating it only if this is the
   * first time. Racing clicks from two devices land on the same row: the pair is
   * keyed by `directKey` and the database holds the uniqueness, not a check here.
   */
  async startDirect(
    userId: number,
    otherUserId: number,
    companyId?: number,
    branchId?: number,
  ) {
    if (otherUserId === userId) {
      throw new BadRequestException('You cannot start a chat with yourself.');
    }
    const peers = await this.users.findPeers(userId);
    if (!peers.some((p) => p.id === otherUserId)) {
      // Covers "no such user", "inactive" and "not a colleague" in one answer —
      // which of those it is would tell a caller something about people they
      // have no business knowing about.
      throw new NotFoundException('That person is not available to chat with.');
    }

    const key = ChatService.directKey(userId, otherUserId);
    const existing = await this.prisma.conversation.findUnique({
      where: { directKey: key },
      include: conversationInclude,
    });
    if (existing) {
      // Re-opening a thread they had left puts them back in it.
      await this.prisma.conversationParticipant.updateMany({
        where: { conversationId: existing.id, leftAt: { not: null } },
        data: { leftAt: null },
      });
      return this.getConversation(userId, existing.id);
    }

    const created = await this.prisma.conversation.create({
      data: {
        kind: ConversationKind.DIRECT,
        directKey: key,
        companyId: companyId ?? null,
        branchId: branchId ?? null,
        createdById: userId,
        participants: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
      include: conversationInclude,
    });

    await this.announce(created, 'conversation.new');
    return this.getConversation(userId, created.id);
  }

  /** Create a named group. The creator is its admin. */
  async createGroup(
    userId: number,
    dto: CreateGroupDto,
    companyId?: number,
    branchId?: number,
  ) {
    const members = await this.resolvePeers(userId, dto.userIds);

    const created = await this.prisma.conversation.create({
      data: {
        kind: ConversationKind.GROUP,
        title: dto.title.trim(),
        companyId: companyId ?? null,
        branchId: branchId ?? null,
        createdById: userId,
        participants: {
          create: [
            { userId, role: ChatParticipantRole.ADMIN },
            ...members.map((m) => ({ userId: m.id })),
          ],
        },
      },
      include: conversationInclude,
    });

    await this.systemMessage(created.id, userId, 'created this group');
    await this.announce(created, 'conversation.new');
    return this.getConversation(userId, created.id);
  }

  async renameGroup(userId: number, conversationId: number, title: string) {
    const { conversation } = await this.assertGroupAdmin(
      userId,
      conversationId,
    );
    const clean = title.trim();
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { title: clean },
    });
    await this.systemMessage(
      conversation.id,
      userId,
      `renamed the group to "${clean}"`,
    );
    return this.getConversation(userId, conversation.id);
  }

  async addParticipants(
    userId: number,
    conversationId: number,
    dto: AddParticipantsDto,
  ) {
    const { conversation } = await this.assertGroupAdmin(
      userId,
      conversationId,
    );
    const toAdd = await this.resolvePeers(userId, dto.userIds);

    for (const person of toAdd) {
      // Someone who left and is being brought back keeps their old row (and so
      // their read mark); a create would collide with the unique index anyway.
      await this.prisma.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: person.id,
          },
        },
        update: { leftAt: null },
        create: { conversationId: conversation.id, userId: person.id },
      });
      await this.systemMessage(conversation.id, userId, `added ${person.name}`);
    }

    const fresh = await this.loadConversation(conversation.id);
    await this.announce(fresh, 'conversation.updated');
    return this.getConversation(userId, conversation.id);
  }

  /** Remove somebody from a group — or, when they are the caller, leave it. */
  async removeParticipant(
    userId: number,
    conversationId: number,
    targetUserId: number,
  ) {
    const leaving = targetUserId === userId;
    const { conversation } = leaving
      ? await this.assertMember(userId, conversationId)
      : await this.assertGroupAdmin(userId, conversationId);

    if (conversation.kind === ConversationKind.DIRECT) {
      throw new BadRequestException(
        'A one-to-one chat has no members to remove.',
      );
    }

    const target = conversation.participants.find(
      (p) => p.userId === targetUserId && p.leftAt === null,
    );
    if (!target) throw new NotFoundException('They are not in this group.');

    await this.prisma.conversationParticipant.update({
      where: { id: target.id },
      data: { leftAt: new Date() },
    });

    const [who] = await this.users.findByIds([targetUserId]);
    await this.systemMessage(
      conversation.id,
      userId,
      leaving ? 'left the group' : `removed ${who?.name ?? 'someone'}`,
    );

    const fresh = await this.loadConversation(conversation.id);
    // Announced to the people still in it AND to the person removed, so their
    // own list updates rather than showing a group they can no longer open.
    this.events.emit(
      [...fresh.participants.map((p) => p.userId), targetUserId],
      { type: 'conversation.updated', data: { conversationId: fresh.id } },
    );
    return { ok: true };
  }

  // -------------------------------------------------------------- messages --

  /**
   * One page of a thread, oldest-first, paging backwards from `before`.
   *
   * Deleted messages are returned as tombstones rather than dropped: a reply
   * quoting one, and the conversation either side of it, stops making sense if
   * the gap is silent.
   */
  async listMessages(
    userId: number,
    conversationId: number,
    before?: number,
    limit = CHAT_PAGE_SIZE,
  ) {
    await this.assertMember(userId, conversationId);
    const take = Math.min(Math.max(limit, 1), 100);

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        ...(before ? { id: { lt: before } } : {}),
      },
      include: messageInclude,
      orderBy: { id: 'desc' },
      take: take + 1, // one extra: tells the client whether to offer "load more"
    });

    const hasMore = rows.length > take;
    const page = (hasMore ? rows.slice(0, take) : rows).reverse();
    const names = await this.namesFor([
      ...page.map((m) => m.senderId),
      ...page.map((m) => m.replyTo?.senderId).filter((v): v is number => !!v),
    ]);

    return {
      hasMore,
      messages: page.map((m) => this.viewMessage(m, names)),
    };
  }

  /** Post a message, and push it to everyone in the thread. */
  async sendMessage(
    userId: number,
    conversationId: number,
    dto: SendMessageDto,
  ) {
    const { conversation } = await this.assertMember(userId, conversationId);

    const body = dto.body?.trim() || null;
    const attachments = (dto.attachments ?? []).map((a) =>
      ChatService.validateAttachment(a),
    );
    if (!body && attachments.length === 0) {
      throw new BadRequestException('Type something, or attach a file.');
    }

    if (dto.replyToId) {
      const quoted = await this.prisma.chatMessage.findFirst({
        where: { id: dto.replyToId, conversationId },
        select: { id: true },
      });
      if (!quoted) {
        throw new BadRequestException(
          'The message being replied to is not in this conversation.',
        );
      }
    }

    const kind = ChatService.kindOf(attachments);

    // One transaction: the message and the conversation's preview must not
    // disagree — a list showing a preview of a message that failed to save (or
    // missing one that did) is worse than either failing outright.
    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          conversationId,
          senderId: userId,
          kind,
          body,
          replyToId: dto.replyToId ?? null,
          attachments: attachments.length ? { create: attachments } : undefined,
        },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: message.createdAt,
          lastMessageText: ChatService.previewOf(message),
          lastMessageById: userId,
        },
      });
      // The sender has, by definition, read what they just sent — otherwise
      // their own message comes back as unread on their other devices.
      await tx.conversationParticipant.updateMany({
        where: { conversationId, userId },
        data: { lastReadMessageId: message.id, lastReadAt: new Date() },
      });
      return message;
    });

    const names = await this.namesFor([userId, created.replyTo?.senderId ?? 0]);
    const view = this.viewMessage(created, names);
    this.events.emit(this.audience(conversation), {
      type: 'message.new',
      data: { conversationId, message: view },
    });
    return view;
  }

  async editMessage(userId: number, messageId: number, dto: EditMessageDto) {
    const message = await this.ownMessage(userId, messageId);
    if (message.deletedAt) {
      throw new BadRequestException('That message was deleted.');
    }
    const body = dto.body.trim();
    if (!body)
      throw new BadRequestException('An edited message cannot be empty.');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { body, editedAt: new Date() },
      include: messageInclude,
    });
    await this.refreshPreview(updated.conversationId);

    const names = await this.namesFor([
      updated.senderId,
      updated.replyTo?.senderId ?? 0,
    ]);
    const view = this.viewMessage(updated, names);
    this.events.emit(await this.audienceOf(updated.conversationId), {
      type: 'message.updated',
      data: { conversationId: updated.conversationId, message: view },
    });
    return view;
  }

  /**
   * Delete for everyone. The row stays as a tombstone — body and attachments
   * are cleared, so the file is unreachable, but the thread keeps its shape.
   */
  async deleteMessage(userId: number, messageId: number) {
    const message = await this.ownMessage(userId, messageId);
    if (message.deletedAt) return { ok: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.chatAttachment.deleteMany({ where: { messageId } });
      await tx.chatMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), body: null },
      });
    });
    await this.refreshPreview(message.conversationId);

    this.events.emit(await this.audienceOf(message.conversationId), {
      type: 'message.deleted',
      data: { conversationId: message.conversationId, messageId },
    });
    return { ok: true };
  }

  // ------------------------------------------------------- receipts & live --

  /** Move this reader's high-water mark, and tell the others they were read. */
  async markRead(
    userId: number,
    conversationId: number,
    lastMessageId: number,
  ) {
    const { participant, conversation } = await this.assertMember(
      userId,
      conversationId,
    );
    // Never moves backwards: a client that reports an older message (a stale
    // tab, an out-of-order request) must not un-read the thread.
    if ((participant.lastReadMessageId ?? 0) >= lastMessageId) {
      return { lastReadMessageId: participant.lastReadMessageId ?? null };
    }

    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { lastReadMessageId: lastMessageId, lastReadAt: new Date() },
    });

    this.events.emit(this.audience(conversation), {
      type: 'conversation.read',
      data: { conversationId, userId, lastReadMessageId: lastMessageId },
    });
    return { lastReadMessageId: lastMessageId };
  }

  /** Everything unread, for the badge. */
  async unreadTotal(userId: number): Promise<{ count: number }> {
    const perConversation = await this.unreadByConversation(userId);
    let count = 0;
    for (const n of perConversation.values()) count += n;
    return { count };
  }

  /** "…is typing". Pushed to the others and never stored. */
  async typing(userId: number, conversationId: number) {
    const { conversation } = await this.assertMember(userId, conversationId);
    const [me] = await this.users.findByIds([userId]);
    this.events.emit(
      this.audience(conversation).filter((id) => id !== userId),
      {
        type: 'typing',
        data: { conversationId, userId, userName: me?.name ?? '' },
      },
    );
    return { ok: true };
  }

  // ----------------------------------------------------------- attachments --

  /**
   * Store an uploaded file and describe it back to the client, which sends the
   * description with the message it belongs to.
   *
   * The file is renamed off multer's random temp name onto a random name of our
   * own, keeping only the extension: the original name is shown in the thread
   * from the database, never used as a path.
   */
  async saveAttachment(file: UploadedChatFile): Promise<ChatAttachmentRefDto> {
    if (!file) throw new BadRequestException('No file uploaded.');
    if (file.size > CHAT_MAX_FILE_BYTES) {
      throw new BadRequestException('That file is larger than 25 MB.');
    }
    const ext = extname(file.originalname).slice(0, 12);
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    await rename(file.path, join(CHAT_UPLOAD_DIR, name));
    return {
      fileName: basename(file.originalname).slice(0, 255),
      url: `${CHAT_URL_PREFIX}/${name}`,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  // ---------------------------------------------------------------- guards --

  /** The caller's live participant row, or 404/403. */
  private async assertMember(userId: number, conversationId: number) {
    const conversation = await this.loadConversation(conversationId);
    const participant = conversation.participants.find(
      (p) => p.userId === userId && p.leftAt === null,
    );
    if (!participant) {
      // Not 403: whether a conversation exists is itself private.
      throw new NotFoundException('No such conversation.');
    }
    return { conversation, participant };
  }

  private async assertGroupAdmin(userId: number, conversationId: number) {
    const found = await this.assertMember(userId, conversationId);
    if (found.conversation.kind !== ConversationKind.GROUP) {
      throw new BadRequestException('That is not a group.');
    }
    if (found.participant.role !== ChatParticipantRole.ADMIN) {
      throw new ForbiddenException('Only a group admin can do that.');
    }
    return found;
  }

  private async ownMessage(userId: number, messageId: number) {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        senderId: true,
        conversationId: true,
        deletedAt: true,
      },
    });
    if (!message) throw new NotFoundException('No such message.');
    await this.assertMember(userId, message.conversationId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only change your own messages.');
    }
    return message;
  }

  private async loadConversation(id: number): Promise<ConversationRow> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
    if (!conversation) throw new NotFoundException('No such conversation.');
    return conversation;
  }

  // --------------------------------------------------------------- helpers --

  /** The user ids a conversation's events go to — the people still in it. */
  private audience(conversation: ConversationRow): number[] {
    return conversation.participants
      .filter((p) => p.leftAt === null)
      .map((p) => p.userId);
  }

  private async audienceOf(conversationId: number): Promise<number[]> {
    return this.audience(await this.loadConversation(conversationId));
  }

  private async announce(
    conversation: ConversationRow,
    type: 'conversation.new' | 'conversation.updated',
  ) {
    this.events.emit(this.audience(conversation), {
      type,
      data: { conversationId: conversation.id },
    });
  }

  /** Ids → names, in one lookup, as a Map the view helpers can read. */
  private async namesFor(ids: number[]): Promise<Map<number, UserSummary>> {
    const wanted = [...new Set(ids.filter((id) => id > 0))];
    const found = await this.users.findByIds(wanted);
    return new Map(found.map((u) => [u.id, u]));
  }

  /** The peers among the given ids — anyone else is rejected, not skipped. */
  private async resolvePeers(
    userId: number,
    ids: number[],
  ): Promise<UserSummary[]> {
    const peers = await this.users.findPeers(userId);
    const byId = new Map(peers.map((p) => [p.id, p]));
    const resolved: UserSummary[] = [];
    for (const id of new Set(ids)) {
      if (id === userId) continue; // the caller is added by the caller
      const peer = byId.get(id);
      if (!peer) {
        throw new BadRequestException(
          'One of those people is not available to chat with.',
        );
      }
      resolved.push(peer);
    }
    if (resolved.length === 0) {
      throw new BadRequestException('Choose at least one other person.');
    }
    return resolved;
  }

  /**
   * Unread counts per conversation, in ONE query.
   *
   * Raw SQL because the threshold differs per row — each conversation is
   * counted from that participant's own high-water mark — which no groupBy can
   * express. Reads straight off the (conversationId, id) index.
   */
  private async unreadByConversation(
    userId: number,
    conversationIds?: number[],
  ): Promise<Map<number, number>> {
    const scope =
      conversationIds && conversationIds.length
        ? Prisma.sql`AND m."conversationId" IN (${Prisma.join(conversationIds)})`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { conversationId: number; unread: bigint }[]
    >(Prisma.sql`
      SELECT m."conversationId" AS "conversationId", COUNT(*) AS unread
        FROM chat_messages m
        JOIN chat_participants p
          ON p."conversationId" = m."conversationId"
         AND p."userId" = ${userId}
       WHERE p."leftAt" IS NULL
         AND m."senderId" <> ${userId}
         AND m."deletedAt" IS NULL
         AND m.id > COALESCE(p."lastReadMessageId", 0)
         ${scope}
       GROUP BY m."conversationId"
    `);
    return new Map(rows.map((r) => [r.conversationId, Number(r.unread)]));
  }

  /** Write the engine's own narration into a thread ("X added Y"). */
  private async systemMessage(
    conversationId: number,
    actorId: number,
    text: string,
  ) {
    const [actor] = await this.users.findByIds([actorId]);
    const body = `${actor?.name ?? 'Someone'} ${text}`;
    const message = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        senderId: actorId,
        kind: ChatMessageKind.SYSTEM,
        body,
      },
      include: messageInclude,
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        lastMessageText: body,
        lastMessageById: actorId,
      },
    });
    const names = await this.namesFor([actorId]);
    this.events.emit(await this.audienceOf(conversationId), {
      type: 'message.new',
      data: { conversationId, message: this.viewMessage(message, names) },
    });
  }

  /**
   * Re-derive a conversation's preview from its newest surviving message.
   * Needed after an edit or a delete: the list would otherwise keep quoting text
   * that is no longer in the thread.
   */
  private async refreshPreview(conversationId: number) {
    const newest = await this.prisma.chatMessage.findFirst({
      where: { conversationId },
      include: messageInclude,
      orderBy: { id: 'desc' },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: newest?.createdAt ?? null,
        lastMessageText: newest ? ChatService.previewOf(newest) : null,
        lastMessageById: newest?.senderId ?? null,
      },
    });
  }

  // ------------------------------------------------------------ view shapes --

  private viewConversation(
    conversation: ConversationRow,
    userId: number,
    names: Map<number, UserSummary>,
    unreadCount: number,
  ) {
    const live = conversation.participants.filter((p) => p.leftAt === null);
    const others = live.filter((p) => p.userId !== userId);
    const mine = conversation.participants.find((p) => p.userId === userId);

    const participants: ChatUserView[] = conversation.participants.map((p) => ({
      id: p.userId,
      name: names.get(p.userId)?.name ?? `User #${p.userId}`,
      username: names.get(p.userId)?.username ?? '',
      role: p.role,
      isOnline: this.events.isOnline(p.userId),
      hasLeft: p.leftAt !== null,
      lastReadMessageId: p.lastReadMessageId,
    }));

    const isDirect = conversation.kind === ConversationKind.DIRECT;
    const counterpart = isDirect ? (others[0] ?? null) : null;

    return {
      id: conversation.id,
      kind: conversation.kind,
      // A one-to-one thread is titled by whoever you are talking to, so it is
      // resolved per viewer here rather than stored on the row.
      title: isDirect
        ? ((counterpart && names.get(counterpart.userId)?.name) ?? 'Chat')
        : (conversation.title ?? 'Group'),
      companyId: conversation.companyId,
      branchId: conversation.branchId,
      counterpartId: counterpart?.userId ?? null,
      isOnline: counterpart ? this.events.isOnline(counterpart.userId) : false,
      participants,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastMessageText: conversation.lastMessageText,
      lastMessageById: conversation.lastMessageById,
      createdAt: conversation.createdAt.toISOString(),
      unreadCount,
      myLastReadMessageId: mine?.lastReadMessageId ?? null,
      /**
       * The second tick: how far the LEAST-caught-up other participant has read.
       * In a group that means "everyone has seen it", which is the only reading
       * of a group tick that is not misleading.
       */
      readByOthersUpTo: others.length
        ? Math.min(...others.map((p) => p.lastReadMessageId ?? 0))
        : 0,
    };
  }

  private viewMessage(message: MessageRow, names: Map<number, UserSummary>) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName:
        names.get(message.senderId)?.name ?? `User #${message.senderId}`,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            senderName: names.get(message.replyTo.senderId)?.name ?? 'Someone',
            body: message.replyTo.deletedAt ? null : message.replyTo.body,
            deleted: message.replyTo.deletedAt !== null,
          }
        : null,
      attachments: message.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        url: a.url,
        mimeType: a.mimeType,
        size: a.size,
      })),
    };
  }

  // ------------------------------------------------------------------ pure --

  /** Stable key for a pair, whichever way round they opened the chat. */
  private static directKey(a: number, b: number): string {
    return `${Math.min(a, b)}:${Math.max(a, b)}`;
  }

  private static kindOf(attachments: ChatAttachmentRefDto[]): ChatMessageKind {
    if (attachments.length === 0) return ChatMessageKind.TEXT;
    return attachments.every((a) => a.mimeType.startsWith('image/'))
      ? ChatMessageKind.IMAGE
      : ChatMessageKind.FILE;
  }

  /**
   * An attachment reference arrives from the client, so treat it as a claim.
   * The URL must be one this module minted: a path of the caller's choosing
   * would otherwise let them attach — and so hand around — any file the static
   * mount serves.
   */
  private static validateAttachment(
    a: ChatAttachmentRefDto,
  ): ChatAttachmentRefDto {
    const prefix = `${CHAT_URL_PREFIX}/`;
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

  /** What the conversation list shows under the title. */
  private static previewOf(message: {
    body: string | null;
    kind: ChatMessageKind;
    attachments?: { fileName: string }[];
  }): string {
    if (message.body) return message.body.slice(0, 200);
    const first = message.attachments?.[0];
    if (message.kind === ChatMessageKind.IMAGE) return '📷 Photo';
    if (first) return `📎 ${first.fileName}`;
    return '';
  }
}
