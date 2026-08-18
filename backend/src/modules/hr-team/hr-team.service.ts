import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateHrTeamDto, UpdateHrTeamDto } from './hr-team.dto';

const withMembers = {
  leader: { select: { id: true, code: true, name: true } },
  members: {
    select: {
      employee: {
        select: {
          id: true,
          code: true,
          name: true,
          designation: { select: { name: true } },
        },
      },
    },
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
 * A team belongs to ONE branch, and an employee to at most one team — two
 * leaders marking the same person on the same day is exactly the argument a
 * sheet cannot settle. Anybody in no team is marked on the branch's own sheet,
 * which is what every branch had before teams existed.
 */
@Injectable()
export class HrTeamService {
  constructor(private readonly prisma: PrismaService) {}

  private view(row: TeamRow) {
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      name: row.name,
      leaderEmployeeId: row.leaderEmployeeId,
      leaderCode: row.leader.code,
      leaderName: row.leader.name,
      remarks: row.remarks,
      isActive: row.isActive,
      isLocked: row.isLocked,
      memberIds: row.members.map((m) => m.employee.id),
      members: row.members
        .map((m) => ({
          id: m.employee.id,
          code: m.employee.code,
          name: m.employee.name,
          designationName: m.employee.designation.name,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
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
    const memberIds = await this.resolveMembers(
      companyId,
      branchId,
      dto.memberIds,
      null,
    );

    const row = await this.prisma.hrTeam.create({
      data: {
        companyId,
        branchId,
        name: dto.name.trim(),
        leaderEmployeeId: dto.leaderEmployeeId,
        remarks: dto.remarks?.trim() || null,
        isActive: dto.isActive ?? true,
        members: memberIds.length
          ? { create: memberIds.map((employeeId) => ({ employeeId })) }
          : undefined,
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
    const memberIds =
      dto.memberIds !== undefined
        ? await this.resolveMembers(
            existing.companyId,
            branchId,
            dto.memberIds,
            id,
          )
        : undefined;

    const row = await this.prisma.$transaction(async (tx) => {
      if (memberIds !== undefined) {
        // Replaced wholesale: a team is one statement about who works
        // together, and a half-applied edit is a team nobody can mark.
        await tx.hrTeamMember.deleteMany({ where: { teamId: id } });
        if (memberIds.length) {
          await tx.hrTeamMember.createMany({
            data: memberIds.map((employeeId) => ({ teamId: id, employeeId })),
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

  // -------------------------------------------------------------- guards --

  private async ensure(companyId: number | undefined, id: number) {
    const row = await this.prisma.hrTeam.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
      include: withMembers,
    });
    if (!row) throw new NotFoundException('No such team.');
    return row;
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
   * The members: this company's, at this team's branch, and in no OTHER team.
   *
   * The last one is the point — see the note on the model. Somebody already in
   * another team is named rather than counted, because moving them is a
   * decision about a person and not a number.
   */
  private async resolveMembers(
    companyId: number,
    branchId: number | null,
    ids: number[] | undefined,
    teamId: number | null,
  ) {
    const wanted = [...new Set(ids ?? [])];
    if (!wanted.length) return [];

    const found = await this.prisma.employee.findMany({
      where: { id: { in: wanted }, companyId },
      select: {
        id: true,
        name: true,
        branchId: true,
        teamMembership: {
          select: { teamId: true, team: { select: { name: true } } },
        },
      },
    });
    if (found.length !== wanted.length) {
      throw new BadRequestException(
        'One of those people is not an employee of this company.',
      );
    }
    const elsewhere = found.filter(
      (e) => e.branchId !== branchId && branchId !== null,
    );
    if (elsewhere.length) {
      throw new BadRequestException(
        `${elsewhere.map((e) => e.name).join(', ')} ${elsewhere.length === 1 ? 'does' : 'do'} not work at this team's branch.`,
      );
    }
    const taken = found.filter(
      (e) => e.teamMembership && e.teamMembership.teamId !== teamId,
    );
    if (taken.length) {
      throw new ConflictException(
        taken
          .map((e) => `${e.name} is already in ${e.teamMembership!.team.name}`)
          .join('; ') + '. Take them out of that team first.',
      );
    }
    return found.map((e) => e.id);
  }
}
