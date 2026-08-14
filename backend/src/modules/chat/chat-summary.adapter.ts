import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

const CHAT_ROUTE = '/workplace/chat';

/**
 * Chat's contribution to the Workplace dashboard: how many conversations have
 * something new in them.
 *
 * CONVERSATIONS, not messages. "You have 214 unread messages" is a number
 * nobody acts on; "4 conversations have something new" is. It also matches what
 * the chat screen itself shows, so the two cannot disagree.
 *
 * No `waiting` rows: a conversation is not a thing waiting to be dealt with, it
 * is somewhere to go, and putting chatter on a list of what is outstanding is
 * how that list stops being read.
 */
@Injectable()
export class ChatSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'chat';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const parts = await this.prisma.conversationParticipant.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true, lastReadMessageId: true },
    });
    if (!parts.length) return [this.tile(0)];

    // Unread is "something after my high-water mark that is not mine" — the same
    // rule the conversation list uses. One groupBy for the newest such message
    // in each conversation, rather than a count per conversation: this runs on
    // every dashboard load, and a query per chat is how a page gets slow for the
    // people who talk most.
    const newest = await this.prisma.chatMessage.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: parts.map((p) => p.conversationId) },
        senderId: { not: userId },
        deletedAt: null,
      },
      _max: { id: true },
    });
    const newestIn = new Map(
      newest.map((n) => [n.conversationId, n._max.id ?? 0]),
    );

    const unread = parts.filter(
      (p) => (newestIn.get(p.conversationId) ?? 0) > (p.lastReadMessageId ?? 0),
    ).length;

    return [this.tile(unread)];
  }

  async waiting(): Promise<WorkplaceItem[]> {
    return [];
  }

  private tile(count: number): WorkplaceTile {
    return {
      key: 'chat.unread',
      label: 'Chats',
      count,
      route: CHAT_ROUTE,
      icon: 'message-circle',
      tone: count ? 'attention' : 'normal',
      order: 80,
    };
  }
}
