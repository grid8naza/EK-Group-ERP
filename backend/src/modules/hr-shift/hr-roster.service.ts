import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDayMonthYear } from '../../common/zoned-time';
import { BulkAssignDto, SaveShiftAssignmentDto } from './hr-shift.dto';
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
        // Division and department — the cost centre and the cost object under
        // it, as they sit on the EMPLOYEE. What the register groups by, and
        // not to be confused with the pair a team membership carries.
        costCenterId: true,
        costObjectId: true,
        defaultTimeIn: true,
        defaultTimeOut: true,
        designation: { select: { name: true } },
        // A team works its shift together, and that beats an individual line —
        // the register has to say the same thing the attendance sheet does.
        // Membership is dated, so this is the team they were in ON `date`.
        teamMemberships: {
          where: {
            effectiveFrom: { lte: date },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: {
            team: {
              select: {
                name: true,
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
              },
            },
          },
        },
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
    // branch" is the column the reader is scanning down — and the same goes
    // for the division and department the report can group by.
    const [branches, centres, objects] = await Promise.all([
      this.prisma.branch.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
      this.prisma.costCenter.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
      this.prisma.costObject.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
    ]);
    const branchNames = new Map(branches.map((b) => [b.id, b.name]));
    const divisionNames = new Map(centres.map((c) => [c.id, c.name]));
    const departmentNames = new Map(objects.map((o) => [o.id, o.name]));

    return {
      on: isoDay(date),
      rows: employees.map((e) => {
        const line = e.shifts[0] ? this.view(e.shifts[0]) : null;
        const teamShift = e.teamMemberships[0]?.team.shift ?? null;
        return {
          employeeId: e.id,
          employeeCode: e.code,
          employeeName: e.name,
          designationName: e.designation.name,
          branchId: e.branchId,
          branchName: e.branchId ? (branchNames.get(e.branchId) ?? null) : null,
          /** Division = cost centre, department = the cost object under it. */
          costCenterId: e.costCenterId,
          divisionName: e.costCenterId
            ? (divisionNames.get(e.costCenterId) ?? null)
            : null,
          costObjectId: e.costObjectId,
          departmentName: e.costObjectId
            ? (departmentNames.get(e.costObjectId) ?? null)
            : null,
          /** The team they are in, where they are in one. */
          teamName: e.teamMemberships[0]?.team.name ?? null,
          /** True where the shift shown is the TEAM's, not their own line. */
          shiftFromTeam: !!teamShift,
          shiftId: teamShift?.id ?? line?.shiftId ?? null,
          shiftCode: teamShift?.code ?? line?.shiftCode ?? null,
          shiftName: teamShift?.name ?? line?.shiftName ?? null,
          timeIn: teamShift?.timeIn ?? line?.timeIn ?? e.defaultTimeIn,
          timeOut: teamShift?.timeOut ?? line?.timeOut ?? e.defaultTimeOut,
          workMinutes: teamShift
            ? shiftMinutes(teamShift)
            : (line?.workMinutes ?? null),
          /** The team's shift has no dates of its own — it applies while they
           *  are in the team. */
          effectiveFrom: teamShift ? null : (line?.effectiveFrom ?? null),
          effectiveTo: teamShift ? null : (line?.effectiveTo ?? null),
          /** True where their hours come from their own record, not a shift. */
          ownHours: !teamShift && !line && e.defaultTimeIn !== null,
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
   * Move and/or roster a whole list of people, from one day.
   *
   * The reason this exists: doing either to a bakery of ninety by opening
   * ninety records is not a job anybody does, so it stops being done. Each
   * person still goes through the ordinary rules — the predecessor closes, the
   * overlap is checked — because a bulk action that skipped them would just be
   * a faster way to make a mess.
   *
   * A MOVE writes two things, because this system keeps them apart and both are
   * true: the employee's own branch / division / department, which is where
   * they work today and what every listing and the attendance sheet read, and a
   * POSTING from the same date, which is the service record of the transfer.
   * Writing only the first would lose the history; only the second would move
   * nobody.
   *
   * Placement is applied BEFORE the shift, so a shift only the new branch works
   * is accepted — "move them to Kadathy and put them on the night bake" has to
   * be one action, not two that must be done in the right order.
   *
   * It does NOT stop at the first refusal. One person with an overlapping line
   * must not cost the other eighty-nine theirs; what failed comes back named,
   * so the caller can say exactly who still needs doing.
   */
  async assignMany(companyId: number | undefined, dto: BulkAssignDto) {
    if (!companyId) throw new BadRequestException('No active company.');
    const employeeIds = [...new Set(dto.employeeIds ?? [])];
    if (!employeeIds.length) {
      throw new BadRequestException('Nobody is selected.');
    }
    const moving =
      dto.branchId !== undefined ||
      dto.costCenterId !== undefined ||
      dto.costObjectId !== undefined;
    if (!moving && dto.shiftId === undefined) {
      throw new BadRequestException(
        'Say what to change — a branch, a division, a department or a shift.',
      );
    }
    // Checked ONCE: the same place is being applied to everybody, so a company
    // that does not work in divisions should say so before ninety attempts.
    if (moving) await this.assertPlace(companyId, dto);

    const people = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: {
        id: true,
        name: true,
        companyId: true,
        branchId: true,
        costCenterId: true,
        costObjectId: true,
        designationId: true,
      },
    });
    const byId = new Map(people.map((e) => [e.id, e]));

    const failed: {
      employeeId: number;
      employeeName: string;
      reason: string;
    }[] = [];
    let assigned = 0;
    let moved = 0;

    for (const employeeId of employeeIds) {
      const employee = byId.get(employeeId);
      if (!employee) {
        failed.push({
          employeeId,
          employeeName: `#${employeeId}`,
          reason: 'Not an employee of this company.',
        });
        continue;
      }
      try {
        if (moving && (await this.movePerson(employee, dto))) moved++;
        if (dto.shiftId !== undefined) {
          await this.create(employeeId, {
            shiftId: dto.shiftId,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
            remarks: dto.remarks ?? null,
          });
          assigned++;
        }
      } catch (e) {
        failed.push({
          employeeId,
          employeeName: employee.name,
          reason:
            e instanceof BadRequestException || e instanceof NotFoundException
              ? ((e.getResponse() as { message?: string })?.message ??
                e.message)
              : 'Could not be changed.',
        });
      }
    }
    return { assigned, moved, failed };
  }

  /**
   * Move one person: their current placement, and the posting recording it.
   *
   * Returns false where nothing actually changes — running the same assignment
   * twice must not leave two transfers in a service record that says the person
   * never went anywhere.
   */
  private async movePerson(
    employee: {
      id: number;
      companyId: number;
      branchId: number | null;
      costCenterId: number | null;
      costObjectId: number | null;
      designationId: number;
    },
    dto: BulkAssignDto,
  ) {
    const branchId =
      dto.branchId !== undefined ? dto.branchId : employee.branchId;
    const costCenterId =
      dto.costCenterId !== undefined ? dto.costCenterId : employee.costCenterId;
    const costObjectId =
      dto.costObjectId !== undefined ? dto.costObjectId : employee.costObjectId;

    if (
      branchId === employee.branchId &&
      costCenterId === employee.costCenterId &&
      costObjectId === employee.costObjectId
    ) {
      return false;
    }

    const from = day(dto.effectiveFrom);
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employee.id },
        data: { branchId, costCenterId, costObjectId },
      });
      // The service record, written the way the Postings tab writes it: the
      // open-ended posting before this one closes the day before.
      await tx.employeePosting.updateMany({
        where: {
          employeeId: employee.id,
          effectiveTo: null,
          effectiveFrom: { lt: from },
        },
        data: { effectiveTo: dayBefore(from) },
      });
      const clash = await tx.employeePosting.findFirst({
        where: { employeeId: employee.id, effectiveFrom: from },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          `There is already a posting starting ${formatDayMonthYear(from)}. Close or move that one first.`,
        );
      }
      await tx.employeePosting.create({
        data: {
          employeeId: employee.id,
          effectiveFrom: from,
          effectiveTo: null,
          companyId: employee.companyId,
          branchId,
          costCenterId,
          costObjectId,
          // Carried forward: this is a transfer, not a promotion, and a posting
          // has to say what somebody holds as well as where they hold it.
          designationId: employee.designationId,
          remarks: dto.remarks?.trim() || null,
        },
      });
    });
    return true;
  }

  /**
   * The place being assigned has to hang together, and the company has to work
   * that way at all.
   *
   * The same three sentences the employee form and the postings tab use, for
   * the same three things that can be wrong: a level the company does not use,
   * a row belonging to somebody else, and a department under a different
   * division — which is what two loose dropdowns actually produce.
   */
  private async assertPlace(companyId: number, dto: BulkAssignDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        branchApplicable: true,
        costCenterApplicable: true,
        costObjectApplicable: true,
      },
    });
    if (!company) throw new BadRequestException('No such company.');

    if (dto.branchId !== undefined) {
      if (!company.branchApplicable) {
        throw new BadRequestException(
          `${company.name} does not work in branches.`,
        );
      }
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException('That branch is not in this company.');
      }
    }

    if (dto.costCenterId !== undefined) {
      if (!company.costCenterApplicable) {
        throw new BadRequestException(
          `${company.name} does not work in divisions.`,
        );
      }
      const centre = await this.prisma.costCenter.findFirst({
        where: { id: dto.costCenterId, companyId },
        select: { id: true },
      });
      if (!centre) {
        throw new BadRequestException('That division is not in this company.');
      }
    }

    if (dto.costObjectId !== undefined) {
      if (!company.costObjectApplicable) {
        throw new BadRequestException(
          `${company.name} does not work in departments.`,
        );
      }
      const object = await this.prisma.costObject.findFirst({
        where: { id: dto.costObjectId, companyId },
        select: { costCenterId: true },
      });
      if (!object) {
        throw new BadRequestException(
          'That department is not in this company.',
        );
      }
      // Checked as a PAIR: a department under a different division is the one
      // mistake two independent dropdowns are guaranteed to make.
      if (
        dto.costCenterId !== undefined &&
        object.costCenterId !== dto.costCenterId
      ) {
        throw new BadRequestException(
          'That department belongs to a different division.',
        );
      }
    }
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
