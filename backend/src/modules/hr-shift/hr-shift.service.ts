import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateHrShiftDto, UpdateHrShiftDto } from './hr-shift.dto';

/** A shift with its branch links, as every read here loads it. */
const withBranches = {
  branches: { select: { branchId: true } },
} satisfies Prisma.HrShiftInclude;

type ShiftRow = Prisma.HrShiftGetPayload<{ include: typeof withBranches }>;

/**
 * What a shift is worth in hours: start to finish, less the unpaid break.
 *
 * A finish at or before the start crossed midnight — an ordinary night in a
 * bakery, where the dough goes on at ten and comes out at six.
 */
export function shiftMinutes(shift: {
  timeIn: number;
  timeOut: number;
  breakMinutes: number;
}) {
  const span =
    shift.timeOut > shift.timeIn
      ? shift.timeOut - shift.timeIn
      : shift.timeOut + 24 * 60 - shift.timeIn;
  return Math.max(0, span - shift.breakMinutes);
}

/**
 * Shift Master (SRS §8.9, FR-HRP-01 — "shifts and rosters per branch").
 *
 * A named working pattern somebody can be put ON, as opposed to the working day
 * a branch keeps by default (that is Attendance Settings).
 *
 * A shift belongs to the company and is worked by ANY NUMBER of its branches —
 * all of them, or a chosen few. A list rather than one branch because that is
 * how a group actually runs: the night bake happens at three of the five
 * plants, and a shift that could only say "one branch or everywhere" would be
 * entered three times under three codes.
 */
@Injectable()
export class HrShiftService {
  constructor(private readonly prisma: PrismaService) {}

