import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_LOOKUP,
  UserLookupPort,
  UserSummary,
} from '../../contracts/user-lookup.port';
import {
  ChecklistItemDto,
  CommentDto,
  CreateTaskDto,
  SetStatusDto,
  UpdateTaskDto,
} from './task.dto';

/** Which side of a task the caller is asking about. */
export type TaskScope = 'to-me' | 'by-me';

const taskInclude = {
  assignees: true,
  checklist: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  comments: { orderBy: { id: 'asc' } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/**
 * Task management (SRS §8.12) — work one person hands to another, with due
 * dates, a state, a checklist and the conversation about it.
 *
 * Three rules shape it:
 *
 *  1. **A task belongs to a company and a branch** (FR-TSK-01). Both are
 *     stamped from the caller's active context rather than accepted from the
 *     request: the board a branch works from is the branch's, and letting the
 *     client name the branch would let one branch fill another's board.
 *
 *  2. **Raising it and doing it are different rights.** Whoever raised a task
 *     owns what it says — the title, who it is for, the due date, whether it
 *     exists at all. Whoever it is for owns how it is going — the state, the
 *     checklist. Both may comment. This is the difference between delegating
 *     work and doing it, and collapsing the two would let an assignee quietly
 *     re-point their own task at somebody else.
 *
 *  3. **You see what you are part of.** A task is visible to the person who
 *     raised it and the people it is for. Not to their manager, not to an admin
 *     of the company — same rule as mail, chat and the approvals inbox.
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  // ---------------------------------------------------------------- people --

  /** Everybody this user can give work to. */
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

  // ----------------------------------------------------------------- lists --

  /**
   * One board's worth of tasks: everything on this side of the work, in the
   * company being worked in.
   *
   * A branch, when one is active, sees its own tasks AND the company-wide ones
   * — a task raised "for the company" is for every branch of it, and hiding it
   * from all of them would mean nobody ever saw it.
   */
  async list(
    userId: number,
    scope: TaskScope,
    companyId: number | undefined,
    branchId: number | undefined,
    opts: { q?: string; includeClosed?: boolean } = {},
  ) {
    if (!companyId) {
      throw new BadRequestException(
        'No active company — a task board belongs to a company.',
      );
    }
    const needle = opts.q?.trim();

    const rows = await this.prisma.task.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        ...this.sideOf(userId, scope),
        // Done stays — it is a column of the board, and work finished this
        // morning is what a stand-up talks about. Called-off work does not: it
        // is not a state anybody is working through, so it is out of the way
        // until somebody asks for it.
        ...(opts.includeClosed
          ? {}
          : { status: { not: TaskStatus.CANCELLED } }),
        ...(needle
          ? {
              OR: [
                { title: { contains: needle, mode: 'insensitive' } },
                { description: { contains: needle, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: taskInclude,
      orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    });

    return this.viewMany(rows, userId);
  }

  /**
   * How much of this person's work sits in companies they are not looking at.
   *
   * The board is company-scoped by requirement, which is right for a branch
   * board and wrong for a person: somebody who works across two companies would
   * otherwise have no way of knowing that anything was waiting in the other. A
   * count, per company, is enough to send them there without unscoping the board.
   */
  async elsewhere(
    userId: number,
    scope: TaskScope,
    companyId: number | undefined,
  ) {
    const rows = await this.prisma.task.groupBy({
      by: ['companyId'],
      where: {
        ...this.sideOf(userId, scope),
        status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
        ...(companyId ? { companyId: { not: companyId } } : {}),
      },
      _count: { _all: true },
    });
    if (rows.length === 0) return [];

    const companies = await this.prisma.company.findMany({
      where: { id: { in: rows.map((r) => r.companyId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(companies.map((c) => [c.id, c.name]));
    return rows
      .map((r) => ({
        companyId: r.companyId,
        companyName: nameById.get(r.companyId) ?? `Company #${r.companyId}`,
        count: r._count._all,
      }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }

  /** One task, if the caller is part of it. */
  async get(userId: number, id: number) {
    const task = await this.assertVisible(userId, id);
    return this.view(task, userId);
  }

  // -------------------------------------------------------------- writing --

  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: CreateTaskDto,
  ) {
    if (!companyId) {
      throw new BadRequestException(
        'No active company — a task has to belong to one.',
      );
    }
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Give the task a title.');

    const assignees = await this.resolveAssignees(userId, dto.assigneeIds ?? []);
    const checklist = (dto.checklist ?? [])
      .map((t) => t.trim())
      .filter(Boolean);

    // New work goes to the TOP of the To do column, where it is seen: one below
    // whatever is currently highest in this company's board.
    const highest = await this.prisma.task.findFirst({
      where: { companyId },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true },
    });

    const created = await this.prisma.task.create({
      data: {
        title,
        description: dto.description?.trim() || null,
        companyId,
        // Company-wide is a choice; a branch is not — it is where the person
        // raising it is working.
        branchId: dto.companyWide ? null : (branchId ?? null),
        createdById: userId,
        priority: dto.priority ?? 'NORMAL',
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        sortOrder: (highest?.sortOrder ?? 0) - 1,
        assignees: assignees.size
          ? { create: [...assignees].map((id) => ({ userId: id })) }
          : undefined,
        checklist: checklist.length
          ? {
              create: checklist.map((text, i) => ({ text, sortOrder: i + 1 })),
            }
          : undefined,
      },
      include: taskInclude,
    });
    return this.view(created, userId);
  }

  /** What the task SAYS — the raiser's to change. */
  async update(userId: number, id: number, dto: UpdateTaskDto) {
    const task = await this.assertCreator(userId, id);

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Give the task a title.');
      data.title = title;
    }
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.dueAt !== undefined) {
      data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    }
    if (dto.companyWide !== undefined) {
      // Narrowing back to a branch would need to know WHICH branch; the raiser
      // can only widen it here, and re-raise it otherwise.
      if (dto.companyWide) data.branchId = null;
    }

    await this.prisma.task.update({ where: { id: task.id }, data });

    if (dto.assigneeIds !== undefined) {
      const wanted = await this.resolveAssignees(userId, dto.assigneeIds);
      await this.prisma.taskAssignee.deleteMany({
        where: { taskId: task.id, userId: { notIn: [...wanted] } },
      });
      await this.prisma.taskAssignee.createMany({
        data: [...wanted].map((uid) => ({ taskId: task.id, userId: uid })),
        skipDuplicates: true,
      });
    }

    return this.get(userId, task.id);
  }

  /**
   * How it is GOING — the assignee's to change, and the raiser's too (they may
   * call their own work off, or accept it as done).
   */
  async setStatus(userId: number, id: number, dto: SetStatusDto) {
    const task = await this.assertVisible(userId, id);
    const closing = dto.status === 'DONE';

    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: dto.status,
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        // Kept as the record of who finished it and when — and cleared when a
        // task is re-opened, so a re-opened task never claims it was completed.
        completedAt: closing ? new Date() : null,
        completedById: closing ? userId : null,
      },
    });
    return this.get(userId, task.id);
  }

  async remove(userId: number, id: number) {
    const task = await this.assertCreator(userId, id);
    await this.prisma.task.delete({ where: { id: task.id } });
    return { ok: true };
  }

  // ------------------------------------------------------------- checklist --

  async addChecklistItem(userId: number, id: number, dto: ChecklistItemDto) {
    const task = await this.assertVisible(userId, id);
    const last = await this.prisma.taskChecklistItem.findFirst({
      where: { taskId: task.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    await this.prisma.taskChecklistItem.create({
      data: {
        taskId: task.id,
        text: dto.text.trim(),
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return this.get(userId, task.id);
  }

  /** Tick or untick a line, recording who did it (§8.13 hygiene checks). */
  async toggleChecklistItem(
    userId: number,
    id: number,
    itemId: number,
    isDone: boolean,
  ) {
    const task = await this.assertVisible(userId, id);
    const item = await this.prisma.taskChecklistItem.findFirst({
      where: { id: itemId, taskId: task.id },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('No such checklist item.');

    await this.prisma.taskChecklistItem.update({
      where: { id: item.id },
      data: {
        isDone,
        doneById: isDone ? userId : null,
        doneAt: isDone ? new Date() : null,
      },
    });
    return this.get(userId, task.id);
  }

  async removeChecklistItem(userId: number, id: number, itemId: number) {
    const task = await this.assertCreator(userId, id);
    await this.prisma.taskChecklistItem.deleteMany({
      where: { id: itemId, taskId: task.id },
    });
    return this.get(userId, task.id);
  }

  // -------------------------------------------------------------- comments --

  async comment(userId: number, id: number, dto: CommentDto) {
    const task = await this.assertVisible(userId, id);
    await this.prisma.taskComment.create({
      data: { taskId: task.id, userId, body: dto.body.trim() },
    });
    return this.get(userId, task.id);
  }

  // ---------------------------------------------------------------- guards --

  /** The where-clause for one side of the work. */
  private sideOf(userId: number, scope: TaskScope): Prisma.TaskWhereInput {
    return scope === 'by-me'
      ? { createdById: userId }
      : { assignees: { some: { userId } } };
  }

  /**
   * The task, if the caller raised it or it is for them.
   *
   * 404 rather than 403: whether a task exists is itself private, and answering
   * "that one is not yours" would say that somebody, somewhere, has one.
   */
  private async assertVisible(userId: number, id: number): Promise<TaskRow> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('No such task.');
    const mine =
      task.createdById === userId ||
      task.assignees.some((a) => a.userId === userId);
    if (!mine) throw new NotFoundException('No such task.');
    return task;
  }

  private async assertCreator(userId: number, id: number): Promise<TaskRow> {
    const task = await this.assertVisible(userId, id);
    if (task.createdById !== userId) {
      throw new ForbiddenException(
        'Only the person who raised this task can change what it says.',
      );
    }
    return task;
  }

  /**
   * The people a task may be given to. Resolved through the port, so "who can I
   * hand work to" is the same question the rest of the app answers, and never a
   * raw id from the request. Assigning yourself is allowed — plenty of tasks are
   * raised by the person who will do them.
   */
  private async resolveAssignees(
    userId: number,
    ids: number[],
  ): Promise<Set<number>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Set();
    const peers = await this.users.findPeers(userId);
    const allowed = new Set(peers.map((p) => p.id));
    allowed.add(userId);
    for (const id of wanted) {
      if (!allowed.has(id)) {
        throw new BadRequestException(
          'One of those people cannot be given this task.',
        );
      }
    }
    return new Set(wanted);
  }

  // ----------------------------------------------------------- view shapes --

  private async viewMany(rows: TaskRow[], userId: number) {
    const names = await this.namesFor(
      rows.flatMap((t) => [
        t.createdById,
        ...t.assignees.map((a) => a.userId),
        ...t.comments.map((c) => c.userId),
        ...t.checklist.map((c) => c.doneById ?? 0),
      ]),
    );
    return rows.map((t) => this.shape(t, userId, names));
  }

  private async view(task: TaskRow, userId: number) {
    const names = await this.namesFor([
      task.createdById,
      ...task.assignees.map((a) => a.userId),
      ...task.comments.map((c) => c.userId),
      ...task.checklist.map((c) => c.doneById ?? 0),
    ]);
    return this.shape(task, userId, names);
  }

  private shape(
    task: TaskRow,
    userId: number,
    names: Map<number, UserSummary>,
  ) {
    const nameOf = (id: number) => names.get(id)?.name ?? `User #${id}`;
    const done = task.checklist.filter((c) => c.isDone).length;
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      companyId: task.companyId,
      branchId: task.branchId,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      /**
       * Past its due date and not finished. Worked out here so every screen
       * agrees on what late means — and false once it is done, because a task
       * finished late is finished, not still late.
       */
      isOverdue:
        task.dueAt != null &&
        task.status !== 'DONE' &&
        task.status !== 'CANCELLED' &&
        task.dueAt.getTime() < Date.now(),
      createdById: task.createdById,
      createdByName: nameOf(task.createdById),
      isMine: task.createdById === userId,
      isForMe: task.assignees.some((a) => a.userId === userId),
      assignees: task.assignees.map((a) => ({
        id: a.userId,
        name: nameOf(a.userId),
      })),
      checklist: task.checklist.map((c) => ({
        id: c.id,
        text: c.text,
        isDone: c.isDone,
        doneByName: c.doneById ? nameOf(c.doneById) : null,
        doneAt: c.doneAt?.toISOString() ?? null,
      })),
      checklistDone: done,
      checklistTotal: task.checklist.length,
      comments: task.comments.map((c) => ({
        id: c.id,
        userId: c.userId,
        userName: nameOf(c.userId),
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
      commentCount: task.comments.length,
      completedAt: task.completedAt?.toISOString() ?? null,
      completedByName: task.completedById ? nameOf(task.completedById) : null,
      sortOrder: task.sortOrder,
      createdAt: task.createdAt.toISOString(),
    };
  }

  private async namesFor(ids: number[]): Promise<Map<number, UserSummary>> {
    const wanted = [...new Set(ids.filter((id) => id > 0))];
    const found = await this.users.findByIds(wanted);
    return new Map(found.map((u) => [u.id, u]));
  }
}
