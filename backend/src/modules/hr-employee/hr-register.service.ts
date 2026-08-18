import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The company-wide reads the HR reports are built on.
 *
 * Separate from the per-employee services because the question is a different
 * one: not "this person's history" but "everybody, as at a date". Both resolve
 * their series by DATE, using the same rule the tabs and payroll use, so a
 * register and a payslip can never disagree about what somebody was on.
 */
@Injectable()
export class HrRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(
    companyId: number | undefined,
    branchId: number | undefined,
  ): Prisma.EmployeeWhereInput {
    if (!companyId) {
      throw new BadRequestException('No company in context.');
    }
    return { companyId, ...(branchId ? { branchId } : {}) };
  }

  /**
   * Every posting overlapping the window, with the employee it belongs to.
   *
   * OVERLAPPING rather than starting inside it: a transfer made two years ago
   * is still the posting somebody was on last month, and a register that showed
   * only the moves made in the period would leave most of the staff off it.
   * `startedInPeriod` marks the ones that are actually a move, so the report can
   * say which is which.
   */
  async postingRegister(
    companyId: number | undefined,
    branchId: number | undefined,
    from?: string,
    to?: string,
  ) {
    const year = new Date().getUTCFullYear();
    const start = day(from || `${year}-01-01`);
    const end = day(to || `${year}-12-31`);
    if (end < start) {
      throw new BadRequestException('The period ends before it starts.');
    }

    const rows = await this.prisma.employeePosting.findMany({
      where: {
        employee: this.scope(companyId, branchId),
        effectiveFrom: { lte: end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
      },
      include: {
        designation: { select: { name: true } },
        employee: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }],
    });

    const names = await this.placeNames();
    // What changed at each posting, worked out per employee against the row
    // before it — the same derivation the Postings tab shows, so the report and
    // the tab badge the same rows.
    const prevByEmployee = new Map<number, (typeof rows)[number]>();
    return rows.map((r) => {
      const prev = prevByEmployee.get(r.employeeId);
      prevByEmployee.set(r.employeeId, r);
      const changes: string[] = [];
      if (prev) {
        if (r.designationId !== prev.designationId) changes.push('DESIGNATION');
        if (r.companyId !== prev.companyId) changes.push('COMPANY');
        if (r.branchId !== prev.branchId) changes.push('BRANCH');
        if (r.costCenterId !== prev.costCenterId) changes.push('DIVISION');
        if (r.costObjectId !== prev.costObjectId) changes.push('DEPARTMENT');
      }
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeCode: r.employee.code,
        employeeName: r.employee.name,
        effectiveFrom: isoDay(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null,
        companyName: names.companies.get(r.companyId) ?? null,
        branchName: r.branchId
          ? (names.branches.get(r.branchId) ?? null)
          : null,
        divisionName: r.costCenterId
          ? (names.divisions.get(r.costCenterId) ?? null)
          : null,
        departmentName: r.costObjectId
          ? (names.departments.get(r.costObjectId) ?? null)
          : null,
        designationName: r.designation.name,
        remarks: r.remarks,
        changes,
        /** True where the move itself happened inside the window. */
        startedInPeriod: r.effectiveFrom >= start && r.effectiveFrom <= end,
      };
    });
  }

  /**
   * What every active employee was on, on one day.
   *
   * Employees come first and their package second, so somebody with NO package
   * still appears — with nulls. A register that quietly dropped them would hide
   * exactly the people payroll is about to fail on.
   *
   * Components come back as rows, not columns. Which allowances exist is the
   * business's to decide, so the REPORT pivots them into a column each; doing
   * it here would mean a fixed shape again.
   */
  async salaryRegister(
    companyId: number | undefined,
    branchId: number | undefined,
    on?: string,
  ) {
    const date = day(on || new Date().toISOString().slice(0, 10));

    const employees = await this.prisma.employee.findMany({
      where: { ...this.scope(companyId, branchId), isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        branchId: true,
        costCenterId: true,
        costObjectId: true,
        designation: { select: { name: true } },
        salaryPackages: {
          where: {
            effectiveFrom: { lte: date },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: {
            id: true,
            effectiveFrom: true,
            effectiveTo: true,
            basicSalary: true,
            components: {
              select: { kind: true, componentId: true, amount: true },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    });

    const names = await this.placeNames();
    const componentIds = [
      ...new Set(
        employees.flatMap((e) =>
          (e.salaryPackages[0]?.components ?? []).map((c) => c.componentId),
        ),
      ),
    ];
    // The alias travels with the label. A register turns each component into a
    // COLUMN, and "House Rent Allowance" sets a column width that the figures
    // under it never need — which is what the alias on a lookup value is for.
    const labels = componentIds.length
      ? new Map(
          (
            await this.prisma.lookupValue.findMany({
              where: { id: { in: componentIds } },
              select: { id: true, label: true, alias: true },
            })
          ).map((v) => [v.id, v]),
        )
      : new Map<number, { id: number; label: string; alias: string | null }>();

    return {
      on: isoDay(date),
      rows: employees.map((e) => {
        const pkg = e.salaryPackages[0] ?? null;
        const components = (pkg?.components ?? []).map((c) => ({
          kind: c.kind,
          componentId: c.componentId,
          componentName:
            labels.get(c.componentId)?.label ?? `#${c.componentId}`,
          /** The short form for a column head; null where none was given. */
          componentAlias: labels.get(c.componentId)?.alias ?? null,
          amount: Number(c.amount),
        }));
        const basic = pkg ? Number(pkg.basicSalary) : 0;
        const allowances = components
          .filter((c) => c.kind === 'ALLOWANCE')
          .reduce((t, c) => t + c.amount, 0);
        const deductions = components
          .filter((c) => c.kind === 'DEDUCTION')
          .reduce((t, c) => t + c.amount, 0);
        return {
          employeeId: e.id,
          employeeCode: e.code,
          employeeName: e.name,
          designationName: e.designation.name,
          branchName: e.branchId
            ? (names.branches.get(e.branchId) ?? null)
            : null,
          divisionName: e.costCenterId
            ? (names.divisions.get(e.costCenterId) ?? null)
            : null,
          departmentName: e.costObjectId
            ? (names.departments.get(e.costObjectId) ?? null)
            : null,
          /** Null where nobody has given them a package covering this date. */
          packageId: pkg?.id ?? null,
          effectiveFrom: pkg ? isoDay(pkg.effectiveFrom) : null,
          effectiveTo: pkg?.effectiveTo ? isoDay(pkg.effectiveTo) : null,
          basicSalary: basic,
          components,
          totalAllowances: allowances,
          totalDeductions: deductions,
          grossSalary: basic + allowances,
          netSalary: basic + allowances - deductions,
        };
      }),
    };
  }

  /** Company / branch / division / department names, in four reads. */
  private async placeNames() {
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
}
