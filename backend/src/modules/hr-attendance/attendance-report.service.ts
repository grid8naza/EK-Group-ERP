import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ATTENDANCE_TYPE_LOOKUP } from './attendance.constants';
import { AttendanceSettingsService } from './attendance-settings.service';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The month asked for, or this one. */
function monthWindow(year?: number, month?: number) {
  const now = new Date();
  const y = year && year > 1900 ? year : now.getUTCFullYear();
  const m = month && month >= 1 && month <= 12 ? month : now.getUTCMonth() + 1;
  return {
    year: y,
    month: m,
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
  };
}

/** One day of somebody's time card — marked or not, worked or not. */
export interface TimeCardRow {
  date: string;
  weekday: number;
  weeklyOff: boolean;
  holidayName: string | null;
  /** False before they joined or after they left — not a gap in the marking. */
  employed: boolean;
  typeId: number | null;
  typeLabel: string | null;
  typeAlias: string | null;
  timeIn: number | null;
  timeOut: number | null;
  workedMinutes: number | null;
  isException: boolean;
  remarks: string | null;
  status: string | null;
  workflowStatus: string | null;
}

/**
 * What is read back out of attendance.
 *
 * Two reports, and they answer two different questions. The REGISTER is the
 * month on one page, a column per day and a row per person — the sheet this
 * module was drawn from, which is what a manager reads to see the shape of a
 * month. The TIME CARD is one person's month down the page, in and out and
 * hours — which is what you print when somebody queries their wage, and the
 * only one of the two that shows the clock.
 */
