import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChecklistTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ZonedParts,
  appTimeZone,
  dateMarker,
  formatMinutes,
  zonedParts,
  zonedToInstant,
} from '../../common/zoned-time';
import { TaskService } from './task.service';
import { SaveChecklistDto } from './checklist.dto';

const templateInclude = {
  items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  assignees: true,
} satisfies Prisma.ChecklistTemplateInclude;

type TemplateRow = Prisma.ChecklistTemplateGetPayload<{
  include: typeof templateInclude;
}>;

/** Last minute of a local day — where an unset "due by" lands. */
const END_OF_DAY = 24 * 60 - 1;

/**
 * Recurring checklists (SRS §8.12, FR-TSK-02: "opening/closing, hygiene,
 * production").
 *
 * A template here is not a running list; it is the thing that raises one. Every
 * occurrence becomes an ordinary Task with ordinary checklist items, which is
 * what makes the feature small: the board, the ticks that record who and when,
 * the comments, the assignment alert and the overdue sweep all already exist and
 * all work on it unchanged. See checklist_templates in task.prisma.
 *
 * The rules follow the task module's, because a checklist IS delegated work:
 *  - a template belongs to a company and a branch, stamped from the caller's
 *    active context and never taken from the request (FR-TSK-01);
 *  - whoever set it up owns what it says; it is visible to them and to the
 *    people it is for, and to nobody else;
 *  - its occurrences are visible by the same rule, since they are tasks.
 */
@Injectable()
export class ChecklistService {
  private readonly logger = new Logger(ChecklistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskService,
  ) {}

  // ----------------------------------------------------------------- lists --

