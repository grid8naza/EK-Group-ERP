import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

const ALERTS_ROUTE = '/workplace/alerts';

/**
 * Alerts' contribution to the Workplace dashboard: the URGENT ones, as rows.
 *
 * NO TILE. The bell in the topbar is on every screen of the application and
 * already carries the unread count, so a card repeating it would be the one
 * number on this page the reader can see without coming here — and it would
 * cost a whole row of the grid to say it twice.
 *
 * What alerts do contribute is the handful that say something is on fire.
 * Those belong on a page about what is waiting, and nothing else shows them
 * ranked against the approvals and overdue work they compete with.
 */
@Injectable()
export class NotificationSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'alerts';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(): Promise<WorkplaceTile[]> {
    return [];
  }

  async waiting(userId: number, limit: number): Promise<WorkplaceItem[]> {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        priority: 'URGENT',
        resolvedAt: null,
        dismissedAt: null,
        // Not the categories another provider already answers for. An overdue
        // task raises both a TASK row (from the task module, with its due date
        // and its title) and an "Task overdue" alert about the same task, and
        // listing the two together tells the reader nothing twice. The same
        // goes for approvals. What is left is what only the alert knows —
        // stock-outs, expiry, and whatever publishes here next.
        category: { notIn: ['TASK', 'APPROVAL'] },
      },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        body: true,
        route: true,
        documentId: true,
        companyId: true,
        branchId: true,
        createdAt: true,
      },
    });

    return rows.map((n) => ({
      key: `alert:${n.id}`,
      kind: 'ALERT' as const,
      title: n.title,
      subtitle: n.body,
      at: n.createdAt.toISOString(),
      route: n.route ?? ALERTS_ROUTE,
      documentId: n.documentId,
      companyId: n.companyId,
      branchId: n.branchId,
    }));
  }
}
