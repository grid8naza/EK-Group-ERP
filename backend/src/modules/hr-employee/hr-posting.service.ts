import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SavePostingDto } from './hr-posting.dto';

const withDesignation = {
  designation: { select: { id: true, name: true } },
} satisfies Prisma.EmployeePostingInclude;

type PostingRow = Prisma.EmployeePostingGetPayload<{
  include: typeof withDesignation;
}>;

/** A date with the time thrown away — postings are whole days, not moments. */
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayBefore = (d: Date) => new Date(d.getTime() - 24 * 60 * 60 * 1000);

/** The names a posting is read with, fetched once for a whole page. */
interface PlaceNames {
  companies: Map<number, string>;
  branches: Map<number, string>;
  divisions: Map<number, string>;
  departments: Map<number, string>;
}

/**
 * Postings (SRS §8.9) — where an employee has worked, and as what.
 *
 * A series like salary packages, for the same reason: a promotion or a transfer
 * is a NEW posting from the day it takes effect, not an edit of the last one.
 * What somebody was on in March stays readable next year, which is what a
 * service record is for.
 *
 * WHAT KIND of change it was is derived, never stored. A posting whose
 * designation differs from the one before it is a promotion; one whose place
 * differs is a transfer; a row can be both. Asking somebody to classify the
 * change as well as enter it only invites the two to disagree — and the change
 * is already sitting in the data.
 *
 * Branch, division and department are asked for only where the COMPANY has them
 * switched on (Company.branchApplicable / costCenterApplicable /
 * costObjectApplicable). The form hides what does not apply; this refuses it,
 * because a form is not a guarantee.
 */