@Injectable()
export class AttendanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AttendanceSettingsService,
  ) {}

  /** The attendance types, in their configured order — the register's columns. */
  private async types() {
    const rows = await this.prisma.lookupValue.findMany({
      where: { lookup: { code: ATTENDANCE_TYPE_LOOKUP }, isActive: true },
      select: { id: true, label: true, alias: true, value: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      /** The letter a grid cell carries — the alias, or the label if none. */
      alias: r.alias?.trim() || r.label,
      code: r.value,
    }));
  }

  /**
   * The month, a row per employee and a column per day.
   *
   * Days with no sheet come back empty rather than absent, so the grid has a
   * cell for every day of the month and a gap in the marking reads as a gap
   * rather than as a shorter month.
   */
  async register(
    companyId: number | undefined,
    branchId: number | null,
    year?: number,
    month?: number,
  ) {
    const w = monthWindow(year, month);
    if (!companyId) {
      return { ...this.emptyHeader(w), types: [], rows: [] };
    }

    const [types, employees, entries, holidays, defaults] = await Promise.all([
      this.types(),
      this.prisma.employee.findMany({
        where: {
          companyId,
          ...(branchId === null ? {} : { branchId }),
          dateOfJoin: { lt: w.to },
          OR: [
            { lastWorkingDay: { gte: w.from } },
            { lastWorkingDay: null, isActive: true },
          ],
        },
        select: {
          id: true,
          code: true,
          name: true,
          branchId: true,
          designation: { select: { name: true } },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.attendanceEntry.findMany({
        where: {
          sheet: {
            companyId,
            ...(branchId === null ? {} : { branchId }),
            date: { gte: w.from, lt: w.to },
          },
        },
        select: {
          employeeId: true,
          typeId: true,
          workedMinutes: true,
          isException: true,
          sheet: { select: { date: true, status: true } },
        },
      }),
      this.prisma.attendanceHoliday.findMany({
        where: {
          companyId,
          date: { gte: w.from, lt: w.to },
          OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
        },
        select: { date: true, name: true },
      }),
      this.settings.effective(companyId, branchId),
    ]);

    const typeById = new Map(types.map((t) => [t.id, t]));
    // employeeId -> day -> the cell
    const grid = new Map<
      number,
      Map<string, { alias: string; typeId: number; isException: boolean }>
    >();
    const worked = new Map<number, number>();
    const counts = new Map<number, Map<number, number>>();
    for (const e of entries) {
      const iso = isoDay(e.sheet.date);
      const type = typeById.get(e.typeId);
      if (!grid.has(e.employeeId)) grid.set(e.employeeId, new Map());
      grid.get(e.employeeId)!.set(iso, {
        alias: type?.alias ?? '?',
        typeId: e.typeId,
        isException: e.isException,
      });
      worked.set(
        e.employeeId,
        (worked.get(e.employeeId) ?? 0) + (e.workedMinutes ?? 0),
      );
      if (!counts.has(e.employeeId)) counts.set(e.employeeId, new Map());
      const c = counts.get(e.employeeId)!;
      c.set(e.typeId, (c.get(e.typeId) ?? 0) + 1);
    }

    return {
      ...this.emptyHeader(w),
      days: this.days(w, defaults.weeklyOffDays, holidays),
      types,
      rows: employees.map((e) => ({
        employeeId: e.id,
        employeeCode: e.code,
        employeeName: e.name,
        designationName: e.designation.name,
        /** day (yyyy-mm-dd) → what that day counted as. */
        cells: Object.fromEntries(grid.get(e.id) ?? []),
        /** typeId → how many days. The register's count columns. */
        counts: Object.fromEntries(counts.get(e.id) ?? []),
        workedMinutes: worked.get(e.id) ?? 0,
        /** How many of the month's days were marked at all. */
        markedDays: grid.get(e.id)?.size ?? 0,
      })),
    };
  }

  /**
   * One employee's month, day by day — the time card.
   *
   * Every day of the month is a row, marked or not: the question this report
   * answers is "what was I paid for", and a day that silently vanished because
   * nobody marked it is exactly the day being queried.
   */
  async timeCard(
    companyId: number | undefined,
    employeeId: number,
    year?: number,
    month?: number,
  ) {
    const w = monthWindow(year, month);
    if (!companyId) throw new BadRequestException('No active company.');

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        branchId: true,
        dateOfJoin: true,
        lastWorkingDay: true,
        defaultTimeIn: true,
        defaultTimeOut: true,
        designation: { select: { name: true } },
      },
    });
    if (!employee) throw new BadRequestException('No such employee.');

    const [types, entries, holidays, defaults] = await Promise.all([
      this.types(),
      this.prisma.attendanceEntry.findMany({
        where: {
          employeeId,
          sheet: { date: { gte: w.from, lt: w.to } },
        },
        select: {
          typeId: true,
          timeIn: true,
          timeOut: true,
          workedMinutes: true,
          isException: true,
          remarks: true,
          sheet: { select: { date: true, status: true, workflowStatus: true } },
        },
      }),
      this.prisma.attendanceHoliday.findMany({
        where: {
          companyId,
          date: { gte: w.from, lt: w.to },
          OR: [
            { branchId: null },
            ...(employee.branchId ? [{ branchId: employee.branchId }] : []),
          ],
        },
        select: { date: true, name: true },
      }),
      this.settings.effective(companyId, employee.branchId),
    ]);

    const typeById = new Map(types.map((t) => [t.id, t]));
    const byDay = new Map(entries.map((e) => [isoDay(e.sheet.date), e]));
    const holidayByDay = new Map(holidays.map((h) => [isoDay(h.date), h.name]));

    const rows: TimeCardRow[] = [];
    const counts = new Map<number, number>();
    let workedMinutes = 0;
    for (let d = new Date(w.from); d < w.to; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = isoDay(d);
      const entry = byDay.get(iso);
      const type = entry ? typeById.get(entry.typeId) : null;
      if (entry) {
        counts.set(entry.typeId, (counts.get(entry.typeId) ?? 0) + 1);
        workedMinutes += entry.workedMinutes ?? 0;
      }
      // Before they joined, or after they left — not a gap in the marking.
      const employed =
        d >= new Date(employee.dateOfJoin.toISOString().slice(0, 10)) &&
        (!employee.lastWorkingDay || d <= employee.lastWorkingDay);
      rows.push({
        date: iso,
        weekday: d.getUTCDay(),
        weeklyOff: defaults.weeklyOffDays.includes(d.getUTCDay()),
        holidayName: holidayByDay.get(iso) ?? null,
        employed,
        typeId: entry?.typeId ?? null,
        typeLabel: type?.label ?? null,
        typeAlias: type?.alias ?? null,
        timeIn: entry?.timeIn ?? null,
        timeOut: entry?.timeOut ?? null,
        workedMinutes: entry?.workedMinutes ?? null,
        isException: entry?.isException ?? false,
        remarks: entry?.remarks ?? null,
        status: entry?.sheet.status ?? null,
        workflowStatus: entry?.sheet.workflowStatus ?? null,
      });
    }

    return {
      ...this.emptyHeader(w),
      employee: {
        id: employee.id,
        code: employee.code,
        name: employee.name,
        designationName: employee.designation.name,
        defaultTimeIn: employee.defaultTimeIn ?? defaults.defaultTimeIn,
        defaultTimeOut: employee.defaultTimeOut ?? defaults.defaultTimeOut,
      },
      types,
      counts: Object.fromEntries(counts),
      workedMinutes,
      unmarkedDays: rows.filter((r) => r.employed && !r.typeId).length,
      rows,
    };
  }

  // ------------------------------------------------------------- internals --

  private emptyHeader(w: ReturnType<typeof monthWindow>) {
    return { year: w.year, month: w.month, from: isoDay(w.from) };
  }

  /** Every day of the month, and what kind of day it is. */
  private days(
    w: ReturnType<typeof monthWindow>,
    weeklyOffDays: number[],
    holidays: { date: Date; name: string }[],
  ) {
    const holidayByDay = new Map(holidays.map((h) => [isoDay(h.date), h.name]));
    const out: {
      date: string;
      day: number;
      weekday: number;
      weeklyOff: boolean;
      holidayName: string | null;
    }[] = [];
    for (let d = new Date(w.from); d < w.to; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = isoDay(d);
      out.push({
        date: iso,
        day: d.getUTCDate(),
        weekday: d.getUTCDay(),
        weeklyOff: weeklyOffDays.includes(d.getUTCDay()),
        holidayName: holidayByDay.get(iso) ?? null,
      });
    }
    return out;
  }
}