  /**
   * The templates this person can see, in the company being worked in.
   *
   * A branch sees its own and the company-wide ones, exactly as its board does:
   * a checklist raised for the company is raised for every branch of it.
   */
  async list(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
  ) {
    if (!companyId) {
      throw new BadRequestException(
        'No active company — a checklist belongs to one.',
      );
    }
    const rows = await this.prisma.checklistTemplate.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        // Visible to the person who set it up and the people it is for.
        AND: [
          {
            OR: [{ createdById: userId }, { assignees: { some: { userId } } }],
          },
        ],
      },
      include: templateInclude,
      orderBy: [{ isActive: 'desc' }, { startMinutes: 'asc' }, { id: 'desc' }],
    });
    return Promise.all(rows.map((r) => this.view(r, userId)));
  }

  async get(userId: number, id: number) {
    return this.view(await this.assertVisible(userId, id), userId);
  }

  // ------------------------------------------------------------ writing it --

  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: SaveChecklistDto,
  ) {
    if (!companyId) {
      throw new BadRequestException(
        'No active company — a checklist belongs to one.',
      );
    }
    const { columns, itemTexts, assigneeIds } = await this.fields(
      userId,
      dto,
      true,
    );

    const created = await this.prisma.checklistTemplate.create({
      data: {
        ...columns,
        name: columns.name ?? '',
        companyId,
        // Company-wide is a choice; a branch is not — it is where the person
        // setting it up is working. Same rule as a task.
        branchId: dto.companyWide ? null : (branchId ?? null),
        createdById: userId,
        items: {
          create: (itemTexts ?? []).map((text, i) => ({
            text,
            sortOrder: i + 1,
          })),
        },
        assignees: {
          create: [...(assigneeIds ?? [])].map((uid) => ({ userId: uid })),
        },
      },
      include: templateInclude,
    });
    return this.view(created, userId);
  }

  async update(userId: number, id: number, dto: SaveChecklistDto) {
    const existing = await this.assertOwner(userId, id);
    const { columns, itemTexts, assigneeIds } = await this.fields(
      userId,
      dto,
      false,
    );

    await this.prisma.checklistTemplate.update({
      where: { id: existing.id },
      data: {
        ...columns,
        ...(dto.companyWide === true ? { branchId: null } : {}),
      },
    });

    // Items and assignees are replaced wholesale: the editor sends the list it
    // wants, and diffing a checklist of eight lines to save two writes would
    // only invent ways for the order to end up wrong.
    if (itemTexts) {
      await this.prisma.checklistTemplateItem.deleteMany({
        where: { templateId: existing.id },
      });
      await this.prisma.checklistTemplateItem.createMany({
        data: itemTexts.map((text, i) => ({
          templateId: existing.id,
          text,
          sortOrder: i + 1,
        })),
      });
    }
    if (assigneeIds) {
      await this.prisma.checklistTemplateAssignee.deleteMany({
        where: { templateId: existing.id },
      });
      await this.prisma.checklistTemplateAssignee.createMany({
        data: [...assigneeIds].map((uid) => ({
          templateId: existing.id,
          userId: uid,
        })),
        skipDuplicates: true,
      });
    }

    return this.get(userId, existing.id);
  }

  /**
   * Delete the schedule. The tasks it has raised SURVIVE (the relation nulls
   * rather than cascades): a completed hygiene check is a record, and deleting a
   * schedule must not delete the evidence that it was followed.
   */
  async remove(userId: number, id: number) {
    const existing = await this.assertOwner(userId, id);
    await this.prisma.checklistTemplate.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  /**
   * Raise this occurrence now, without waiting for the clock.
   *
   * For the checklist somebody sets up at nine for a run that starts at six
   * tomorrow, and for the day a supervisor wants it out early. Does nothing if
   * today's occurrence already exists — that is the same unique constraint the
   * scheduler leans on, and saying so is better than raising a second copy.
   */
  async raiseNow(userId: number, id: number) {
    const template = await this.assertVisible(userId, id);
    const local = zonedParts(new Date());
    const task = await this.raise(template as TemplateRow, local);
    if (!task) {
      return {
        raised: false,
        message: 'Today’s checklist has already been raised.',
      };
    }
    return { raised: true, taskId: task.id };
  }

  // -------------------------------------------------------------- the clock --

  /**
   * Raise every occurrence that is due and not yet raised. Called on a timer by
   * ChecklistSchedulerService.
   *
   * Reads the world as it is now rather than reacting to a moment, exactly like
   * the alert sweeps: a template is due today if it runs on today's local date
   * and today's local clock has passed its start time. So a pass that is missed,
   * repeated, or run after a restart still leaves the day with one occurrence —
   * the unique (templateId, occurrenceOn) is what guarantees the "one".
   *
   * It does NOT back-fill yesterday. A checklist is the work of its day; raising
   * Tuesday's opening checks on Wednesday afternoon would ask somebody to sign
   * for a shift that is over. What it will do is raise TODAY's late — if the
   * application was down all morning, the 6 a.m. checks still appear, already
   * overdue, which is the truth of the situation.
   */
  async runDue(now = new Date()): Promise<number> {
    const local = zonedParts(now);
    const templates = await this.prisma.checklistTemplate.findMany({
      where: { isActive: true },
      include: templateInclude,
    });

    let raised = 0;
    for (const template of templates) {
      if (!this.runsOn(template, local)) continue;
      if (local.minutes < template.startMinutes) continue;
      try {
        if (await this.raise(template, local)) raised += 1;
      } catch (e) {
        // One broken template must not stop the others: a branch's opening
        // checks cannot be lost because another company's are misconfigured.
        this.logger.error(
          `checklist "${template.name}" (#${template.id}) failed: ${String(e)}`,
        );
      }
    }
    return raised;
  }

  /** Does this template run on the given local date? */
  private runsOn(template: ChecklistTemplate, local: ZonedParts): boolean {
    if (template.frequency === 'DAILY') return true;
    if (template.frequency === 'WEEKLY') {
      return template.weekdays.includes(local.weekday);
    }
    // MONTHLY — clamped, so a template set to the 31st still happens in
    // February rather than skipping the month entirely.
    const wanted = template.dayOfMonth ?? 1;
    const last = lastDayOfMonth(local.date);
    return local.dayOfMonth === Math.min(wanted, last);
  }

  /**
   * Turn one occurrence into a task. Returns null when it already exists.
   *
   * The duplicate is caught from the database rather than checked for first: two
   * passes racing each other would both pass the check and both insert, and the
   * constraint is the only thing that cannot be raced.
   */
  private async raise(template: TemplateRow, local: ZonedParts) {
    const tz = appTimeZone();
    const dueAt = zonedToInstant(
      local.date,
      template.dueMinutes ?? END_OF_DAY,
      tz,
    );

    // New work goes to the top of the To do column, where it is seen.
    const highest = await this.prisma.task.findFirst({
      where: { companyId: template.companyId },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true },
    });

    let task;
    try {
      task = await this.prisma.task.create({
        data: {
          title: template.name,
          description: template.description,
          companyId: template.companyId,
          branchId: template.branchId,
          // The person who set the schedule up owns what it says, exactly as the
          // raiser of a hand-made task does — so they can chase it, and it shows
          // on their "given to others" board.
          createdById: template.createdById,
          priority: template.priority,
          dueAt,
          templateId: template.id,
          occurrenceOn: dateMarker(local.date),
          sortOrder: (highest?.sortOrder ?? 0) - 1,
          assignees: {
            create: template.assignees.map((a) => ({ userId: a.userId })),
          },
          checklist: {
            create: template.items.map((item, i) => ({
              // COPIED, not referenced: what a branch signed for last month must
              // keep the wording it was signed against.
              text: item.text,
              sortOrder: i + 1,
            })),
          },
        },
        include: { assignees: true },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return null; // already raised for this date
      }
      throw e;
    }

    // Nobody raised this, so nobody is excluded from being told about it.
    await this.tasks.alertAssigned(task, null);
    this.logger.log(
      `raised "${template.name}" for ${local.date} (task #${task.id})`,
    );
    return task;
  }

  // ---------------------------------------------------------------- guards --

  /** Normalize the writable fields, and validate the recurrence makes sense. */
  private async fields(userId: number, dto: SaveChecklistDto, isNew: boolean) {
    const name = dto.name?.trim();
    if (isNew && !name)
      throw new BadRequestException('Give the checklist a name.');

    const frequency = dto.frequency ?? 'DAILY';
    const weekdays = [...new Set(dto.weekdays ?? [])].sort();
    if (frequency === 'WEEKLY' && weekdays.length === 0) {
      throw new BadRequestException(
        'Choose at least one day of the week, or it would never run.',
      );
    }
    if (frequency === 'MONTHLY' && !dto.dayOfMonth) {
      throw new BadRequestException(
        'Choose which day of the month it runs on.',
      );
    }

    const startMinutes = dto.startMinutes ?? 360;
    const dueMinutes = dto.dueMinutes ?? null;
    if (dueMinutes !== null && dueMinutes < startMinutes) {
      throw new BadRequestException(
        `It cannot be due at ${formatMinutes(dueMinutes)} when it only appears at ${formatMinutes(startMinutes)}.`,
      );
    }

    const items = (dto.items ?? []).map((t) => t.trim()).filter(Boolean);
    if (isNew && items.length === 0) {
      throw new BadRequestException(
        'A checklist needs at least one thing to check.',
      );
    }

    // Only people this user could hand work to by name — the same rule the task
    // composer applies, asked through the same port.
    const assigneeIds = dto.assigneeIds
      ? await this.resolveAssignees(userId, dto.assigneeIds)
      : undefined;
    if (isNew && (!assigneeIds || assigneeIds.size === 0)) {
      throw new BadRequestException('Say who has to do it.');
    }

    return {
      // The template's own columns…
      columns: {
        ...(name ? { name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        frequency,
        weekdays: frequency === 'WEEKLY' ? weekdays : [],
        dayOfMonth: frequency === 'MONTHLY' ? (dto.dayOfMonth ?? 1) : null,
        startMinutes,
        dueMinutes,
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      // …and the two lists, which are rows of their own and are kept apart from
      // the columns so neither can be spread into a Prisma `data` by accident.
      // `undefined` means "not sent", which leaves what is stored alone.
      itemTexts: dto.items ? items : undefined,
      assigneeIds,
    };
  }

  /** Everybody this user may give work to (delegates to the task module's rule). */
  private async resolveAssignees(userId: number, ids: number[]) {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return new Set<number>();
    const allowed = new Set(
      (await this.tasks.directory(userId)).map((u) => u.id),
    );
    allowed.add(userId);
    for (const id of wanted) {
      if (!allowed.has(id)) {
        throw new BadRequestException(
          'One of those people cannot be given this checklist.',
        );
      }
    }
    return new Set(wanted);
  }

  /**
   * The template, if the caller set it up or is on it.
   *
   * 404 rather than 403, like a task: whether a checklist exists is itself
   * private, and "that one is not yours" says that somebody, somewhere, has one.
   */
  private async assertVisible(userId: number, id: number) {
    const row = await this.prisma.checklistTemplate.findUnique({
      where: { id },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('No such checklist.');
    const mine =
      row.createdById === userId ||
      row.assignees.some((a) => a.userId === userId);
    if (!mine) throw new NotFoundException('No such checklist.');
    return row;
  }

  /** Changing what it SAYS is the setter-up's, as with a task's raiser. */
  private async assertOwner(userId: number, id: number) {
    const row = await this.assertVisible(userId, id);
    if (row.createdById !== userId) {
      throw new ForbiddenException(
        'Only whoever set this checklist up can change it.',
      );
    }
    return row;
  }

  // ----------------------------------------------------------- view shapes --

  private async view(row: TemplateRow, userId: number) {
    const people = await this.tasks.namesOf([
      row.createdById,
      ...row.assignees.map((a) => a.userId),
    ]);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      companyId: row.companyId,
      branchId: row.branchId,
      frequency: row.frequency,
      weekdays: row.weekdays,
      dayOfMonth: row.dayOfMonth,
      startMinutes: row.startMinutes,
      startTime: formatMinutes(row.startMinutes),
      dueMinutes: row.dueMinutes,
      dueTime: row.dueMinutes === null ? null : formatMinutes(row.dueMinutes),
      priority: row.priority,
      isActive: row.isActive,
      isMine: row.createdById === userId,
      createdById: row.createdById,
      createdByName: people.get(row.createdById)?.name ?? null,
      items: row.items.map((i) => ({ id: i.id, text: i.text })),
      assignees: row.assignees.map((a) => ({
        id: a.userId,
        name: people.get(a.userId)?.name ?? `#${a.userId}`,
      })),
      /** The zone the times are read in, so the screen can say so. */
      timeZone: appTimeZone(),
    };
  }
}

/** 28, 29, 30 or 31, for the local month of `YYYY-MM-DD`. */
function lastDayOfMonth(date: string): number {
  const [year, month] = date.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
