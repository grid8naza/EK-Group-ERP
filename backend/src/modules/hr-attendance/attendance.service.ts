import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceSheetStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DocumentRef,
  WORKFLOW,
  WorkflowPort,
} from '../../contracts/workflow.port';
import { formatDayMonthYear } from '../../common/zoned-time';
import {
  ATTENDANCE_ROUTE,
  HR_MODULE_CODE,
  STATUS_MAP,
} from './attendance.constants';
import { ActAttendanceDto, SaveAttendanceSheetDto } from './attendance.dto';
import { AttendanceSettingsService } from './attendance-settings.service';

/** A date-only marker: midnight UTC on the day itself. */
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** What one line is expected to say before anybody touches it. */
interface Expected {
  typeId: number | null;
  timeIn: number | null;
  timeOut: number | null;
}

/**
 * The attendance sheet (SRS §8.9, FR-HRP-02).
 *
 * A sheet is one BRANCH on one DAY. It opens pre-filled — the working day the
 * branch keeps, or the weekly off, or the holiday — so the incharge touches
 * only what differs, and what they touch is flagged as the exception it is.
 * That is the whole design: the cost of marking a hundred people should be the
 * cost of the three who were late, and a verifier should be able to read the
 * three without hunting for them.
 *
 * Marked, then verified, then approved — through the ordinary workflow engine,
 * so who does each of those is configured in Cpanel → Workflows against this
 * screen rather than written in here. Approval closes the day: attendance is
 * what payroll pays on, and a figure that can still move after it has been
 * signed off was never signed off.
 *
 * Nothing here assumes a person typed it (FR-HRP-03). An entry is a time in, a
 * time out and a type, which is what a punching machine reports; the day one is
 * connected it writes these rows and the incharge reviews them instead.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AttendanceSettingsService,
    @Inject(WORKFLOW) private readonly workflow: WorkflowPort,
  ) {}

  // ----------------------------------------------------------------- read --

  /**
   * The sheet for one day, whether or not it has ever been saved.
   *
   * An unsaved day comes back as a full set of proposed lines rather than as
   * nothing: the incharge's job is to correct the exceptions, not to enter a
   * hundred identical rows, and a screen that opened empty would be asking for
   * the second.
   */
  async sheet(
    userId: number,
    companyId: number,
    branchId: number | null,
    date: string,
    isSuperAdmin = false,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const on = day(date);
    if (isNaN(on.getTime()))
      throw new BadRequestException('That is not a date.');

    const [defaults, types, holiday, roster, existing] = await Promise.all([
      this.settings.effective(companyId, branchId),
      this.settings.typeIds(),
      this.settings.holidayOn(companyId, branchId, on),
      this.roster(companyId, branchId, on),
      this.prisma.attendanceSheet.findFirst({
        where: { companyId, branchId, date: on },
        include: { entries: true },
      }),
    ]);

    // What the day IS, before anybody says otherwise: a holiday, the weekly
    // off, or an ordinary working day.
    const weeklyOff = defaults.weeklyOffDays.includes(on.getUTCDay());
    const dayType = holiday
      ? (types.holiday ?? defaults.defaultTypeId)
      : weeklyOff
        ? (types.weeklyOff ?? defaults.defaultTypeId)
        : defaults.defaultTypeId;
    const working = !holiday && !weeklyOff;

    const byEmployee = new Map(
      (existing?.entries ?? []).map((e) => [e.employeeId, e]),
    );
    const rows = roster.map((e) => {
      const expected = this.expected(e, defaults, dayType, working);
      const saved = byEmployee.get(e.id);
      return {
        employeeId: e.id,
        employeeCode: e.code,
        employeeName: e.name,
        designationName: e.designation.name,
        /** Null until the day is saved — the line is a proposal until then. */
        entryId: saved?.id ?? null,
        typeId: saved?.typeId ?? expected.typeId,
        timeIn: saved ? saved.timeIn : expected.timeIn,
        timeOut: saved ? saved.timeOut : expected.timeOut,
        workedMinutes: saved?.workedMinutes ?? null,
        remarks: saved?.remarks ?? null,
        isException: saved?.isException ?? false,
        // What this line WOULD say untouched, so the screen can mark what
        // differs and offer to put a line back.
        expectedTypeId: expected.typeId,
        expectedTimeIn: expected.timeIn,
        expectedTimeOut: expected.timeOut,
      };
    });

    const state = existing
      ? await this.workflow.docState(userId, await this.docRef(existing.id))
      : null;
    const firstStep = existing
      ? null
      : await this.workflow.firstStep(
          companyId,
          branchId,
          ...(await this.docTypeTuple()),
        );
    // Who may MARK is the workflow's answer too, not just the screen's Add
    // privilege: a Mark step names its people, and where one is configured it
    // supersedes the privilege exactly as it does on every other document.
    const gate = await this.markerGate(userId, companyId, branchId);

    return {
      date: isoDay(on),
      companyId,
      branchId,
      sheetId: existing?.id ?? null,
      status: existing?.status ?? AttendanceSheetStatus.DRAFT,
      workflowStatus: existing?.workflowStatus ?? null,
      remarks: existing?.remarks ?? null,
      markedAt: existing?.markedAt ?? null,
      /** What the day was filled in from, so the screen can say why. */
      defaults: {
        timeIn: defaults.defaultTimeIn,
        timeOut: defaults.defaultTimeOut,
        typeId: dayType,
        fromBranch: defaults.fromBranch,
      },
      holidayName: holiday?.name ?? null,
      weeklyOff,
      working,
      canMark:
        this.canMark(existing?.status ?? null, state?.myTask?.canEdit) &&
        (isSuperAdmin || !gate.governed || gate.allowed),
      /** True where a workflow decides who marks, so the screen can say why. */
      markingGoverned: gate.governed,
      workflow: state,
      firstStep,
      rows,
    };
  }

  /**
   * Which days of a month have been marked, and how far each has got.
   *
   * The screen's calendar: an incharge opening it on the 20th needs to see the
   * three days nobody marked, and a verifier needs to see what is waiting.
   */
  async month(
    companyId: number,
    branchId: number | null,
    year: number,
    month: number,
  ) {
    if (!companyId) return { days: [] };
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const [sheets, holidays, defaults] = await Promise.all([
      this.prisma.attendanceSheet.findMany({
        where: { companyId, branchId, date: { gte: from, lt: to } },
        include: { _count: { select: { entries: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.attendanceHoliday.findMany({
        where: {
          companyId,
          date: { gte: from, lt: to },
          OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
        },
      }),
      this.settings.effective(companyId, branchId),
    ]);
    const sheetByDay = new Map(sheets.map((s) => [isoDay(s.date), s]));
    const holidayByDay = new Map(holidays.map((h) => [isoDay(h.date), h.name]));

    const days: {
      date: string;
      status: AttendanceSheetStatus | null;
      workflowStatus: string | null;
      marked: number;
      weeklyOff: boolean;
      holidayName: string | null;
    }[] = [];
    for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = isoDay(d);
      const sheet = sheetByDay.get(iso);
      days.push({
        date: iso,
        status: sheet?.status ?? null,
        workflowStatus: sheet?.workflowStatus ?? null,
        marked: sheet?._count.entries ?? 0,
        weeklyOff: defaults.weeklyOffDays.includes(d.getUTCDay()),
        holidayName: holidayByDay.get(iso) ?? null,
      });
    }
    return { days };
  }

  // ---------------------------------------------------------------- write --

  /**
   * Save the day. Creates the sheet on first save, and replaces the lines.
   *
   * Every line is written, not only the exceptions: the sheet is the record of
   * what everybody did, and "nothing was said about them" is not the same
   * answer as "they were here, as usual". The exception FLAG is what carries
   * the distinction, and it is worked out here rather than trusted from the
   * caller — a browser must not be able to describe a changed line as routine.
   */
  async save(
    userId: number,
    companyId: number,
    branchId: number | null,
    dto: SaveAttendanceSheetDto,
    isSuperAdmin = false,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const on = day(dto.date);
    if (isNaN(on.getTime()))
      throw new BadRequestException('That is not a date.');

    const gate = await this.markerGate(userId, companyId, branchId);
    if (gate.governed && !gate.allowed && !isSuperAdmin) {
      throw new ForbiddenException(
        'A workflow decides who marks attendance here, and you are not on its marking step.',
      );
    }

    const existing = await this.prisma.attendanceSheet.findFirst({
      where: { companyId, branchId, date: on },
      select: { id: true, status: true },
    });
    if (existing) {
      const state = await this.workflow.docState(
        userId,
        await this.docRef(existing.id),
      );
      if (!this.canMark(existing.status, state.myTask?.canEdit)) {
        throw new ForbiddenException(
          existing.status === AttendanceSheetStatus.APPROVED
            ? 'This day has been approved and can no longer be marked.'
            : 'This day is with its approvers and cannot be marked right now.',
        );
      }
    }

    const [defaults, types, holiday, roster] = await Promise.all([
      this.settings.effective(companyId, branchId),
      this.settings.typeIds(),
      this.settings.holidayOn(companyId, branchId, on),
      this.roster(companyId, branchId, on),
    ]);
    const weeklyOff = defaults.weeklyOffDays.includes(on.getUTCDay());
    const dayType = holiday
      ? (types.holiday ?? defaults.defaultTypeId)
      : weeklyOff
        ? (types.weeklyOff ?? defaults.defaultTypeId)
        : defaults.defaultTypeId;
    const working = !holiday && !weeklyOff;

    const rosterById = new Map(roster.map((e) => [e.id, e]));
    const seen = new Set<number>();
    const lines = dto.entries.map((line) => {
      const employee = rosterById.get(line.employeeId);
      if (!employee) {
        throw new BadRequestException(
          'Somebody on this sheet does not work at this branch on this day.',
        );
      }
      if (seen.has(line.employeeId)) {
        throw new BadRequestException('Somebody is on this sheet twice.');
      }
      seen.add(line.employeeId);
      if (!types.all.has(line.typeId)) {
        throw new BadRequestException('That is not an attendance type.');
      }
      const timeIn = line.timeIn ?? null;
      const timeOut = line.timeOut ?? null;
      const expected = this.expected(employee, defaults, dayType, working);
      return {
        employeeId: line.employeeId,
        typeId: line.typeId,
        timeIn,
        timeOut,
        workedMinutes: this.worked(timeIn, timeOut),
        isException:
          line.typeId !== expected.typeId ||
          timeIn !== expected.timeIn ||
          timeOut !== expected.timeOut,
        remarks: line.remarks?.trim() || null,
      };
    });

    return this.prisma.$transaction(async (tx) => {
      const sheet = existing
        ? await tx.attendanceSheet.update({
            where: { id: existing.id },
            data: {
              remarks: dto.remarks?.trim() || null,
              markedByUserId: userId,
              markedAt: new Date(),
            },
          })
        : await tx.attendanceSheet.create({
            data: {
              companyId,
              branchId,
              date: on,
              remarks: dto.remarks?.trim() || null,
              markedByUserId: userId,
              markedAt: new Date(),
            },
          });

      // Replaced wholesale rather than diffed: the sheet is one statement about
      // one day, and a half-applied edit is a day nobody can answer for.
      await tx.attendanceEntry.deleteMany({ where: { sheetId: sheet.id } });
      if (lines.length) {
        await tx.attendanceEntry.createMany({
          data: lines.map((l) => ({ sheetId: sheet.id, ...l })),
        });
      }
      return sheet.id;
    });
  }

  /**
   * Send the day for verification and approval.
   *
   * Acts as the marker's own level (mark + forward) exactly as every other
   * document here does, so it lands at whoever verifies rather than waiting for
   * the person who just marked it to act on their own step.
   */
  async submit(
    userId: number,
    companyId: number,
    branchId: number | null,
    date: string,
    isSuperAdmin = false,
  ) {
    const on = day(date);
    const sheet = await this.prisma.attendanceSheet.findFirst({
      where: { companyId, branchId, date: on },
      include: { _count: { select: { entries: true } } },
    });
    if (!sheet) {
      throw new BadRequestException('Mark the day before sending it on.');
    }
    if (
      sheet.status !== AttendanceSheetStatus.DRAFT &&
      sheet.status !== AttendanceSheetStatus.REJECTED
    ) {
      throw new BadRequestException('This day has already been sent on.');
    }
    if (!sheet._count.entries) {
      throw new BadRequestException('There is nobody on this sheet.');
    }

    const [moduleId, objectId] = await this.docTypeTuple();
    const res = await this.workflow.submitAsCreator({
      startedByUserId: userId,
      companyId,
      branchId,
      moduleId,
      objectId,
      documentId: sheet.id,
      documentRef: await this.documentRef(companyId, branchId, sheet.date),
      // A sheet has no money on it. The headcount is its headline figure — the
      // one that means something in an approver's inbox, and the one a limit
      // would be set on if a business wanted big branches signed off higher up.
      amount: sheet._count.entries,
    });

    await this.prisma.attendanceSheet.update({
      where: { id: sheet.id },
      data: {
        status: res ? STATUS_MAP[res.status] : AttendanceSheetStatus.APPROVED,
        workflowInstanceId: res?.instanceId ?? sheet.workflowInstanceId,
        workflowStatus: res?.statusLabel ?? null,
      },
    });
    return this.sheet(userId, companyId, branchId, date, isSuperAdmin);
  }

  /** Act on the sheet's workflow task — verify, approve, reject, send back. */
  async act(
    userId: number,
    companyId: number,
    branchId: number | null,
    date: string,
    dto: ActAttendanceDto,
    isSuperAdmin = false,
  ) {
    const on = day(date);
    const sheet = await this.prisma.attendanceSheet.findFirst({
      where: { companyId, branchId, date: on },
      select: { id: true, markedByUserId: true },
    });
    if (!sheet) throw new NotFoundException('There is no sheet for that day.');
    const ref = await this.docRef(sheet.id);

    // The marker withdrawing their own day. Having forwarded it they hold no
    // task, so this cannot go through the task path — the create step's own
    // cancel permission decides it, as it does on every other document.
    if (dto.action === 'CANCEL' && sheet.markedByUserId === userId) {
      const state = await this.workflow.docState(userId, ref);
      if (!state.myTask) {
        const first = await this.workflow.firstStep(
          companyId,
          branchId,
          ref.moduleId,
          ref.objectId,
        );
        if (!first?.canCancel) {
          throw new ForbiddenException('You cannot withdraw this day.');
        }
        await this.workflow.cancelForDocument(
          ref.moduleId,
          ref.objectId,
          ref.documentId,
        );
        await this.prisma.attendanceSheet.update({
          where: { id: sheet.id },
          data: { status: AttendanceSheetStatus.DRAFT, workflowStatus: null },
        });
        return this.sheet(userId, companyId, branchId, date, isSuperAdmin);
      }
    }

    const res = await this.workflow.actOnDocument(
      userId,
      ref,
      dto.action,
      dto.comment,
    );
    await this.prisma.attendanceSheet.update({
      where: { id: sheet.id },
      data: {
        status: STATUS_MAP[res.status],
        workflowStatus: res.statusLabel ?? null,
      },
    });
    return this.sheet(userId, companyId, branchId, date, isSuperAdmin);
  }

  // ------------------------------------------------------------- internals --

  /**
   * Who this branch has to mark on this day.
   *
   * Employees POSTED here — an exact branch match, so head-office staff do not
   * turn up on a branch's sheet and nobody is marked twice.
   *
   * The employment window, not the Active flag: somebody who left in March is
   * on March's sheets and off April's, and a record deactivated without a last
   * working day simply stops appearing from today.
   */
  private roster(companyId: number, branchId: number | null, on: Date) {
    return this.prisma.employee.findMany({
      where: {
        companyId,
        branchId,
        dateOfJoin: { lte: on },
        OR: [
          { lastWorkingDay: { gte: on } },
          { lastWorkingDay: null, isActive: true },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        defaultTimeIn: true,
        defaultTimeOut: true,
        designation: { select: { name: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * What one person's line says before anybody touches it.
   *
   * The employee's own hours where they have them, else the branch's. On a day
   * nobody is due at work the times are blank rather than the branch's — a
   * weekly off with a nine-to-six on it would be a claim that somebody worked.
   */
  private expected(
    employee: { defaultTimeIn: number | null; defaultTimeOut: number | null },
    defaults: { defaultTimeIn: number; defaultTimeOut: number },
    dayTypeId: number | null,
    working: boolean,
  ): Expected {
    if (!working) return { typeId: dayTypeId, timeIn: null, timeOut: null };
    return {
      typeId: dayTypeId,
      timeIn: employee.defaultTimeIn ?? defaults.defaultTimeIn,
      timeOut: employee.defaultTimeOut ?? defaults.defaultTimeOut,
    };
  }

  /**
   * What a time in and a time out come to.
   *
   * A finish at or before the start is read as a shift that crossed midnight —
   * an ordinary night in a bakery, where the dough is on at ten and out at six.
   */
  private worked(timeIn: number | null, timeOut: number | null) {
    if (timeIn === null || timeOut === null) return null;
    return timeOut > timeIn ? timeOut - timeIn : timeOut + 24 * 60 - timeIn;
  }

  /** Whether the day may still be marked. */
  private canMark(status: AttendanceSheetStatus | null, canEdit?: boolean) {
    if (status === null) return true;
    if (
      status === AttendanceSheetStatus.DRAFT ||
      status === AttendanceSheetStatus.REJECTED ||
      status === AttendanceSheetStatus.CANCELLED
    ) {
      return true;
    }
    // In the workflow: only where the step the sheet has reached lets its
    // holder edit — a verifier correcting a time rather than sending it back.
    return !!canEdit;
  }

  /**
   * Whether a workflow decides who marks here, and whether this person is one
   * of them.
   *
   * The engine's create gate under another name: on this document "creating" IS
   * marking the day. Where no workflow is configured the gate is not governed
   * and the screen's own privilege decides, which is what lets a company run
   * attendance without approvals at all.
   */
  private async markerGate(
    userId: number,
    companyId: number,
    branchId: number | null,
  ) {
    const [moduleId, objectId] = await this.docTypeTuple();
    return this.workflow.creatorGate(
      userId,
      moduleId,
      objectId,
      companyId,
      branchId,
    );
  }

  /** How the day names itself in an approver's inbox. */
  private async documentRef(
    companyId: number,
    branchId: number | null,
    date: Date,
  ) {
    const branch = branchId
      ? await this.prisma.branch.findUnique({
          where: { id: branchId },
          select: { name: true },
        })
      : null;
    const company = branch
      ? null
      : await this.prisma.company.findUnique({
          where: { id: companyId },
          select: { code: true },
        });
    const place = branch?.name ?? company?.code ?? '';
    return `Attendance ${formatDayMonthYear(date)}${place ? ` · ${place}` : ''}`;
  }

  private async docTypeTuple(): Promise<[number, number]> {
    const [mod, obj] = await Promise.all([
      this.prisma.module.findUnique({
        where: { code: HR_MODULE_CODE },
        select: { id: true },
      }),
      this.prisma.objectMaster.findFirst({
        where: { route: ATTENDANCE_ROUTE },
        select: { id: true },
      }),
    ]);
    if (!mod || !obj) {
      throw new BadRequestException(
        'The attendance sheet is not registered as a document type.',
      );
    }
    return [mod.id, obj.id];
  }

  private async docRef(documentId: number): Promise<DocumentRef> {
    const [moduleId, objectId] = await this.docTypeTuple();
    return { moduleId, objectId, documentId };
  }
}

/** Kept for the report service, which reads the same shapes. */
export type AttendanceSheetWhere = Prisma.AttendanceSheetWhereInput;
