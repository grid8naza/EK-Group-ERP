import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDayMonthYear } from '../../common/zoned-time';
import { BulkAssignShiftDto, SaveShiftAssignmentDto } from './hr-shift.dto';
import { shiftMinutes } from './hr-shift.service';

/** A date with the time thrown away — a roster line is whole days. */
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayBefore = (d: Date) => new Date(d.getTime() - 24 * 60 * 60 * 1000);

const withShift = {
  shift: {
    select: {
      id: true,
      code: true,
      name: true,
      timeIn: true,
      timeOut: true,
      breakMinutes: true,
    },
  },
} satisfies Prisma.EmployeeShiftAssignmentInclude;

/**
 * The roster (SRS §8.9, FR-HRP-01).
 *
 * Who is on which shift, from when — a dated SERIES per person, exactly like a
 * posting or a salary package. Putting somebody on nights is a new line
 * starting the day it takes effect, and the line before it closes the day
 * before. That is what lets last March's attendance resolve against the shift
 * they were actually on in March rather than the one they are on today.
 *
 * A series rather than a shift column on the employee, and rather than a rota
 * grid: the question the sheet asks is "what were they on THAT day", and only a
 * dated series answers it for a day that has already passed.
 */
@Injectable()
export class HrRosterService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------- read --

  /** One person's roster, newest first — the history, top down. */
  async findAll(employeeId: number) {
    await this.assertEmployee(employeeId);
    const rows = await this.prisma.employeeShiftAssignment.findMany({
      where: { employeeId },
      include: withShift,
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map((r) => this.view(r));
  }

  /**
   * The shift somebody was on for one day, or null where nobody had rostered
   * them. What the attendance sheet asks.
   */
  async shiftOn(employeeId: number, on: Date) {
    const row = await this.prisma.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      include: withShift,
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? this.view(row) : null;
  }

  /**
   * Who is on what, across a branch, as at a date — the roster register.
   *
   * Everybody appears, including the people nobody has rostered: "no shift" is
   * the answer a manager most needs to see, since those are the ones whose
   * attendance falls back to the branch's ordinary day.
   */
  async register(
    companyId: number | undefined,
    branchId: number | null,
    on?: string,
  ) {
    const date = day(on || new Date().toISOString().slice(0, 10));
    if (!companyId) return { on: isoDay(date), rows: [] };

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        ...(branchId === null ? {} : { branchId }),
        dateOfJoin: { lte: date },
        OR: [
          { lastWorkingDay: { gte: date } },
          { lastWorkingDay: null, isActive: true },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        branchId: true,
        defaultTimeIn: true,
        defaultTimeOut: true,
        designation: { select: { name: true } },
        shifts: {
          where: {
            effectiveFrom: { lte: date },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
          },
          include: withShift,
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
      orderBy: { code: 'asc' },
    });

    // Named rather than numbered: with every branch in view at once, "which
    // branch" is the column the reader is scanning down.
    const branchNames = new Map(
      (
        await this.prisma.branch.findMany({
          where: { companyId },
          select: { id: true, name: true },
        })
      ).map((b) => [b.id, b.name]),
    );

    return {
      on: isoDay(date),
      rows: employees.map((e) => {
        const line = e.shifts[0] ? this.view(e.shifts[0]) : null;
        return {
          employeeId: e.id,
          employeeCode: e.code,
          employeeName: e.name,
          designationName: e.designation.name,
          branchId: e.branchId,
          branchName: e.branchId ? (branchNames.get(e.branchId) ?? null) : null,
          shiftId: line?.shiftId ?? null,
          shiftCode: line?.shiftCode ?? null,
          shiftName: line?.shiftName ?? null,
          timeIn: line?.timeIn ?? e.defaultTimeIn,
          timeOut: line?.timeOut ?? e.defaultTimeOut,
          workMinutes: line?.workMinutes ?? null,
          effectiveFrom: line?.effectiveFrom ?? null,
          effectiveTo: line?.effectiveTo ?? null,
          /** True where their hours come from their own record, not a shift. */
          ownHours: !line && e.defaultTimeIn !== null,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- write --

  async create(employeeId: number, dto: SaveShiftAssignmentDto) {
    await this.assertEmployee(employeeId);
    if (!dto.effectiveFrom) {
      throw new BadRequestException('Say what day this shift starts.');
    }
    const from = day(dto.effectiveFrom);
    const to = dto.effectiveTo ? day(dto.effectiveTo) : null;
    this.assertPeriod(from, to);
    await this.assertShift(employeeId, dto.shiftId);

    await this.prisma.$transaction(async (tx) => {
      // Moving somebody onto a new shift closes the open-ended line before it,
      // the day before the new one starts — the same courtesy the postings and
      // salary series do, and for the same reason: the alternative is an
      // overlap nobody intended.
      await tx.employeeShiftAssignment.updateMany({
        where: { employeeId, effectiveTo: null, effectiveFrom: { lt: from } },
        data: { effectiveTo: dayBefore(from) },
      });
      await this.assertNoOverlap(tx, employeeId, from, to);
      await tx.employeeShiftAssignment.create({
        data: {
          employeeId,
          shiftId: dto.shiftId,
          effectiveFrom: from,
          effectiveTo: to,
          remarks: dto.remarks?.trim() || null,
        },
      });
    });
    return this.findAll(employeeId);
  }

  async update(
    employeeId: number,
    assignmentId: number,
    dto: SaveShiftAssignmentDto,
  ) {
    const existing = await this.assertAssignment(employeeId, assignmentId);
    const from = dto.effectiveFrom
      ? day(dto.effectiveFrom)
      : existing.effectiveFrom;
    const to =
      dto.effectiveTo !== undefined
        ? dto.effectiveTo
          ? day(dto.effectiveTo)
          : null
        : existing.effectiveTo;
    this.assertPeriod(from, to);
    const shiftId = dto.shiftId ?? existing.shiftId;
    await this.assertShift(employeeId, shiftId);

    await this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, employeeId, from, to, assignmentId);
      await tx.employeeShiftAssignment.update({
        where: { id: assignmentId },
        data: {
          shiftId,
          effectiveFrom: from,
          effectiveTo: to,
          ...(dto.remarks !== undefined
            ? { remarks: dto.remarks?.trim() || null }
            : {}),
        },
      });
    });
    return this.findAll(employeeId);
  }

  /**
   * Put a whole list of people on one shift, from one day.
   *
   * The reason this exists: rostering a bakery of ninety by opening ninety
   * records is not a job anybody does, so they stop rostering. Each person
   * still goes through `create` — the predecessor closes, the overlap is
   * checked — because a bulk action that skipped the rules would just be a
   * faster way to make a mess.
   *
   * It does NOT stop at the first refusal. One person with an overlapping line
   * must not cost the other eighty-nine their assignment; what failed comes
   * back named, so the caller can say exactly who still needs doing.
   */
  async assignMany(dto: BulkAssignShiftDto) {
    const employeeIds = [...new Set(dto.employeeIds ?? [])];
    if (!employeeIds.length) {
      throw new BadRequestException('Nobody is selected.');
    }
    const names = new Map(
      (
        await this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, name: true },
        })
      ).map((e) => [e.id, e.name]),
    );

    const failed: {
      employeeId: number;
      employeeName: string;
      reason: string;
    }[] = [];
    let assigned = 0;
    for (const employeeId of employeeIds) {
      try {
        await this.create(employeeId, {
          shiftId: dto.shiftId,
          effectiveFrom: dto.effectiveFrom,
          effectiveTo: dto.effectiveTo ?? null,
          remarks: dto.remarks ?? null,
        });
        assigned++;
      } catch (e) {
        failed.push({
          employeeId,
          employeeName: names.get(employeeId) ?? `#${employeeId}`,
          reason:
            e instanceof BadRequestException || e instanceof NotFoundException
              ? ((e.getResponse() as { message?: string })?.message ??
                e.message)
              : 'Could not be put on this shift.',
        });
      }
    }
    return { assigned, failed };
  }

  async remove(employeeId: number, assignmentId: number) {
    await this.assertAssignment(employeeId, assignmentId);
    await this.prisma.employeeShiftAssignment.delete({
      where: { id: assignmentId },
    });
    return this.findAll(employeeId);
  }

  // ------------------------------------------------------------- internals --

  private view(row: {
    id: number;
    employeeId: number;
    shiftId: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    remarks: string | null;
    shift: {
      code: string;
      name: string;
      timeIn: number;
      timeOut: number;
      breakMinutes: number;
    };
  }) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      shiftId: row.shiftId,
      shiftCode: row.shift.code,
      shiftName: row.shift.name,
      timeIn: row.shift.timeIn,
      timeOut: row.shift.timeOut,
      breakMinutes: row.shift.breakMinutes,
      workMinutes: shiftMinutes(row.shift),
      overnight: row.shift.timeOut <= row.shift.timeIn,
      effectiveFrom: isoDay(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? isoDay(row.effectiveTo) : null,
      remarks: row.remarks,
      /** True of the line in force today — what the listing badges. */
      current:
        row.effectiveFrom <= new Date() &&
        (!row.effectiveTo || row.effectiveTo >= new Date()),
    };
  }

  private async assertEmployee(employeeId: number) {
    const row = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Employee not found');
  }

  private async assertAssignment(employeeId: number, assignmentId: number) {
    const row = await this.prisma.employeeShiftAssignment.findFirst({
      where: { id: assignmentId, employeeId },
    });
    if (!row) throw new NotFoundException('Roster line not found');
    return row;
  }

  private assertPeriod(from: Date, to: Date | null) {
    if (to && to < from) {
      throw new BadRequestException(
        'The shift cannot end before the day it starts.',
      );
    }
  }

  /**
   * The shift has to exist, belong to the employee's company, and be one their
   * branch can see — a shift narrowed to the bakery is not on the office's
   * roster, and putting somebody on it from there would be a rota nobody works.
   */
  private async assertShift(employeeId: number, shiftId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true, branchId: true },
    });
    const shift = await this.prisma.hrShift.findUnique({
      where: { id: shiftId },
      select: {
        companyId: true,
        allBranches: true,
        isActive: true,
        name: true,
        branches: { select: { branchId: true } },
      },
    });
    if (!shift || !employee || shift.companyId !== employee.companyId) {
      throw new BadRequestException('That shift is not in this company.');
    }
    const worksHere =
      shift.allBranches ||
      (employee.branchId !== null &&
        shift.branches.some((b) => b.branchId === employee.branchId));
    if (!worksHere) {
      throw new BadRequestException(
        `"${shift.name}" is not worked at this person's branch.`,
      );
    }
    if (!shift.isActive) {
      throw new BadRequestException(`"${shift.name}" is no longer in use.`);
    }
  }

  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    employeeId: number,
    from: Date,
    to: Date | null,
    exceptId?: number,
  ) {
    const clash = await tx.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        ...(to ? { effectiveFrom: { lte: to } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
      select: { effectiveFrom: true, effectiveTo: true },
      orderBy: { effectiveFrom: 'asc' },
    });
    if (clash) {
      const until = clash.effectiveTo
        ? formatDayMonthYear(clash.effectiveTo)
        : 'further notice';
      throw new BadRequestException(
        `That period overlaps the shift running from ${formatDayMonthYear(clash.effectiveFrom)} to ${until}. Close that one first, or start this one the day after it ends.`,
      );
    }
  }
}