@Injectable()
export class HrPostingService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ read --

  /** The whole service record, newest first. */
  async findAll(employeeId: number) {
    await this.assertEmployee(employeeId);
    const rows = await this.prisma.employeePosting.findMany({
      where: { employeeId },
      include: withDesignation,
      orderBy: { effectiveFrom: 'desc' },
    });
    return this.view(rows);
  }

  /**
   * The posting in force on one day. The counterpart of the salary lookup, for
   * anything that needs to know where somebody was on a date rather than where
   * they are now — a payslip's branch, a report of last quarter's headcount.
   */
  async postingOn(employeeId: number, on: string) {
    await this.assertEmployee(employeeId);
    const date = day(on);
    const row = await this.prisma.employeePosting.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      include: withDesignation,
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    const [view] = await this.view([row]);
    return view;
  }

  // ----------------------------------------------------------------- write --

  async create(employeeId: number, dto: SavePostingDto) {
    await this.assertEmployee(employeeId);
    if (!dto.effectiveFrom) {
      throw new BadRequestException('Say what date this posting starts from.');
    }
    if (!dto.companyId) throw new BadRequestException('Choose the company.');
    if (!dto.designationId) {
      throw new BadRequestException('Choose the designation.');
    }

    const from = day(dto.effectiveFrom);
    const to = dto.effectiveTo ? day(dto.effectiveTo) : null;
    this.assertPeriod(from, to);
    const place = await this.assertPlace(dto);

    await this.prisma.$transaction(async (tx) => {
      // A transfer closes the posting it supersedes, the day before the new one
      // starts — the same courtesy the salary series does, and for the same
      // reason: the alternative is an overlap nobody intended.
      await tx.employeePosting.updateMany({
        where: { employeeId, effectiveTo: null, effectiveFrom: { lt: from } },
        data: { effectiveTo: dayBefore(from) },
      });
      await this.assertNoOverlap(tx, employeeId, from, to);
      await tx.employeePosting.create({
        data: {
          employeeId,
          effectiveFrom: from,
          effectiveTo: to,
          ...place,
          remarks: dto.remarks?.trim() || null,
        },
      });
    });
    return this.findAll(employeeId);
  }

  async update(employeeId: number, postingId: number, dto: SavePostingDto) {
    const existing = await this.assertPosting(employeeId, postingId);

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

    // Merged with what is stored, so a partial edit is checked as the whole
    // posting it will become rather than as the fragment that arrived.
    const place = await this.assertPlace({
      companyId: dto.companyId ?? existing.companyId,
      branchId: dto.branchId !== undefined ? dto.branchId : existing.branchId,
      costCenterId:
        dto.costCenterId !== undefined
          ? dto.costCenterId
          : existing.costCenterId,
      costObjectId:
        dto.costObjectId !== undefined
          ? dto.costObjectId
          : existing.costObjectId,
      designationId: dto.designationId ?? existing.designationId,
    });

    await this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, employeeId, from, to, postingId);
      await tx.employeePosting.update({
        where: { id: postingId },
        data: {
          effectiveFrom: from,
          effectiveTo: to,
          ...place,
          ...(dto.remarks !== undefined
            ? { remarks: dto.remarks?.trim() || null }
            : {}),
        },
      });
    });
    return this.findAll(employeeId);
  }

  async remove(employeeId: number, postingId: number) {
    await this.assertPosting(employeeId, postingId);
    await this.prisma.employeePosting.delete({ where: { id: postingId } });
    return this.findAll(employeeId);
  }

  // ---------------------------------------------------------------- guards --

  private async assertEmployee(employeeId: number) {
    const row = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Employee not found');
  }

  private async assertPosting(employeeId: number, postingId: number) {
    const row = await this.prisma.employeePosting.findFirst({
      where: { id: postingId, employeeId },
    });
    if (!row) throw new NotFoundException('Posting not found');
    return row;
  }

  private assertPeriod(from: Date, to: Date | null) {
    if (to && to < from) {
      throw new BadRequestException(
        'The posting cannot end before the day it starts.',
      );
    }
  }

  /**
   * Check the place hangs together, and hand back the columns to write.
   *
   * Three things can be wrong and each gets its own sentence: a level the
   * company does not use at all, a row belonging to another company, and a
   * department under a different division. The last is the one two loose
   * dropdowns actually produce, which is why they are checked as a PAIR — the
   * same rule the Employee form follows.
   */
  private async assertPlace(dto: {
    companyId?: number;
    branchId?: number | null;
    costCenterId?: number | null;
    costObjectId?: number | null;
    designationId?: number;
  }) {
    const companyId = dto.companyId!;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        branchApplicable: true,
        costCenterApplicable: true,
        costObjectApplicable: true,
      },
    });
    if (!company) throw new BadRequestException('No such company.');

    const branchId = dto.branchId ?? null;
    const costCenterId = dto.costCenterId ?? null;
    const costObjectId = dto.costObjectId ?? null;

    if (branchId != null) {
      if (!company.branchApplicable) {
        throw new BadRequestException(
          `${company.name} does not work in branches, so a posting there cannot name one.`,
        );
      }
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException(
          'That branch does not belong to that company.',
        );
      }
    }

    if (costCenterId != null) {
      if (!company.costCenterApplicable) {
        throw new BadRequestException(
          `${company.name} does not work in divisions, so a posting there cannot name one.`,
        );
      }
      const centre = await this.prisma.costCenter.findFirst({
        where: { id: costCenterId, companyId },
        select: { id: true },
      });
      if (!centre) {
        throw new BadRequestException(
          'That division does not belong to that company.',
        );
      }
    }

    if (costObjectId != null) {
      if (!company.costObjectApplicable) {
        throw new BadRequestException(
          `${company.name} does not work in departments, so a posting there cannot name one.`,
        );
      }
      const object = await this.prisma.costObject.findFirst({
        where: { id: costObjectId, companyId },
        select: { costCenterId: true },
      });
      if (!object) {
        throw new BadRequestException(
          'That department does not belong to that company.',
        );
      }
      if (costCenterId != null && object.costCenterId !== costCenterId) {
        throw new BadRequestException(
          'That department is not under the chosen division.',
        );
      }
    }

    const designation = await this.prisma.hrDesignation.findUnique({
      where: { id: dto.designationId! },
      select: { id: true, isActive: true },
    });
    if (!designation) throw new BadRequestException('No such designation.');
    if (!designation.isActive) {
      throw new BadRequestException('That designation is inactive.');
    }

    return {
      companyId,
      branchId,
      costCenterId,
      // A department names its own division, so filling it in from there saves
      // asking twice — the Employee form does the same.
      costObjectId,
      designationId: dto.designationId!,
    };
  }

  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    employeeId: number,
    from: Date,
    to: Date | null,
    exceptId?: number,
  ) {
    const clash = await tx.employeePosting.findFirst({
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
        ? isoDay(clash.effectiveTo)
        : 'further notice';
      throw new BadRequestException(
        `That period overlaps the posting running from ${isoDay(clash.effectiveFrom)} to ${until}. Close that one first, or start this one the day after it ends.`,
      );
    }
  }

  // ----------------------------------------------------------- view shapes --

  /** Company, branch, division and department names, in four reads for the page. */
  private async placeNames(): Promise<PlaceNames> {
    const [companies, branches, centres, objects] = await Promise.all([
      this.prisma.company.findMany({ select: { id: true, name: true } }),
      this.prisma.branch.findMany({ select: { id: true, name: true } }),
      this.prisma.costCenter.findMany({ select: { id: true, name: true } }),
      this.prisma.costObject.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      companies: new Map(companies.map((c) => [c.id, c.name])),
      branches: new Map(branches.map((b) => [b.id, b.name])),
      divisions: new Map(centres.map((c) => [c.id, c.name])),
      departments: new Map(objects.map((o) => [o.id, o.name])),
    };
  }

  /**
   * Shape the rows and work out what CHANGED at each one.
   *
   * Compared against the posting immediately before it in time — which, since
   * the rows arrive newest first, is the NEXT element. The oldest posting has
   * nothing before it: that is where somebody started, not a change.
   */
  private async view(rows: PostingRow[]) {
    const names = await this.placeNames();
    // Oldest → newest, so "the one before" is the previous element.
    const chronological = [...rows].sort(
      (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
    );
    const changesById = new Map<number, string[]>();
    chronological.forEach((row, i) => {
      const prev = chronological[i - 1];
      if (!prev) {
        changesById.set(row.id, []);
        return;
      }
      const changes: string[] = [];
      if (row.designationId !== prev.designationId) changes.push('DESIGNATION');
      if (row.companyId !== prev.companyId) changes.push('COMPANY');
      if (row.branchId !== prev.branchId) changes.push('BRANCH');
      if (row.costCenterId !== prev.costCenterId) changes.push('DIVISION');
      if (row.costObjectId !== prev.costObjectId) changes.push('DEPARTMENT');
      changesById.set(row.id, changes);
    });

    return rows.map((r) => {
      const changes = changesById.get(r.id) ?? [];
      return {
        id: r.id,
        employeeId: r.employeeId,
        effectiveFrom: isoDay(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null,

        companyId: r.companyId,
        companyName: names.companies.get(r.companyId) ?? null,
        branchId: r.branchId,
        branchName: r.branchId
          ? (names.branches.get(r.branchId) ?? null)
          : null,
        costCenterId: r.costCenterId,
        divisionName: r.costCenterId
          ? (names.divisions.get(r.costCenterId) ?? null)
          : null,
        costObjectId: r.costObjectId,
        departmentName: r.costObjectId
          ? (names.departments.get(r.costObjectId) ?? null)
          : null,
        designationId: r.designationId,
        designationName: r.designation.name,

        remarks: r.remarks,
        /**
         * What differs from the posting before this one. Empty on the first —
         * joining is not a change. The client turns these into the words a
         * person uses: a designation change reads as a promotion, a change of
         * place as a transfer.
         */
        changes,
        isFirst:
          changes.length === 0 &&
          !chronological.some((c) => c.effectiveFrom < r.effectiveFrom),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
