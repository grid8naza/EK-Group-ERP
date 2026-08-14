import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChecklistTemplate, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ZonedParts,
  addDays,
  appTimeZone,
  calendarParts,
  dateMarker,
  formatMinutes,
  zonedParts,
  zonedToInstant,
} from '../../common/zoned-time';
import { USER_LOOKUP, UserLookupPort } from '../../contracts/user-lookup.port';
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

/** What became of today's occurrence, for the card that asks. */
interface TodayOccurrence {
  taskId: number;
  status: TaskStatus;
  done: number;
  total: number;
  completedByName: string | null;
}

/** A company or branch, as the audience options give them. */
interface NamedRow {
  id: number;
  name: string;
}

/**
 * The module a checklist's work lands in. Code stays `WORKFLOW` while the label
 * is Workplace — see module-scaffold.ts for why renaming it would strand every
 * configured workflow.
 *
 * Used to answer "who could actually do this": an occurrence is a task on the
 * Workplace boards, so somebody who cannot reach Workplace in that company
 * cannot be given one.
 */
const WORKPLACE = 'WORKFLOW';

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
    // For the company and branch NAMES each card carries, now that the list
    // crosses both. Same answer the audience pickers and the dashboard use —
    // "which companies are mine" is the user module's fact.
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  // ----------------------------------------------------------------- lists --

  /**
   * Every schedule this person set up or is on — across every company and
   * branch, NOT only the one they happen to be working in.
   *
   * This list is not a board. A board is company-and-branch scoped because a
   * branch works from its own (FR-TSK-01), but a SCHEDULE is a standing
   * arrangement its owner has to be able to find, and a supervisor who sets up
   * the opening checks for three branches must see three cards rather than
   * whichever one matches the company picker today. Losing sight of a schedule
   * that is still raising work every morning is the worst failure this screen
   * has, so each card carries its company and branch instead.
   *
   * What it does NOT unscope is the work: each occurrence is still stamped with
   * the template's company and branch, and still appears only on that branch's
   * board.
   */
  async list(userId: number) {
    const rows = await this.prisma.checklistTemplate.findMany({
      where: {
        // Visible to the person who set it up and the people it is for.
        OR: [{ createdById: userId }, { assignees: { some: { userId } } }],
      },
      include: templateInclude,
      orderBy: [{ isActive: 'desc' }, { startMinutes: 'asc' }, { id: 'desc' }],
    });
    // One query for every card's "what happened to today's", rather than one per
    // card. Same for the company and branch labels the cards now need.
    const [raised, scope] = await Promise.all([
      this.raisedToday(rows.map((r) => r.id)),
      this.users.audienceOptions(userId),
    ]);
    return Promise.all(
      rows.map((r) => this.view(r, userId, raised.get(r.id) ?? null, scope)),
    );
  }

  async get(userId: number, id: number) {
    return this.view(await this.assertVisible(userId, id), userId);
  }

  // ------------------------------------------------------------ writing it --

  async create(
    userId: number,
    activeCompanyId: number | undefined,
    activeBranchId: number | undefined,
    dto: SaveChecklistDto,
  ) {
    const where = await this.placeOf(userId, dto, {
      companyId: activeCompanyId,
      branchId: activeBranchId,
    });
    const { columns, itemTexts, assigneeIds } = await this.fields(
      userId,
      dto,
      where.companyId,
      where.branchId,
    );

    const created = await this.prisma.checklistTemplate.create({
      data: {
        ...columns,
        // Both are always present on a create — `fields` defaults the start to
        // today — but the spread's type cannot know that.
        name: columns.name ?? '',
        startsOn: columns.startsOn ?? dateMarker(zonedParts(new Date()).date),
        companyId: where.companyId,
        branchId: where.branchId,
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

    // WHERE it lands is settled first, because who may be given it depends on
    // the company — moving a checklist to another company and naming somebody
    // who does not work there has to fail on the people, not silently succeed.
    // Moving it at all is allowed: one set up against the wrong branch should be
    // correctable without being rebuilt from scratch.
    const moved =
      dto.companyId !== undefined || dto.branchId !== undefined
        ? await this.placeOf(userId, dto, {
            companyId: existing.companyId,
            branchId: existing.branchId ?? undefined,
          })
        : null;

    // The existing row goes in, so anything the request leaves out keeps the
    // value it already has rather than falling back to a default.
    const { columns, itemTexts, assigneeIds } = await this.fields(
      userId,
      dto,
      moved?.companyId ?? existing.companyId,
      moved ? moved.branchId : existing.branchId,
      existing,
    );

    // Moving it re-checks the people ALREADY on it against where it is going.
    // Without this, a company-wide checklist could be pointed at one branch
    // while carrying somebody who works at another — the place changed, so the
    // question "may these people be given this" has to be asked again. Only
    // needed when the request did not supply its own list, which `fields` has
    // already validated against the new place.
    if (moved && !assigneeIds) {
      await this.resolveAssignees(
        userId,
        existing.assignees.map((a) => a.userId),
        moved.companyId,
        moved.branchId,
      );
    }

    await this.prisma.checklistTemplate.update({
      where: { id: existing.id },
      data: { ...columns, ...(moved ?? {}) },
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

  // ---------------------------------------------------------- the register --

  /**
   * The register: one row per day this checklist was expected, and what became
   * of it.
   *
   * This is the screen an auditor asks for, and the reason it cannot be the task
   * board: a board shows what EXISTS, and the most important row in a hygiene
   * record is the day nothing exists for. A missed Tuesday leaves no task
   * behind, so it can only be found by walking the calendar and asking "should
   * there have been one?".
   *
   * Which dates are expected comes from the schedule as it stands TODAY — the
   * only version there is; a template does not keep its history of edits. Dates
   * that HAVE an occurrence are always included even when the current schedule
   * would not expect them, so re-pointing a weekly from Monday to Thursday, or a
   * one-off "raise now", never drops a signed record out of the register.
   */
  async history(userId: number, id: number, days: number) {
    const template = await this.assertVisible(userId, id);
    const local = zonedParts(new Date());
    const span = Math.min(Math.max(days || 30, 1), 366);
    const now = new Date();

    // The window never reaches back past the day the checklist STARTS, nor
    // forward past the day it ends. Outside its own working life it was never
    // expected and nobody failed to do it — a register that opened with a
    // fortnight of "missed" on a schedule that began this morning would be
    // accusing people of days that did not exist.
    const startsOn = dateOnly(template.startsOn);
    const endsOn = template.endsOn ? dateOnly(template.endsOn) : null;
    const wanted = addDays(local.date, -(span - 1));
    const from = wanted < startsOn ? startsOn : wanted;
    const to = endsOn && endsOn < local.date ? endsOn : local.date;
    // How many days that actually leaves. Negative when the range has not begun.
    const covered = Math.max(
      0,
      Math.round(
        (dateMarker(to).getTime() - dateMarker(from).getTime()) / 86_400_000,
      ) + 1,
    );

    const tasks = await this.prisma.task.findMany({
      where: {
        templateId: template.id,
        occurrenceOn: {
          gte: dateMarker(from),
          lte: dateMarker(to),
        },
      },
      include: { checklist: { select: { isDone: true } } },
    });
    const byDate = new Map(
      tasks.map((t) => [t.occurrenceOn!.toISOString().slice(0, 10), t]),
    );
    const names = await this.tasks.namesOf(
      tasks.map((t) => t.completedById ?? 0),
    );

    const rows: {
      date: string;
      status:
        'COMPLETED' | 'OPEN' | 'OVERDUE' | 'CANCELLED' | 'MISSED' | 'SCHEDULED';
      taskId: number | null;
      done: number;
      total: number;
      completedAt: string | null;
      completedByName: string | null;
      /** Finished, but after the time it was due. */
      late: boolean;
    }[] = [];

    for (let back = 0; back < covered; back += 1) {
      const date = addDays(to, -back);
      const task = byDate.get(date);
      // Expected by the schedule, or actually raised — either earns a row.
      if (!task && !this.runsOn(template, calendarParts(date))) continue;

      const done = task?.checklist.filter((c) => c.isDone).length ?? 0;
      const total = task?.checklist.length ?? template.items.length;

      let status: (typeof rows)[number]['status'];
      let late = false;
      if (!task) {
        // TODAY is never a miss, whatever the clock says. The day is not over,
        // and a sweep runs every few minutes — reading "missed" in the gap
        // between a start time passing and the occurrence appearing would be the
        // register accusing somebody of a day still in progress. Only a past day
        // with nothing raised against it is a miss.
        status = date === local.date && back === 0 ? 'SCHEDULED' : 'MISSED';
      } else if (task.status === 'CANCELLED') {
        status = 'CANCELLED';
      } else if (task.status === 'DONE') {
        status = 'COMPLETED';
        late = !!(
          task.completedAt &&
          task.dueAt &&
          task.completedAt > task.dueAt
        );
      } else {
        status = task.dueAt && task.dueAt < now ? 'OVERDUE' : 'OPEN';
      }

      rows.push({
        date,
        status,
        taskId: task?.id ?? null,
        done,
        total,
        completedAt: task?.completedAt?.toISOString() ?? null,
        completedByName: task?.completedById
          ? (names.get(task.completedById)?.name ?? null)
          : null,
        late,
      });
    }

    // A day that has not come yet is not part of the record, so it is counted
    // in neither the numerator nor the denominator — a checklist looked at
    // before 8 a.m. must not read as 0% for the day.
    const counted = rows.filter((r) => r.status !== 'SCHEDULED');
    const completed = counted.filter((r) => r.status === 'COMPLETED');

    return {
      days: covered,
      requested: span,
      from,
      to,
      rows,
      summary: {
        expected: counted.length,
        completed: completed.length,
        onTime: completed.filter((r) => !r.late).length,
        late: completed.filter((r) => r.late).length,
        missed: counted.filter((r) => r.status === 'MISSED').length,
        outstanding: counted.filter(
          (r) => r.status === 'OPEN' || r.status === 'OVERDUE',
        ).length,
        /** Whole percent, and 100 when nothing was expected yet. */
        rate: counted.length
          ? Math.round((completed.length / counted.length) * 100)
          : 100,
      },
    };
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
    // Outside its own working life it does not run at all, whatever the
    // frequency says. Compared as `YYYY-MM-DD` strings, which sort correctly and
    // sidestep the question of what hour a stored date "is".
    if (local.date < dateOnly(template.startsOn)) return false;
    if (template.endsOn && local.date > dateOnly(template.endsOn)) return false;

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

  /**
   * The companies and branches this person may set a checklist up for.
   *
   * The same answer the audience pickers and the dashboard use — "which
   * companies are mine" is the user module's fact, and asking it through the
   * port keeps this module from reading Cpanel tables.
   */
  scope(userId: number) {
    return this.users.audienceOptions(userId);
  }

  /**
   * WHERE a checklist applies, from the form if it says and from the active
   * context if it does not.
   *
   * Checked against what this person may actually reach, because the company no
   * longer comes from a header the application controls: a body naming somebody
   * else's company would otherwise plant a schedule in it. A branch must belong
   * to the company it is named with — the two arrive separately, and a stale
   * picker is the ordinary way they stop matching.
   */
  private async placeOf(
    userId: number,
    dto: SaveChecklistDto,
    fallback: { companyId?: number; branchId?: number },
  ): Promise<{ companyId: number; branchId: number | null }> {
    const companyId = dto.companyId ?? fallback.companyId;
    if (!companyId) {
      throw new BadRequestException(
        'Choose the company this checklist is for.',
      );
    }

    const scope = await this.users.audienceOptions(userId);
    if (!scope.companies.some((c) => c.id === companyId)) {
      throw new BadRequestException('You cannot set one up for that company.');
    }

    // Naming a company but no branch means the whole of it. Only when neither is
    // named does the active branch stand in — carrying it across to a DIFFERENT
    // company would attach a branch that does not belong to it.
    const branchId =
      dto.branchId !== undefined
        ? dto.branchId
        : dto.companyId !== undefined
          ? null
          : (fallback.branchId ?? null);

    if (branchId !== null) {
      const branch = scope.branches.find((b) => b.id === branchId);
      if (!branch || branch.companyId !== companyId) {
        throw new BadRequestException(
          'That branch does not belong to that company.',
        );
      }
    }

    return { companyId, branchId };
  }

  /**
   * Work out what the template should look like AFTER this request, and check
   * that it makes sense.
   *
   * Every value falls back to what is already STORED, not to a default. That
   * distinction is the whole method: a partial update is the normal case — Pause
   * sends `{ isActive: false }` and nothing else — and defaulting the rest would
   * quietly rewrite the schedule. It did exactly that until somebody asked what
   * the Pause button was for: pausing an 08:00 checklist moved it to 06:00, and
   * pausing a Monday one would have made it daily.
   *
   * The merged values are then validated together, because the rules span
   * fields: changing only the frequency to WEEKLY has to be checked against the
   * weekdays already stored.
   */
  private async fields(
    userId: number,
    dto: SaveChecklistDto,
    /** Where it will belong — who may be given it depends on BOTH. */
    companyId: number,
    branchId: number | null,
    /** The row being changed, or undefined when creating one. */
    existing?: TemplateRow,
  ) {
    const isNew = !existing;
    const name = dto.name?.trim() || existing?.name;
    if (!name) throw new BadRequestException('Give the checklist a name.');

    const frequency = dto.frequency ?? existing?.frequency ?? 'DAILY';
    const weekdays = [
      ...new Set(dto.weekdays ?? existing?.weekdays ?? []),
    ].sort();
    const dayOfMonth = dto.dayOfMonth ?? existing?.dayOfMonth ?? null;
    if (frequency === 'WEEKLY' && weekdays.length === 0) {
      throw new BadRequestException(
        'Choose at least one day of the week, or it would never run.',
      );
    }
    if (frequency === 'MONTHLY' && !dayOfMonth) {
      throw new BadRequestException(
        'Choose which day of the month it runs on.',
      );
    }

    const startMinutes = dto.startMinutes ?? existing?.startMinutes ?? 360;
    // `undefined` is "not sent" and `null` is "clear it" — two different things,
    // so this cannot use `??`.
    const dueMinutes =
      dto.dueMinutes !== undefined
        ? dto.dueMinutes
        : (existing?.dueMinutes ?? null);
    if (dueMinutes !== null && dueMinutes < startMinutes) {
      throw new BadRequestException(
        `It cannot be due at ${formatMinutes(dueMinutes)} when it only appears at ${formatMinutes(startMinutes)}.`,
      );
    }

    // Its working life. Dates arrive as `YYYY-MM-DD` and are kept that way for
    // the comparison — a calendar date has no hour, and giving it one is how a
    // range starts behaving differently either side of midnight.
    const startsOn = (
      dto.startsOn ??
      (existing ? dateOnly(existing.startsOn) : zonedParts(new Date()).date)
    ).slice(0, 10);
    const endsOnRaw =
      dto.endsOn !== undefined
        ? dto.endsOn
        : existing?.endsOn
          ? dateOnly(existing.endsOn)
          : null;
    const endsOn = endsOnRaw ? endsOnRaw.slice(0, 10) : null;
    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException(
        'It cannot end before it starts. Leave the end date empty for no end.',
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
      ? await this.resolveAssignees(
          userId,
          dto.assigneeIds,
          companyId,
          branchId,
        )
      : undefined;
    if (isNew && (!assigneeIds || assigneeIds.size === 0)) {
      throw new BadRequestException('Say who has to do it.');
    }

    return {
      // The template's own columns, as they should stand afterwards. Written
      // whole rather than as a diff: every one of them has been merged with what
      // is stored above, so writing them all is the same as writing the changes.
      columns: {
        name,
        description:
          dto.description !== undefined
            ? dto.description.trim() || null
            : (existing?.description ?? null),
        frequency,
        weekdays: frequency === 'WEEKLY' ? weekdays : [],
        dayOfMonth: frequency === 'MONTHLY' ? (dayOfMonth ?? 1) : null,
        startMinutes,
        dueMinutes,
        priority: dto.priority ?? existing?.priority ?? 'NORMAL',
        isActive: dto.isActive ?? existing?.isActive ?? true,
        // A new one starts today unless told otherwise — somebody setting up
        // opening checks means them to start now, and asking for a date they
        // have to compute is a field they will get wrong.
        startsOn: dateMarker(startsOn),
        endsOn: endsOn ? dateMarker(endsOn) : null,
      },
      // …and the two lists, which are rows of their own and are kept apart from
      // the columns so neither can be spread into a Prisma `data` by accident.
      // `undefined` means "not sent", which leaves what is stored alone.
      itemTexts: dto.items ? items : undefined,
      assigneeIds,
    };
  }

  /**
   * Everybody who could actually be given this checklist, at the company it is
   * for.
   *
   * TWO conditions, and both matter. They must be somebody this person could
   * hand work to by name (`findPeers`, the task module's rule — you cannot
   * assign to a stranger), AND they must be able to reach Workplace in THAT
   * company: an occurrence is a task on that company's board, so a schedule
   * pointed at Regency cannot be given to somebody who has no Regency.
   *
   * Asked of USER_LOOKUP because both are the user module's facts — the same
   * `usersWithModuleAccess` the stock alerts use to decide who hears about a
   * shortage.
   */
  async directory(
    userId: number,
    companyId: number,
    branchId?: number | null,
    q?: string,
  ) {
    const [peers, reachable, atBranch] = await Promise.all([
      this.tasks.directory(userId, q),
      this.users.usersWithModuleAccess(companyId, WORKPLACE),
      // A checklist for the whole company is offered to the whole company; one
      // for Kadathy is offered to the people who are at Kadathy.
      branchId
        ? this.users.usersAtBranch(companyId, branchId)
        : Promise.resolve(null),
    ]);

    const allowed = new Set(reachable);
    const here = atBranch ? new Set(atBranch) : null;
    return peers.filter((p) => allowed.has(p.id) && (!here || here.has(p.id)));
  }

  /** The same rule, enforced on save — a picker is not a permission. */
  private async resolveAssignees(
    userId: number,
    ids: number[],
    companyId: number,
    branchId: number | null,
  ) {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return new Set<number>();

    const allowed = new Set(
      (await this.directory(userId, companyId, branchId)).map((u) => u.id),
    );
    // Yourself, if you work there — setting up a checklist you also do is
    // ordinary. Checked against the same place, so somebody cannot put their own
    // name on a branch they do not work at.
    const mineToo = branchId
      ? await this.users.usersAtBranch(companyId, branchId)
      : await this.users.usersWithModuleAccess(companyId, WORKPLACE);
    if (mineToo.includes(userId)) allowed.add(userId);

    for (const id of wanted) {
      if (!allowed.has(id)) {
        throw new BadRequestException(
          branchId
            ? 'Somebody on this checklist does not work at that branch.'
            : 'Somebody on this checklist does not work at that company.',
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

  // -------------------------------------------------------- what happens next --

  /**
   * Today's occurrence for each of these templates, where it has been raised.
   *
   * The screen needs this to answer the question a schedule always prompts:
   * "has it come out yet, and where do I do it?" Without it a template shows a
   * time of day and nothing else, and somebody it is assigned to has no way to
   * tell whether the system has done its part.
   */
  private async raisedToday(
    templateIds: number[],
  ): Promise<Map<number, TodayOccurrence>> {
    if (!templateIds.length) return new Map();
    const today = dateMarker(zonedParts(new Date()).date);
    const rows = await this.prisma.task.findMany({
      where: { templateId: { in: templateIds }, occurrenceOn: today },
      select: {
        id: true,
        templateId: true,
        status: true,
        completedById: true,
        checklist: { select: { isDone: true } },
      },
    });
    const names = await this.tasks.namesOf(
      rows.map((t) => t.completedById ?? 0),
    );
    return new Map(
      rows.map((t) => [
        t.templateId!,
        {
          taskId: t.id,
          status: t.status,
          done: t.checklist.filter((c) => c.isDone).length,
          total: t.checklist.length,
          completedByName: t.completedById
            ? (names.get(t.completedById)?.name ?? null)
            : null,
        },
      ]),
    );
  }

  /**
   * When it next comes out, as an instant — or null if it never will (paused, or
   * a weekly with no days left set on it).
   *
   * Walks the calendar forward rather than doing modular arithmetic, because the
   * three frequencies have different shapes and a clamped monthly ("the 31st, or
   * the last day of a shorter month") is not expressible as an interval. Bounded
   * at 400 days: any schedule that has not come round inside a year and a bit is
   * one nobody should be told a date for.
   */
  private nextRunAt(
    template: ChecklistTemplate,
    local: ZonedParts,
  ): Date | null {
    if (!template.isActive) return null;
    // Over is over. `runsOn` would say no on every future date anyway, but
    // answering here saves walking a year of them to find that out.
    if (template.endsOn && local.date > dateOnly(template.endsOn)) return null;

    for (let ahead = 0; ahead <= 400; ahead += 1) {
      const date = addDays(local.date, ahead);
      if (!this.runsOn(template, calendarParts(date))) continue;
      // Today only counts if its time has not already passed.
      if (ahead === 0 && local.minutes >= template.startMinutes) continue;
      return zonedToInstant(date, template.startMinutes);
    }
    return null;
  }

  // ----------------------------------------------------------- view shapes --

  private async view(
    row: TemplateRow,
    userId: number,
    /** Passed in by `list`, which looks them all up in one query. */
    today?: TodayOccurrence | null,
    /** Ditto for the company / branch labels each card carries. */
    scope?: { companies: NamedRow[]; branches: NamedRow[] },
  ) {
    const people = await this.tasks.namesOf([
      row.createdById,
      ...row.assignees.map((a) => a.userId),
    ]);
    const local = zonedParts(new Date());
    const occurrence =
      today === undefined
        ? ((await this.raisedToday([row.id])).get(row.id) ?? null)
        : today;
    const where = scope ?? (await this.users.audienceOptions(userId));
    const endsOn = row.endsOn ? dateOnly(row.endsOn) : null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      companyId: row.companyId,
      branchId: row.branchId,
      // Named, because the list crosses companies: a card that said only
      // "Kitchen opening checks" would leave the reader guessing whose kitchen.
      companyName:
        where.companies.find((c) => c.id === row.companyId)?.name ?? null,
      branchName:
        (row.branchId &&
          where.branches.find((b) => b.id === row.branchId)?.name) ||
        null,
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
      /** I am one of the people who has to do it. */
      isForMe: row.assignees.some((a) => a.userId === userId),

      /** Its working life. `endsOn` null = no end date. */
      startsOn: dateOnly(row.startsOn),
      endsOn,
      /** Its last day has passed — it will not come round again. */
      hasEnded: !!endsOn && endsOn < local.date,
      /** Its first day has not arrived yet. */
      notStarted: dateOnly(row.startsOn) > local.date,

      /**
       * What became of TODAY's occurrence. Null before its start time, or on a
       * day it does not run. `status` and `completedByName` are what let the
       * person who set a checklist up see it was done without going to a board
       * in another company to find out.
       */
      todayTaskId: occurrence?.taskId ?? null,
      todayStatus: occurrence?.status ?? null,
      todayDone: occurrence?.done ?? 0,
      todayTotal: occurrence?.total ?? row.items.length,
      todayCompletedByName: occurrence?.completedByName ?? null,

      /** When it next comes out. Null when paused, ended, or never again. */
      nextRunAt: this.nextRunAt(row, local)?.toISOString() ?? null,
      /** The zone the times are read in, so the screen can say so. */
      timeZone: appTimeZone(),
    };
  }
}

/** A stored date-only marker as `YYYY-MM-DD`. */
function dateOnly(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** 28, 29, 30 or 31, for the local month of `YYYY-MM-DD`. */
function lastDayOfMonth(date: string): number {
  const [year, month] = date.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
