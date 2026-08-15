import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalaryComponentKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveSalaryPackageDto } from './hr-salary.dto';

/** Which lookup each kind of component must come from. */
const LOOKUP_FOR: Record<SalaryComponentKind, string> = {
  ALLOWANCE: 'SALARY_ALLOWANCE',
  DEDUCTION: 'SALARY_DEDUCTION',
};

const withComponents = {
  components: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
} satisfies Prisma.EmployeeSalaryPackageInclude;

type PackageRow = Prisma.EmployeeSalaryPackageGetPayload<{
  include: typeof withComponents;
}>;

/** A date with the time thrown away — packages are whole days, not moments. */
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** The day before, for closing off the package an increment supersedes. */
const dayBefore = (d: Date) => new Date(d.getTime() - 24 * 60 * 60 * 1000);

/**
 * Salary packages (SRS §8.9) — what an employee is paid, and from when.
 *
 * The model is a SERIES, not a record with a current value. An increment is a
 * new package starting on the day it takes effect; the one it supersedes keeps
 * its own figures for ever. That is what lets a payslip for last March be
 * re-run next year and still come out at last March's salary, and it is why
 * `packageOn()` — the question payroll actually asks — is a lookup by date
 * rather than a read of "the current package".
 *
 * Allowances and deductions are ROWS against lookup values rather than columns,
 * so a new allowance is a lookup entry rather than a migration, and a report can
 * pivot whatever the business has defined into a column each.
 */
