import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  dateMarker,
  formatDayMonthYear,
  zonedParts,
} from '../../common/zoned-time';
import {
  CreateHrTeamDto,
  HrTeamMemberDto,
  TransferTeamMembersDto,
  UpdateHrTeamDto,
} from './hr-team.dto';

/** A date-only marker: midnight UTC on the day itself. */
const day = (iso: string) => dateMarker(iso.slice(0, 10));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayBefore = (d: Date) => new Date(d.getTime() - 24 * 60 * 60 * 1000);
/** Today where the company works, not where the server happens to stand. */
const today = () => dateMarker(zonedParts(new Date()).date);

/** The memberships that are in force on one day. */
const covering = (on: Date) => ({
  effectiveFrom: { lte: on },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
});

/** One period, as the overlap rule reads it. Null `to` = no end. */
interface Period {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Whether two dated periods share so much as a day. */
const overlaps = (a: Period, b: Period) =>
  (!b.effectiveTo || a.effectiveFrom <= b.effectiveTo) &&
  (!a.effectiveTo || b.effectiveFrom <= a.effectiveTo);

const period = (p: Period) =>
  `from ${formatDayMonthYear(p.effectiveFrom)} to ${
    p.effectiveTo ? formatDayMonthYear(p.effectiveTo) : 'further notice'
  }`;

const withMembers = {
  leader: { select: { id: true, code: true, name: true } },
  shift: {
    select: { id: true, code: true, name: true, timeIn: true, timeOut: true },
  },
  members: {
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
      costCenterId: true,
      costObjectId: true,
      employee: {
        select: {
          id: true,
          code: true,
          name: true,
          designation: { select: { name: true } },
        },
      },
    },
    orderBy: [{ effectiveFrom: 'asc' as const }],
  },
} satisfies Prisma.HrTeamInclude;

type TeamRow = Prisma.HrTeamGetPayload<{ include: typeof withMembers }>;

/**
 * Teams (SRS §8.9) — who answers for whose attendance.
 *
 * The whole purpose is answerability: a branch of ninety is marked by six
 * leaders who each know the dozen in front of them, rather than by one person
 * guessing. Each team's day is its own sheet, marked and submitted by its
 * leader.
 *
 * A team belongs to ONE branch, and an employee to at most one team ON ANY ONE
 * DAY — two leaders marking the same person on the same day is exactly the
 * argument a sheet cannot settle. Membership is a dated series like a posting
 * or a roster line, so somebody who moved teams in March stays on March's old
 * sheets and appears on April's new ones without anybody rewriting either.
 * Anybody in no team on a given day is marked on the branch's own sheet, which
 * is what every branch had before teams existed.
 */
@Injectable()
export class HrTeamService {
  constructor(private readonly prisma: PrismaService) {}

