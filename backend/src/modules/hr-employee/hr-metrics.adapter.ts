import { Injectable } from '@nestjs/common';
import { EmployeeSex, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MetricContext,
  MetricDef,
  MetricProviderPort,
} from '../../contracts/metric-provider.port';

/**
 * The HR module's metric provider — what the HR Dashboard's widgets are built
 * from.
 *
 * Reads only this module's own tables (employees, designations, salary
 * packages). Headcount is scoped to the company AND, when one is active, the
 * BRANCH: an employee carries a real branchId, so a branch manager looking at
 * their own dashboard should see their own people rather than the group's.
 * Registered in contracts/contracts.module.ts.
 */
@Injectable()
export class HrMetricsAdapter implements MetricProviderPort {
  constructor(private readonly prisma: PrismaService) {}

  /** Company, and branch too when one is active. */
  private scope(ctx: MetricContext): Prisma.EmployeeWhereInput {
    return {
      companyId: ctx.companyId,
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    };
  }

  private count(extra: (ctx: MetricContext) => Prisma.EmployeeWhereInput) {
    return (ctx: MetricContext) =>
      this.prisma.employee.count({
        where: { ...this.scope(ctx), ...extra(ctx) },
      });
  }

  /**
   * Count the employees carrying one EMPLOYEE_STATUS value.
   *
   * Matched on the lookup value's CODE, never its label: an admin may rename
   * "In Service" to "Working" tomorrow, and a dashboard that stopped counting
   * because of it would be worse than useless. The code is the stable half —
   * see the seed in hr-provisioning.ts.
   *
   * A status nobody has defined counts nobody rather than everybody: an unknown
   * code returns 0, which is the truthful answer to "how many are On Leave" on
   * a database where that status does not exist.
   */
  private countByStatus(code: string, opts: { activeOnly?: boolean } = {}) {
    return async (ctx: MetricContext) => {
      const value = await this.prisma.lookupValue.findFirst({
        where: { value: code, lookup: { code: 'EMPLOYEE_STATUS' } },
        select: { id: true },
      });
      if (!value) return 0;
      return this.prisma.employee.count({
        where: {
          ...this.scope(ctx),
          statusId: value.id,
          ...(opts.activeOnly ? { isActive: true } : {}),
        },
      });
    };
  }

