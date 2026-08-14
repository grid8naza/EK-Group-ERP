import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

const VIEW_ROUTE = '/workplace/circulars/view';

/**
 * Circulars' contribution to the Workplace dashboard: notices this person has
 * not yet acknowledged.
 *
 * Outstanding means UNACKNOWLEDGED, not unread — that distinction is the whole
 * point of a circular. Somebody who opened a notice and did not confirm it has
 * still not confirmed it, and the register the issuer reads says so. Counting
 * unread here would let the dashboard quietly disagree with the register.
 *
 * A circular carries no company of its own (it may be issued across several at
 * once), so there is no byCompany split to give.
 */
@Injectable()
export class CircularSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'circulars';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const count = await this.prisma.circularRecipient.count({
      where: { userId, acknowledgedAt: null, circular: { archivedAt: null } },
    });
    return [
      {
        key: 'circulars.unacknowledged',
        label: 'To acknowledge',
        count,
        route: VIEW_ROUTE,
        icon: 'book-open',
        tone: count ? 'attention' : 'normal',
        order: 70,
      },
    ];
  }

  async waiting(userId: number, limit: number): Promise<WorkplaceItem[]> {
    const rows = await this.prisma.circularRecipient.findMany({
      where: { userId, acknowledgedAt: null, circular: { archivedAt: null } },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        circularId: true,
        readAt: true,
        circular: {
          select: {
            reference: true,
            title: true,
            issuedAt: true,
            ackDueAt: true,
            companyId: true,
            branchId: true,
          },
        },
      },
    });

    const now = new Date();
    return rows.map((r) => ({
      key: `circular:${r.circularId}`,
      kind: 'CIRCULAR' as const,
      title: r.circular.title,
      // The reference is how a circular is quoted, so it belongs on the row;
      // whether it has been opened is what tells the reader how much is left to
      // do about it.
      subtitle: [r.circular.reference, r.readAt ? 'Read' : 'Not yet opened']
        .filter(Boolean)
        .join(' · '),
      at: r.circular.issuedAt.toISOString(),
      // A circular can carry a date by which it must be acknowledged, and that
      // is a due date in every sense the dashboard means.
      dueAt: r.circular.ackDueAt?.toISOString() ?? null,
      overdue: !!r.circular.ackDueAt && r.circular.ackDueAt < now,
      route: VIEW_ROUTE,
      documentId: r.circularId,
      companyId: r.circular.companyId,
      branchId: r.circular.branchId,
    }));
  }
}
