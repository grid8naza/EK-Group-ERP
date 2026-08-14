import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { countByCompany } from '../../common/by-company';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

const INBOX_ROUTE = '/workplace/mail/inbox';
const DRAFTS_ROUTE = '/workplace/mail/drafts';

/**
 * Mail's contribution to the Workplace dashboard: what is unread, and what was
 * started and never sent.
 *
 * "Unread" is a fact about the RECIPIENT ROW, not the mail — one reader deleting
 * their copy or marking it read says nothing about anyone else's. That rule is
 * why this lives in the mail module rather than in the dashboard.
 *
 * The company stamped on a mail is where it was WRITTEN, not a filter; mail has
 * never been scoped to the active company and is not scoped here either. It is
 * carried only so the dashboard can say where something came from.
 */
@Injectable()
export class MailSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'mail';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const [unread, drafts] = await Promise.all([
      this.prisma.mailRecipient.findMany({
        where: { userId, readAt: null, deletedAt: null },
        select: { mail: { select: { companyId: true } } },
      }),
      this.prisma.mailDraft.count({ where: { authorId: userId } }),
    ]);

    return [
      {
        key: 'mail.unread',
        label: 'Unread mail',
        count: unread.length,
        route: INBOX_ROUTE,
        icon: 'inbox',
        tone: unread.length ? 'attention' : 'normal',
        order: 60,
        byCompany: countByCompany(unread.map((r) => r.mail)),
      },
      {
        key: 'mail.drafts',
        label: 'Drafts',
        count: drafts,
        route: DRAFTS_ROUTE,
        icon: 'file-minus',
        order: 110,
      },
    ];
  }

  async waiting(userId: number, limit: number): Promise<WorkplaceItem[]> {
    const rows = await this.prisma.mailRecipient.findMany({
      where: { userId, readAt: null, deletedAt: null },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        mailId: true,
        mail: {
          select: {
            subject: true,
            senderId: true,
            sentAt: true,
            companyId: true,
            branchId: true,
          },
        },
      },
    });
    if (!rows.length) return [];

    // Who wrote it. Read through Prisma against this module's own snapshot of
    // nothing — mail stores only a senderId — so the name comes from the user
    // table by id, the one cross-domain read every list in this module makes.
    const senders = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.mail.senderId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(senders.map((s) => [s.id, s.name]));

    return rows.map((r) => ({
      key: `mail:${r.mailId}`,
      kind: 'MAIL' as const,
      title: r.mail.subject || '(no subject)',
      subtitle: nameOf.get(r.mail.senderId) ?? null,
      at: (r.mail.sentAt ?? new Date()).toISOString(),
      route: INBOX_ROUTE,
      documentId: r.mailId,
      companyId: r.mail.companyId,
      branchId: r.mail.branchId,
    }));
  }
}
