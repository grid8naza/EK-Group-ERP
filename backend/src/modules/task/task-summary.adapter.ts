import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { countByCompany } from '../../common/by-company';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';
import { TASK_ROUTE_BY_ME, TASK_ROUTE_TO_ME } from './task.service';

/** Open means not finished and not called off. */
const OPEN = ['TODO', 'IN_PROGRESS', 'BLOCKED'] as const;

/**
 * The task module's contribution to the Workplace dashboard.
 *
 * This is the provider the dashboard exists for. A task board is scoped to a
 * company and a branch — correctly, since a branch works from the branch's
 * board — but a PERSON is not, and the board has always had to admit as much
 * with its "waiting in other companies" line. Here that limitation is simply
 * dropped: everything assigned to this person, wherever it is.
 *
 * Which is safe to do because a task's visibility rule is about people, not
 * companies: it is visible to whoever raised it and whoever it is for. So
 * listing one person's own tasks across the group reveals nothing that their
 * own boards would not, one company at a time.
 */
@Injectable()
export class TaskSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'tasks';

  constructor(private readonly prisma: PrismaService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const now = new Date();

    const [mine, raised] = await Promise.all([
      this.prisma.task.findMany({
        where: { status: { in: [...OPEN] }, assignees: { some: { userId } } },
        select: { companyId: true, dueAt: true },
      }),
      this.prisma.task.findMany({
        where: { status: { in: [...OPEN] }, createdById: userId },
        select: { companyId: true, dueAt: true },
      }),
    ]);

    const overdue = mine.filter((t) => t.dueAt && t.dueAt < now);

    return [
      {
        key: 'tasks.mine',
        label: 'My tasks',
        count: mine.length,
        route: TASK_ROUTE_TO_ME,
        icon: 'clipboard-check',
        tone: mine.length ? 'attention' : 'normal',
        order: 30,
        byCompany: countByCompany(mine),
      },
      {
        key: 'tasks.overdue',
        label: 'Overdue',
        count: overdue.length,
        route: TASK_ROUTE_TO_ME,
        icon: 'clock',
        // Late work is the one thing on this page that should look alarming.
        tone: overdue.length ? 'urgent' : 'normal',
        order: 40,
        byCompany: countByCompany(overdue),
      },
      {
        key: 'tasks.raised',
        label: 'Given to others',
        count: raised.length,
        route: TASK_ROUTE_BY_ME,
        icon: 'forward',
        order: 50,
        byCompany: countByCompany(raised),
      },
    ];
  }

  async waiting(userId: number, limit: number): Promise<WorkplaceItem[]> {
    const now = new Date();
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: [...OPEN] },
        assignees: { some: { userId } },
        // Only work with a DATE on it belongs on a list of what is waiting:
        // a task with no due date is not late and not urgent, it is just open,
        // and putting every one of those here would bury the ones that are.
        dueAt: { not: null },
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        priority: true,
        companyId: true,
        branchId: true,
        createdAt: true,
      },
    });

    return tasks.map((t) => ({
      key: `task:${t.id}`,
      kind: 'TASK' as const,
      title: t.title,
      subtitle:
        t.status === 'BLOCKED'
          ? 'Blocked'
          : t.priority === 'URGENT'
            ? 'Urgent'
            : null,
      at: t.createdAt.toISOString(),
      dueAt: t.dueAt?.toISOString() ?? null,
      overdue: !!t.dueAt && t.dueAt < now,
      route: TASK_ROUTE_TO_ME,
      documentId: t.id,
      companyId: t.companyId,
      branchId: t.branchId,
    }));
  }
}
