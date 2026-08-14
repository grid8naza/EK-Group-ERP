import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { countByCompany } from '../../common/by-company';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

const ALERTS_ROUTE = '/workplace/alerts';

/**
 * Alerts' contribution to the Workplace dashboard.
 *
 * The tile counts what is unread; the rows are the URGENT ones only. That is the
 * whole editorial judgement here: the dashboard is a page somebody looks at once
 * a morning, and repeating a bell they already have would fill it with stock
 * levels. What earns a place on it is the handful that say something is on fire.
 */
@Injectable()
export class NotificationSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'alerts';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const unread = await this.prisma.notification.findMany({
      where: { userId, readAt: null, resolvedAt: null, dismissedAt: null },
      select: { companyId: true, priority: true },
    });

    return [
      {
        key: 'alerts.unread',
        label: 'Alerts',
        count: unread.length,
        route: ALERTS_ROUTE,
        icon: 'bell',
        tone: unread.some((a) => a.priority === 'URGENT')
          ? 'urgent'
          : unread.length
            ? 'attention'
            : 'normal',
        order: 100,
        byCompany: countByCompany(unread),
      },
    ];
  }

  async waiting(userId: number, limit: number): Promise<WorkplaceItem[]> {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        priority: 'URGENT',
        resolvedAt: null,
        dismissedAt: null,
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