@Injectable()
export class HrSalaryService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ read --

  /** Every package for one employee, newest first — the history, top down. */
  async findAll(employeeId: number) {
    await this.assertEmployee(employeeId);
    const rows = await this.prisma.employeeSalaryPackage.findMany({
      where: { employeeId },
      include: withComponents,
      orderBy: { effectiveFrom: 'desc' },
    });
    return this.viewAll(rows);
  }

  /**
   * The package in force on one day — what a payroll run asks for.
   *
   * The newest package whose period contains the date. Periods may not overlap
   * (the writes below see to that), so "the newest that contains it" and "the
   * one that contains it" are the same answer; ordering is belt and braces.
   *
   * Returns null where the employee had no package that day — before their
   * first one, or in a gap somebody left between two. Payroll should treat that
   * as "nothing to pay, and something to ask about", not as zero.
   */
  async packageOn(employeeId: number, on: string) {
    await this.assertEmployee(employeeId);
    const date = day(on);
    const row = await this.prisma.employeeSalaryPackage.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      include: withComponents,
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    const [view] = await this.viewAll([row]);
    return view;
  }

  // ----------------------------------------------------------------- write --

  async create(employeeId: number, dto: SaveSalaryPackageDto) {
    await this.assertEmployee(employeeId);
    if (!dto.effectiveFrom) {
      throw new BadRequestException('Say what date this package starts from.');
    }
    if (dto.basicSalary === undefined) {
      throw new BadRequestException('Enter the basic salary.');
    }

    const from = day(dto.effectiveFrom);
    const to = dto.effectiveTo ? day(dto.effectiveTo) : null;
    this.assertPeriod(from, to);
    const components = await this.resolveComponents(dto.components ?? []);

    return this.prisma.$transaction(async (tx) => {
      // Raising an increment closes the open-ended package before it, the day
      // before the new one starts. Done for the user because the alternative is
      // an overlap they did not intend and would be told off for.
      await this.closePredecessor(tx, employeeId, from);
      await this.assertNoOverlap(tx, employeeId, from, to);

      const created = await tx.employeeSalaryPackage.create({
        data: {
          employeeId,
          effectiveFrom: from,
          effectiveTo: to,
          basicSalary: dto.basicSalary!,
          remarks: dto.remarks?.trim() || null,
          components: components.length ? { create: components } : undefined,
        },
        include: withComponents,
      });
      return created.id;
    });
  }

  async update(
    employeeId: number,
    packageId: number,
    dto: SaveSalaryPackageDto,
  ) {
    const existing = await this.assertPackage(employeeId, packageId);

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
    const components =
      dto.components !== undefined
        ? await this.resolveComponents(dto.components)
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, employeeId, from, to, packageId);
      await tx.employeeSalaryPackage.update({
        where: { id: packageId },
        data: {
          effectiveFrom: from,
          effectiveTo: to,
          ...(dto.basicSalary !== undefined
            ? { basicSalary: dto.basicSalary }
            : {}),
          ...(dto.remarks !== undefined
            ? { remarks: dto.remarks?.trim() || null }
            : {}),
        },
      });
      // Replaced wholesale: the client sends the list it means to keep, so a
      // removed allowance is one that simply did not arrive.
      if (components !== undefined) {
        await tx.employeeSalaryComponent.deleteMany({
          where: { packageId },
        });
        if (components.length) {
          await tx.employeeSalaryComponent.createMany({
            data: components.map((c) => ({ ...c, packageId })),
          });
        }
      }
    });
    return packageId;
  }

  async remove(employeeId: number, packageId: number) {
    await this.assertPackage(employeeId, packageId);
    // Components go with it (Cascade). Nothing else points at a package yet;
    // when payroll runs are stored, this will have to refuse to delete one that
    // has been paid against.
    await this.prisma.employeeSalaryPackage.delete({
      where: { id: packageId },
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- guards --

  private async assertEmployee(employeeId: number) {
    const row = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Employee not found');
  }

  private async assertPackage(employeeId: number, packageId: number) {
    const row = await this.prisma.employeeSalaryPackage.findFirst({
      where: { id: packageId, employeeId },
    });
    if (!row) throw new NotFoundException('Salary package not found');
    return row;
  }

  private assertPeriod(from: Date, to: Date | null) {
    if (to && to < from) {
      throw new BadRequestException(
        'The package cannot end before the day it starts.',
      );
    }
  }

  /**
   * Check every component id against the lookup its kind names, and hand back
   * rows ready to write.
   *
   * Checked because the ids are plain Ints across a domain line, so nothing
   * else would catch a deduction sent as an allowance. Ordered as they arrived:
   * a payslip lists components in the order somebody chose to enter them.
   */
  private async resolveComponents(
    components: {
      kind: SalaryComponentKind;
      componentId: number;
      amount: number;
    }[],
  ) {
    if (!components.length) return [];

    const seen = new Set<string>();
    for (const c of components) {
      const key = `${c.kind}:${c.componentId}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'The same component is listed twice. Enter it once, with the total.',
        );
      }
      seen.add(key);
    }

    const ids = [...new Set(components.map((c) => c.componentId))];
    const rows = await this.prisma.lookupValue.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, lookup: { select: { code: true } } },
    });
    const codeById = new Map(rows.map((r) => [r.id, r.lookup.code]));

    for (const c of components) {
      if (codeById.get(c.componentId) !== LOOKUP_FOR[c.kind]) {
        throw new BadRequestException(
          c.kind === 'ALLOWANCE'
            ? 'One of the allowances is not on the allowance list. Re-pick and save again.'
            : 'One of the deductions is not on the deduction list. Re-pick and save again.',
        );
      }
    }

    return components.map((c, i) => ({
      kind: c.kind,
      componentId: c.componentId,
      amount: new Prisma.Decimal(c.amount),
      sortOrder: i + 1,
    }));
  }

  /**
   * Close the open-ended package that a new one starting on `from` supersedes —
   * the day before it starts.
   *
   * Only the open-ended one, and only if it started earlier: a package with an
   * end date already says when it stops, and back-dating a package before an
   * existing one is a correction rather than an increment.
   */
  private async closePredecessor(
    tx: Prisma.TransactionClient,
    employeeId: number,
    from: Date,
  ) {
    await tx.employeeSalaryPackage.updateMany({
      where: {
        employeeId,
        effectiveTo: null,
        effectiveFrom: { lt: from },
      },
      data: { effectiveTo: dayBefore(from) },
    });
  }

  /**
   * Refuse two packages that both cover the same day.
   *
   * Two ranges overlap when each starts on or before the other ends — with a
   * null end read as "for ever", which is why it becomes a separate arm rather
   * than a comparison against null.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    employeeId: number,
    from: Date,
    to: Date | null,
    exceptId?: number,
  ) {
    const clash = await tx.employeeSalaryPackage.findFirst({
      where: {
        employeeId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        // theirs starts on or before ours ends
        ...(to ? { effectiveFrom: { lte: to } } : {}),
        // theirs ends on or after ours starts
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
        `That period overlaps the package running from ${isoDay(clash.effectiveFrom)} to ${until}. Close that one first, or start this one the day after it ends.`,
      );
    }
  }

  // ----------------------------------------------------------- view shapes --

  /** Every component label in one read, rather than one per package. */
  private async viewAll(rows: PackageRow[]) {
    const ids = [
      ...new Set(rows.flatMap((r) => r.components.map((c) => c.componentId))),
    ];
    const labels = ids.length
      ? new Map(
          (
            await this.prisma.lookupValue.findMany({
              where: { id: { in: ids } },
              select: { id: true, label: true },
            })
          ).map((v) => [v.id, v.label]),
        )
      : new Map<number, string>();

    return rows.map((r) => {
      const components = r.components.map((c) => ({
        id: c.id,
        kind: c.kind,
        componentId: c.componentId,
        // A component whose lookup value was deleted still has to render.
        componentName: labels.get(c.componentId) ?? `#${c.componentId}`,
        amount: Number(c.amount),
      }));
      const sum = (kind: SalaryComponentKind) =>
        components
          .filter((c) => c.kind === kind)
          .reduce((t, c) => t + c.amount, 0);

      const basicSalary = Number(r.basicSalary);
      const totalAllowances = sum('ALLOWANCE');
      const totalDeductions = sum('DEDUCTION');
      return {
        id: r.id,
        employeeId: r.employeeId,
        effectiveFrom: isoDay(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null,
        basicSalary,
        remarks: r.remarks,
        components,
        // Worked out here so a payslip, a report and this screen cannot each
        // arrive at a different net figure.
        totalAllowances,
        totalDeductions,
        grossSalary: basicSalary + totalAllowances,
        netSalary: basicSalary + totalAllowances - totalDeductions,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