  /** Midnight today, and the first of this month / year, in whole days. */
  private today() {
    const now = new Date();
    const day = (y: number, m: number, d: number) =>
      new Date(Date.UTC(y, m, d));
    return {
      today: day(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      monthStart: day(now.getUTCFullYear(), now.getUTCMonth(), 1),
      yearStart: day(now.getUTCFullYear(), 0, 1),
    };
  }

  /**
   * The salary packages in force TODAY for this company's active employees,
   * with their components — the basis of every pay figure on the dashboard.
   *
   * "In force today" rather than "the latest": a package dated to start next
   * month is not what the company is paying now, and one that ended last week
   * is not either. Same rule the payroll lookup uses, so the dashboard and a
   * payslip cannot disagree.
   */
  private async payToday(ctx: MetricContext) {
    const { today } = this.today();
    const rows = await this.prisma.employeeSalaryPackage.findMany({
      where: {
        employee: { ...this.scope(ctx), isActive: true },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      select: {
        basicSalary: true,
        components: { select: { kind: true, amount: true } },
      },
    });
    return rows.map((r) => {
      const basic = Number(r.basicSalary);
      let allowances = 0;
      let deductions = 0;
      for (const c of r.components) {
        if (c.kind === 'ALLOWANCE') allowances += Number(c.amount);
        else deductions += Number(c.amount);
      }
      return {
        basic,
        gross: basic + allowances,
        net: basic + allowances - deductions,
      };
    });
  }

  metrics(): MetricDef[] {
    const M = (
      key: string,
      label: string,
      rest: Partial<MetricDef>,
    ): MetricDef => ({
      key,
      label,
      moduleCode: 'HR',
      compute: async () => 0,
      ...rest,
    });

    const sum =
      (pick: (p: { basic: number; gross: number; net: number }) => number) =>
      async (ctx: MetricContext) =>
        (await this.payToday(ctx)).reduce((t, p) => t + pick(p), 0);

    return [
      // ---- headcount ----
      M('hr.employees.total', 'Total Employees', {
        compute: this.count(() => ({})),
      }),
      M('hr.employees.active', 'Active Employees', {
        compute: this.count(() => ({ isActive: true })),
      }),
      M('hr.employees.inactive', 'Inactive Employees', {
        compute: this.count(() => ({ isActive: false })),
      }),
      M('hr.employees.male', 'Male Employees', {
        compute: this.count(() => ({ isActive: true, sex: EmployeeSex.MALE })),
      }),
      M('hr.employees.female', 'Female Employees', {
        compute: this.count(() => ({
          isActive: true,
          sex: EmployeeSex.FEMALE,
        })),
      }),

      // ---- where people stand (the EMPLOYEE_STATUS field) ----
      // Read off the status HR set, not worked out from dates. Two answers to
      // "is this person on probation" is one too many, and the entered one is
      // the answer a manager and a payroll run have to agree on.
      //
      // The three "still here" states count ACTIVE records only, so they add up
      // against Headcount, which is the Active flag. The two "gone" states do
      // not: they are about people who have left, and a leaver whose record has
      // been switched off is exactly who those numbers are for — filtering them
      // to active would report zero the moment somebody tidied up.
      M('hr.employees.onProbation', 'On Probation', {
        compute: this.countByStatus('ON_PROBATION', { activeOnly: true }),
      }),
      M('hr.employees.inService', 'In Service', {
        compute: this.countByStatus('IN_SERVICE', { activeOnly: true }),
      }),
      M('hr.employees.onLeave', 'On Leave', {
        compute: this.countByStatus('ON_LEAVE', { activeOnly: true }),
      }),
      M('hr.employees.resigned', 'Resigned', {
        compute: this.countByStatus('RESIGNED'),
      }),
      M('hr.employees.terminated', 'Terminated', {
        compute: this.countByStatus('TERMINATED'),
      }),
      M('hr.employees.noStatus', 'Status Not Set', {
        // The gap in the data, shown rather than hidden: every count above is
        // only as good as this number is small.
        compute: this.count(() => ({ isActive: true, statusId: null })),
      }),

      // ---- the joining / confirmation cycle ----
      M('hr.employees.confirmed', 'Confirmed (Date Recorded)', {
        // A DIFFERENT question from "In Service": this is whether the
        // confirmation event has been written down, which is a records check
        // rather than a statement of where somebody stands.
        compute: this.count(() => ({
          isActive: true,
          dateOfConfirmation: { not: null },
        })),
      }),
      M('hr.employees.joinedThisMonth', 'Joined This Month', {
        compute: (ctx) =>
          this.prisma.employee.count({
            where: {
              ...this.scope(ctx),
              dateOfJoin: { gte: this.today().monthStart },
            },
          }),
      }),
      M('hr.employees.joinedThisYear', 'Joined This Year', {
        compute: (ctx) =>
          this.prisma.employee.count({
            where: {
              ...this.scope(ctx),
              dateOfJoin: { gte: this.today().yearStart },
            },
          }),
      }),

      // ---- the classification masters ----
      M('hr.designations.active', 'Active Designations', {
        compute: () =>
          this.prisma.hrDesignation.count({ where: { isActive: true } }),
      }),

      // ---- what it costs ----
      M('hr.salary.monthlyBasic', 'Monthly Basic (Total)', {
        format: 'currency',
        compute: sum((p) => p.basic),
      }),
      M('hr.salary.monthlyGross', 'Monthly Gross (Total)', {
        format: 'currency',
        compute: sum((p) => p.gross),
      }),
      M('hr.salary.monthlyNet', 'Monthly Net Payable', {
        format: 'currency',
        compute: sum((p) => p.net),
      }),
      M('hr.salary.averageNet', 'Average Net Salary', {
        format: 'currency',
        compute: async (ctx) => {
          const pay = await this.payToday(ctx);
          if (!pay.length) return 0;
          return pay.reduce((t, p) => t + p.net, 0) / pay.length;
        },
      }),
      M('hr.salary.covered', 'Employees With a Package', {
        // Whoever payroll could actually pay today. The gap against Active
        // Employees is the number somebody has to go and fix.
        compute: async (ctx) => (await this.payToday(ctx)).length,
      }),
    ];
  }
}