  private view(row: ShiftRow) {
    const branchIds = row.branches.map((b) => b.branchId);
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      timeIn: row.timeIn,
      timeOut: row.timeOut,
      breakMinutes: row.breakMinutes,
      remarks: row.remarks,
      isActive: row.isActive,
      isLocked: row.isLocked,
      /** True = every branch; then branchIds is empty. */
      allBranches: row.allBranches,
      branchIds,
      /** Worked out here so no two readers can disagree about it. */
      workMinutes: shiftMinutes(row),
      /** True where the shift finishes on the following day. */
      overnight: row.timeOut <= row.timeIn,
    };
  }

  /**
   * The company's shifts. With a branch in context, only the ones that branch
   * works — its own, plus the ones kept everywhere.
   */
  async findAll(companyId: number | undefined, branchId?: number) {
    if (!companyId) return [];
    const rows = await this.prisma.hrShift.findMany({
      where: {
        companyId,
        ...(branchId
          ? {
              OR: [{ allBranches: true }, { branches: { some: { branchId } } }],
            }
          : {}),
      },
      include: withBranches,
      orderBy: [{ timeIn: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => this.view(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    return this.view(await this.ensure(companyId, id));
  }

  async create(companyId: number | undefined, dto: CreateHrShiftDto) {
    if (!companyId) throw new BadRequestException('No active company.');
    const branchIds = await this.resolveBranches(companyId, dto.branchIds);
    await this.assertCodeFree(companyId, dto.code.trim(), null);

    const row = await this.prisma.hrShift.create({
      data: {
        companyId,
        code: dto.code.trim(),
        name: dto.name.trim(),
        timeIn: dto.timeIn,
        timeOut: dto.timeOut,
        breakMinutes: dto.breakMinutes ?? 0,
        remarks: dto.remarks?.trim() || null,
        isActive: dto.isActive ?? true,
        allBranches: branchIds.length === 0,
        branches: branchIds.length
          ? { create: branchIds.map((branchId) => ({ branchId })) }
          : undefined,
      },
      include: withBranches,
    });
    return this.view(row);
  }

  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateHrShiftDto,
  ) {
    const existing = await this.ensure(companyId, id);
    assertUnlocked(existing, 'shift');
    if (dto.code !== undefined) {
      await this.assertCodeFree(existing.companyId, dto.code.trim(), id);
    }

    // The branch list is replaced wholesale when it is sent at all — a set is
    // one statement, and a half-applied edit is a shift nobody can place.
    let branchIds: number[] | undefined;
    if (dto.branchIds !== undefined) {
      branchIds = await this.resolveBranches(existing.companyId, dto.branchIds);
      await this.assertNobodyStranded(id, branchIds);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (branchIds !== undefined) {
        await tx.hrShiftBranch.deleteMany({ where: { shiftId: id } });
        if (branchIds.length) {
          await tx.hrShiftBranch.createMany({
            data: branchIds.map((branchId) => ({ shiftId: id, branchId })),
          });
        }
      }
      return tx.hrShift.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.timeIn !== undefined ? { timeIn: dto.timeIn } : {}),
          ...(dto.timeOut !== undefined ? { timeOut: dto.timeOut } : {}),
          ...(dto.breakMinutes !== undefined
            ? { breakMinutes: dto.breakMinutes }
            : {}),
          ...(dto.remarks !== undefined
            ? { remarks: dto.remarks?.trim() || null }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(branchIds !== undefined
            ? { allBranches: branchIds.length === 0 }
            : {}),
        },
        include: withBranches,
      });
    });
    return this.view(row);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.ensure(companyId, id);
    assertUnlocked(existing, 'shift', 'deleting');
    const used = await this.prisma.employeeShiftAssignment.count({
      where: { shiftId: id },
    });
    if (used) {
      throw new ConflictException(
        `This shift is on ${used} roster ${used === 1 ? 'line' : 'lines'}. Set it inactive instead — the history has to keep saying what people were actually on.`,
      );
    }
    await this.prisma.hrShift.delete({ where: { id } });
    return { success: true };
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.ensure(companyId, id);
    return this.view(
      await this.prisma.hrShift.update({
        where: { id },
        data: { isLocked: locked },
        include: withBranches,
      }),
    );
  }

  // -------------------------------------------------------------- guards --

  private async ensure(companyId: number | undefined, id: number) {
    const row = await this.prisma.hrShift.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
      include: withBranches,
    });
    if (!row) throw new NotFoundException('No such shift.');
    return row;
  }

  /**
   * The branches a shift is being pinned to: deduped, and every one of them
   * this company's. An empty list means every branch, which is the default and
   * what a company with no branches at all always gets.
   */
  private async resolveBranches(companyId: number, ids?: number[] | null) {
    const wanted = [...new Set(ids ?? [])];
    if (!wanted.length) return [];
    const found = await this.prisma.branch.findMany({
      where: { id: { in: wanted }, companyId },
      select: { id: true },
    });
    if (found.length !== wanted.length) {
      throw new BadRequestException(
        'One of those branches is not in this company.',
      );
    }
    return found.map((b) => b.id);
  }

  private async assertCodeFree(
    companyId: number,
    code: string,
    exceptId: number | null,
  ) {
    if (!code) throw new BadRequestException('Give the shift a short code.');
    const clash = await this.prisma.hrShift.findFirst({
      where: {
        companyId,
        code: { equals: code, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    });
    if (clash) {
      throw new ConflictException(
        `"${code}" is already ${clash.name}. A roster is read by these letters, so each has to mean one thing.`,
      );
    }
  }

  /**
   * Nobody may be left rostered on a shift their branch no longer works.
   *
   * Only a NARROWING can strand anybody, so an empty list — every branch — is
   * always safe. The message names the branches rather than the count: "move
   * them first" is only actionable if you know where to look.
   */
  private async assertNobodyStranded(shiftId: number, branchIds: number[]) {
    if (!branchIds.length) return;
    const stranded = await this.prisma.employeeShiftAssignment.findMany({
      where: {
        shiftId,
        OR: [
          { employee: { branchId: null } },
          { employee: { branchId: { notIn: branchIds } } },
        ],
      },
      select: { employee: { select: { name: true, branchId: true } } },
      take: 5,
    });
    if (!stranded.length) return;
    const names = [...new Set(stranded.map((s) => s.employee.name))];
    throw new ConflictException(
      `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} rostered on this shift at a branch you are taking it away from. Move them off it first.`,
    );
  }
}
