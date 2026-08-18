import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDayMonthYear } from '../../common/zoned-time';
import { AlertSourcePort } from '../../contracts/alert-source.port';
import {
  NOTIFICATION,
  NotificationPort,
} from '../../contracts/notification.port';
import {
  TASK_DUE_NAMESPACE,
  TASK_ROUTE_TO_ME,
  taskDuePrefix,
} from './task.service';

/** How far ahead "due soon" looks. A day: the shift you are about to work. */
const DUE_WINDOW_HOURS = 24;

/**
 * The Task module's alert source — work falling due, and work already late
 * (SRS §8.12, FR-TSK-03).
 *
 * Everything else about a task alerts when somebody DOES something. A due date
 * passing is the one thing nobody does: the task sits where it was, and at some
 * point it is late. So it is swept for, on the timer the notification module
 * owns. Registered in contracts/contracts.module.ts.
 *
 * The sweep describes the present rather than reacting to a moment, which is
 * what makes it safe to run at any interval, twice, or after a week down:
 *  - what is due or late now is published (the dedupe key stops repeats);
 *  - what no longer is — finished, re-dated, deleted — is resolved.
 *
 * Late outranks due: a task crossing its date moves from one key to the other,
 * and the same pass that raises the new alert drops the old one, so the bell
 * never carries "due tomorrow" for something that was due last week.
 *
 * Due alerts live in a key namespace of their OWN (`task-due:`), separate from
 * the assignment and comment alerts the service raises under `task:`. That is
 * what lets this sweep say "and nothing else under my prefix is still true"
 * without having to know, or read, what the service has published.
 */
@Injectable()
export class TaskAlertsAdapter implements AlertSourcePort {
  readonly key = 'task';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION) private readonly notifications: NotificationPort,
  ) {}

  async scan(): Promise<void> {
    const now = new Date();
    const soon = new Date(now.getTime() + DUE_WINDOW_HOURS * 3_600_000);

    const tasks = await this.prisma.task.findMany({
      where: {
        // CANCELLED and DONE are over; BLOCKED is not — a blocked task going
        // late is precisely what somebody needs telling about.
        status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] },
        dueAt: { not: null, lte: soon },
        assignees: { some: {} },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        companyId: true,
        branchId: true,
        createdById: true,
        assignees: { select: { userId: true } },
      },
    });

    const live: string[] = [];
    for (const task of tasks) {
      const late = !!task.dueAt && task.dueAt < now;
      const sourceKey = `${taskDuePrefix(task.id)}${late ? 'overdue' : 'due'}`;
      live.push(sourceKey);

      const on = task.dueAt ? formatDayMonthYear(task.dueAt) : '';
      await this.notifications.publish({
        // The raiser as well as the assignees: being answerable for work is
        // exactly being told when it is late.
        audience: {
          userIds: [
            ...new Set([
              ...task.assignees.map((a) => a.userId),
              task.createdById,
            ]),
          ],
        },
        category: 'TASK',
        priority: late ? 'URGENT' : 'IMPORTANT',
        title: late ? 'Task overdue' : 'Task due soon',
        body: late
          ? `"${task.title}" was due on ${on}.`
          : `"${task.title}" is due on ${on}.`,
        route: TASK_ROUTE_TO_ME,
        documentId: task.id,
        companyId: task.companyId,
        branchId: task.branchId,
        sourceKey,
      });
    }

    // Everything ever raised about a due date, minus what is still true — the
    // task that was finished, re-dated or deleted since the last sweep, without
    // this class having to remember any of them.
    await this.notifications.resolveMissing(TASK_DUE_NAMESPACE, live);
  }
}