  private view(row: TeamRow) {
    const on = today();
    const members = row.members
      .map((m) => ({
        /** The EMPLOYEE's id — what every other screen calls a person. */
        id: m.employee.id,
        /** The membership row, so an edit can keep one of two spells apart. */
        membershipId: m.id,
        code: m.employee.code,
        name: m.employee.name,
        designationName: m.employee.designation.name,
        /**
         * The division and department of the work THIS TEAM has them doing —
         * the membership's own, not the employee record's.
         */
        costCenterId: m.costCenterId,
        costObjectId: m.costObjectId,
        effectiveFrom: isoDay(m.effectiveFrom),
        effectiveTo: m.effectiveTo ? isoDay(m.effectiveTo) : null,
      }))
      .sort(
        (a, b) =>
          a.code.localeCompare(b.code) ||
          a.effectiveFrom.localeCompare(b.effectiveFrom),
      );

    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      name: row.name,
      leaderEmployeeId: row.leaderEmployeeId,
      leaderCode: row.leader.code,
      leaderName: row.leader.name,
      shiftId: row.shiftId,
      shiftCode: row.shift?.code ?? null,
      shiftName: row.shift?.name ?? null,
      shiftTimeIn: row.shift?.timeIn ?? null,
      shiftTimeOut: row.shift?.timeOut ?? null,
      remarks: row.remarks,
      isActive: row.isActive,
      isLocked: row.isLocked,
      /**
       * Who is in it TODAY — what a register column and the transfer screen
       * mean by "the people in this team". Every spell, past and future, is in
       * `members`.
       */
      memberIds: row.members
        .filter(
          (m) =>
            m.effectiveFrom <= on && (!m.effectiveTo || m.effectiveTo >= on),
        )
        .map((m) => m.employee.id),
      members,
    };
  }

  async findAll(companyId: number | undefined, branchId?: number) {
    if (!companyId) return [];
    const rows = await this.prisma.hrTeam.findMany({
      where: { companyId, ...(branchId ? { branchId } : {}) },
      include: withMembers,
      orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.view(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    return this.view(await this.ensure(companyId, id));
  }

  async create(companyId: number | undefined, dto: CreateHrTeamDto) {
    if (!companyId) throw new BadRequestException('No active company.');
    const branchId = dto.branchId ?? null;
    await this.assertName(companyId, dto.name.trim(), null);
    await this.assertLeader(companyId, branchId, dto.leaderEmployeeId);
    if (dto.shiftId) await this.assertShift(companyId, branchId, dto.shiftId);
    const members = await this.resolveMembers(
      companyId,
      branchId,
      dto.members,
      null,
    );

    const row = await this.prisma.hrTeam.create({
      data: {
        companyId,
        branchId,
        name: dto.name.trim(),
        leaderEmployeeId: dto.leaderEmployeeId,
        shiftId: dto.shiftId ?? null,
        remarks: dto.remarks?.trim() || null,
        isActive: dto.isActive ?? true,
        members: members?.length ? { create: members } : undefined,
      },
      include: withMembers,
    });
    return this.view(row);
  }

  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateHrTeamDto,
  ) {
    const existing = await this.ensure(companyId, id);
    assertUnlocked(existing, 'team');
    const branchId =
      dto.branchId !== undefined ? (dto.branchId ?? null) : existing.branchId;

    if (dto.name !== undefined) {
      await this.assertName(existing.companyId, dto.name.trim(), id);
    }
    if (dto.leaderEmployeeId !== undefined || dto.branchId !== undefined) {
      await this.assertLeader(
        existing.companyId,
        branchId,
        dto.leaderEmployeeId ?? existing.leaderEmployeeId,
      );
    }
    if (dto.shiftId)
      await this.assertShift(existing.companyId, branchId, dto.shiftId);
    const members = await this.resolveMembers(
      existing.companyId,
      branchId,
      dto.members,
      id,
    );

    const row = await this.prisma.$transaction(async (tx) => {
      if (members !== undefined) {
        // Replaced wholesale: a team is one statement about who works
        // together, and a half-applied edit is a team nobody can mark.
        await tx.hrTeamMember.deleteMany({ where: { teamId: id } });
        if (members.length) {
          await tx.hrTeamMember.createMany({
            data: members.map((m) => ({ teamId: id, ...m })),
          });
        }
      }
      return tx.hrTeam.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.branchId !== undefined ? { branchId } : {}),
          ...(dto.leaderEmployeeId !== undefined
            ? { leaderEmployeeId: dto.leaderEmployeeId }
            : {}),
          ...(dto.shiftId !== undefined
            ? { shiftId: dto.shiftId ?? null }
            : {}),
          ...(dto.remarks !== undefined
            ? { remarks: dto.remarks?.trim() || null }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: withMembers,
      });
    });
    return this.view(row);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.ensure(companyId, id);
    assertUnlocked(existing, 'team', 'deleting');
    const sheets = await this.prisma.attendanceSheet.count({
      where: { teamId: id },
    });
    if (sheets) {
      throw new ConflictException(
        `This team has marked ${sheets} ${sheets === 1 ? 'day' : 'days'}. Set it inactive instead — those days have to keep saying who answered for them.`,
      );
    }
    await this.prisma.hrTeam.delete({ where: { id } });
    return { success: true };
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.ensure(companyId, id);
    return this.view(
      await this.prisma.hrTeam.update({
        where: { id },
        data: { isLocked: locked },
        include: withMembers,
      }),
    );
  }

  /**
   * Move people from one team to another — or out of every team, or into one
   * from none — from a given day.
   *
   * One operation rather than two edits: taking somebody out of one team and
   * putting them in another has to happen together, or there is a moment where
   * they are in neither, and a sheet marked in that moment is missing them.
   *
   * The move is DATED, so nothing already marked is rewritten: the old spell is
   * closed the day before the move and the new one opens on the day of it. Days
   * before that keep answering to the old team, exactly as they were marked.
   *
   * Everybody named has to actually be where the caller says they are ON THAT
   * DAY. A transfer built from a stale screen would otherwise quietly move
   * somebody else's people.
   */
  async transfer(companyId: number | undefined, dto: TransferTeamMembersDto) {
    if (!companyId) throw new BadRequestException('No active company.');
    const employeeIds = [...new Set(dto.employeeIds ?? [])];
    if (!employeeIds.length)
      throw new BadRequestException('Nobody is selected.');
    // Absent means "wherever they are" — the caller is naming the destination
    // only. Null still means the definite claim "in no team".
    const fromStated = dto.fromTeamId !== undefined;
    const fromTeamId = dto.fromTeamId ?? null;
    const toTeamId = dto.toTeamId ?? null;
    if (fromStated && fromTeamId === toTeamId) {
      throw new BadRequestException('They are already there.');
    }
    if (!dto.effectiveFrom) {
      throw new BadRequestException('Say what day the move takes effect.');
    }
    const from = day(dto.effectiveFrom);
    if (isNaN(from.getTime())) {
      throw new BadRequestException('That is not a date.');
    }

    const to = toTeamId ? await this.ensure(companyId, toTeamId) : null;
    if (to && !to.isActive) {
      throw new BadRequestException(`${to.name} is no longer in use.`);
    }
    const place = {
      costCenterId: dto.costCenterId ?? null,
      costObjectId: dto.costObjectId ?? null,
    };
    if (to) await this.assertPlaces(companyId, [place]);

    const people = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: {
        id: true,
        name: true,
        branchId: true,
        teamMemberships: {
          where: covering(from),
          select: { id: true, teamId: true, effectiveFrom: true },
        },
      },
    });
    if (people.length !== employeeIds.length) {
      throw new BadRequestException(
        'One of those people is not an employee of this company.',
      );
    }
    // Only where the caller SAID where they were. A screen that names both
    // sides is asserting something checkable, and a stale one would otherwise
    // move somebody else's people; a screen that names only the destination is
    // asserting nothing, so there is nothing to check.
    if (fromStated) {
      const misplaced = people.filter(
        (p) => (p.teamMemberships[0]?.teamId ?? null) !== fromTeamId,
      );
      if (misplaced.length) {
        throw new ConflictException(
          `${misplaced.map((p) => p.name).join(', ')} ${misplaced.length === 1 ? 'is' : 'are'} not in the team you are moving them out of on ${formatDayMonthYear(from)}. Reopen the screen and try again.`,
        );
      }
    }

    // Whoever is already in the destination on that day is left alone: ending
    // their spell and opening an identical one is churn in the record, not a
    // transfer. Only meaningful for the destination-only caller, since the
    // other one has already asserted they are somewhere else.
    const moving = toTeamId
      ? people.filter((p) => p.teamMemberships[0]?.teamId !== toTeamId)
      : people;
    if (!moving.length) {
      throw new BadRequestException('They are already there.');
    }
    const movingIds = moving.map((p) => p.id);
    if (to && to.branchId !== null) {
      const elsewhere = people.filter((p) => p.branchId !== to.branchId);
      if (elsewhere.length) {
        throw new BadRequestException(
          `${elsewhere.map((p) => p.name).join(', ')} ${elsewhere.length === 1 ? 'does' : 'do'} not work at ${to.name}'s branch.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const person of moving) {
        const current = person.teamMemberships[0];
        if (!current) continue;
        if (current.effectiveFrom >= from) {
          // They had not started that spell yet — the move replaces it rather
          // than closing it the day before it began.
          await tx.hrTeamMember.delete({ where: { id: current.id } });
        } else {
          await tx.hrTeamMember.update({
            where: { id: current.id },
            data: { effectiveTo: dayBefore(from) },
          });
        }
      }

      if (toTeamId) {
        // Anything still open or still to come would overlap the new spell.
        // Named rather than counted: it is a decision about a person.
        const clash = await tx.hrTeamMember.findFirst({
          where: {
            employeeId: { in: movingIds },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
          },
          select: {
            effectiveFrom: true,
            employee: { select: { name: true } },
            team: { select: { name: true } },
          },
          orderBy: { effectiveFrom: 'asc' },
        });
        if (clash) {
          throw new ConflictException(
            `${clash.employee.name} is already down to be in ${clash.team.name} from ${formatDayMonthYear(clash.effectiveFrom)}. Settle that spell first.`,
          );
        }
        await tx.hrTeamMember.createMany({
          data: movingIds.map((employeeId) => ({
            teamId: toTeamId,
            employeeId,
            effectiveFrom: from,
            effectiveTo: null,
            ...place,
          })),
        });
      }
    });
    return { moved: movingIds.length, effectiveFrom: isoDay(from) };
  }

  // -------------------------------------------------------------- guards --

  private async ensure(companyId: number | undefined, id: number) {
    const row = await this.prisma.hrTeam.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
      include: withMembers,
    });
    if (!row) throw new NotFoundException('No such team.');
    return row;
  }

  /**
   * The team's shift has to be one its branch actually works — the same rule
   * the roster enforces, so a team is never put on a pattern its people could
   * not be assigned individually.
   */
  private async assertShift(
    companyId: number,
    branchId: number | null,
    shiftId: number,
  ) {
    const shift = await this.prisma.hrShift.findFirst({
      where: { id: shiftId, companyId },
      select: {
        name: true,
        isActive: true,
        allBranches: true,
        branches: { select: { branchId: true } },
      },
    });
    if (!shift) {
      throw new BadRequestException('That shift is not in this company.');
    }
    const worksHere =
      shift.allBranches ||
      (branchId !== null &&
        shift.branches.some((b) => b.branchId === branchId));
    if (!worksHere) {
      throw new BadRequestException(
        `"${shift.name}" is not worked at this team's branch.`,
      );
    }
    if (!shift.isActive) {
      throw new BadRequestException(`"${shift.name}" is no longer in use.`);
    }
  }

  private async assertName(
    companyId: number,
    name: string,
    exceptId: number | null,
  ) {
    if (!name) throw new BadRequestException('Give the team a name.');
    const clash = await this.prisma.hrTeam.findFirst({
      where: {
        companyId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `There is already a team called "${name}". A sheet is identified by its team's name.`,
      );
    }
  }

  /**
   * The division and department each membership names have to be this
   * company's, and have to belong together.
   *
   * Checked as a PAIR: a department under a different division is the one
   * mistake two independent dropdowns are guaranteed to make. Every distinct
   * pairing is checked once rather than once per person, since twelve people
   * put in the same department is one question, not twelve.
   *
   * Nothing here reads or touches the EMPLOYEE's own division and department.
   * What a team has somebody doing and where the person sits on the master are
   * two different facts, and this one belongs to the membership.
   */
  private async assertPlaces(
    companyId: number,
    rows: { costCenterId: number | null; costObjectId: number | null }[],
  ) {
    const pairs = [
      ...new Map(
        rows
          .filter((r) => r.costCenterId !== null || r.costObjectId !== null)
          .map((r) => [`${r.costCenterId}|${r.costObjectId}`, r]),
      ).values(),
    ];
    if (!pairs.length) return;

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        costCenterApplicable: true,
        costObjectApplicable: true,
      },
    });
    if (!company) throw new BadRequestException('No such company.');

    for (const pair of pairs) {
      if (pair.costCenterId !== null) {
        if (!company.costCenterApplicable) {
          throw new BadRequestException(
            `${company.name} does not work in divisions.`,
          );
        }
        const centre = await this.prisma.costCenter.findFirst({
          where: { id: pair.costCenterId, companyId },
          select: { id: true },
        });
        if (!centre) {
          throw new BadRequestException(
            'That division is not in this company.',
          );
        }
      }
      if (pair.costObjectId !== null) {
        if (!company.costObjectApplicable) {
          throw new BadRequestException(
            `${company.name} does not work in departments.`,
          );
        }
        const object = await this.prisma.costObject.findFirst({
          where: { id: pair.costObjectId, companyId },
          select: { costCenterId: true },
        });
        if (!object) {
          throw new BadRequestException(
            'That department is not in this company.',
          );
        }
        if (
          pair.costCenterId !== null &&
          object.costCenterId !== pair.costCenterId
        ) {
          throw new BadRequestException(
            'That department belongs to a different division.',
          );
        }
      }
    }
  }

  /**
   * The leader has to be an employee of this company, at this team's branch,
   * and hold a login — they cannot mark anything without one.
   *
   * The missing login is a WARNING rather than a refusal: a team is often set
   * up before the leader's account is, and refusing it would only mean the team
   * is kept on paper until somebody remembers. The attendance screen says the
   * same thing where it matters.
   */
  private async assertLeader(
    companyId: number,
    branchId: number | null,
    leaderEmployeeId: number,
  ) {
    const leader = await this.prisma.employee.findFirst({
      where: { id: leaderEmployeeId, companyId },
      select: { id: true, name: true, branchId: true, isActive: true },
    });
    if (!leader) {
      throw new BadRequestException(
        'The team leader must be an employee of this company.',
      );
    }
    if (!leader.isActive) {
      throw new BadRequestException(`${leader.name} is no longer active.`);
    }
    if (branchId !== null && leader.branchId !== branchId) {
      throw new BadRequestException(
        `${leader.name} does not work at this team's branch.`,
      );
    }
  }

  /**
   * The members: this company's, at this team's branch, each with a period that
   * clashes with no other team's — and with no other spell of their own.
   *
   * The last one is the point — see the note on the model. A person may be in
   * this team, then another, then back again; what they may not be is in two
   * teams on one day, because that is a day two leaders would both mark.
   * Whoever is in the way is NAMED, with the dates, because moving them is a
   * decision about a person and not a number.
   */
  private async resolveMembers(
    companyId: number,
    branchId: number | null,
    members: HrTeamMemberDto[] | undefined,
    teamId: number | null,
  ) {
    if (members === undefined) return undefined;
    const rows = members.map((m) => ({
      employeeId: m.employeeId,
      effectiveFrom: day(m.effectiveFrom ?? ''),
      effectiveTo: m.effectiveTo ? day(m.effectiveTo) : null,
      costCenterId: m.costCenterId ?? null,
      costObjectId: m.costObjectId ?? null,
    }));
    if (!rows.length) return [];

    for (const row of rows) {
      if (isNaN(row.effectiveFrom.getTime())) {
        throw new BadRequestException(
          'Say what day each person joins the team.',
        );
      }
      if (row.effectiveTo && row.effectiveTo < row.effectiveFrom) {
        throw new BadRequestException(
          'Nobody can leave a team before the day they join it.',
        );
      }
    }

    await this.assertPlaces(companyId, rows);

    const wanted = [...new Set(rows.map((r) => r.employeeId))];
    const found = await this.prisma.employee.findMany({
      where: { id: { in: wanted }, companyId },
      select: { id: true, name: true, branchId: true },
    });
    if (found.length !== wanted.length) {
      throw new BadRequestException(
        'One of those people is not an employee of this company.',
      );
    }
    const nameOf = new Map(found.map((e) => [e.id, e.name]));

    const elsewhere = found.filter(
      (e) => branchId !== null && e.branchId !== branchId,
    );
    if (elsewhere.length) {
      throw new BadRequestException(
        `${elsewhere.map((e) => e.name).join(', ')} ${elsewhere.length === 1 ? 'does' : 'do'} not work at this team's branch.`,
      );
    }

    // Two spells of the SAME team over the same days: caught here, since the
    // rows have not been written yet for the database to refuse.
    for (const employeeId of wanted) {
      const spells = rows
        .filter((r) => r.employeeId === employeeId)
        .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      for (let i = 1; i < spells.length; i++) {
        if (overlaps(spells[i - 1], spells[i])) {
          throw new BadRequestException(
            `${nameOf.get(employeeId)} is in this team twice over the same days — ${period(spells[i - 1])}, and ${period(spells[i])}.`,
          );
        }
      }
    }

    // And against every OTHER team's spells.
    const others = await this.prisma.hrTeamMember.findMany({
      where: {
        employeeId: { in: wanted },
        ...(teamId ? { teamId: { not: teamId } } : {}),
      },
      select: {
        employeeId: true,
        effectiveFrom: true,
        effectiveTo: true,
        team: { select: { name: true } },
      },
    });
    for (const row of rows) {
      const clash = others.find(
        (o) => o.employeeId === row.employeeId && overlaps(o, row),
      );
      if (clash) {
        throw new ConflictException(
          `${nameOf.get(row.employeeId)} is in ${clash.team.name} ${period(clash)}, which those dates overlap. Use Transfer, or start them here the day after that ends.`,
        );
      }
    }

    return rows;
  }
}
