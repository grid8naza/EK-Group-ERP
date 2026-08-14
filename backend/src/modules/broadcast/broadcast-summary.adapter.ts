import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

const VIEW_ROUTE = '/workplace/broadcast/view';

/**
 * Broadcast's contribution to the Workplace dashboard: announcements this person
 * has not read yet and has not waved away.
 *
 * A count only, and no `waiting` rows — deliberately. A broadcast asks nothing
 * of anybody: it is an announcement, not an obligation, and the difference
 * between it and a circular is exactly that one is acknowledged and the other is
 * merely seen. Listing announcements among the things somebody owes an answer to
 * would erase the distinction the two features were built around.
 */
@Injectable()
export class BroadcastSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'broadcasts';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const now = new Date();
    const count = await this.prisma.broadcastRecipient.count({
      where: {
        userId,
        readAt: null,
        dismissedAt: null,
        // An announcement whose "show until" has passed is off the feed, so it
        // must not be counted as something still to see.
        OR: [
          { broadcast: { expiresAt: null } },
          { broadcast: { expiresAt: { gt: now } } },
        ],
      },
    });

    return [
      {
        key: 'broadcasts.unread',
        label: 'Announcements',
        count,
        route: VIEW_ROUTE,
        icon: 'megaphone',
        order: 90,
      },
    ];
  }

  async waiting(): Promise<WorkplaceItem[]> {
    return [];
  }
}
