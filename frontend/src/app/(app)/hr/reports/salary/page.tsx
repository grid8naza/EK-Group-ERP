'use client';

import { useCallback, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { formatDayMonthYear } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, DateInput } from '@/components/ui/Field';
import { ReportView, ReportExportButtons } from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type ReportBlock,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Company, SalaryComponent } from '@/lib/types';

const ROUTE = '/hr/reports/salary';

/** One employee's line of the register, as the server shapes it. */
interface RegisterRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designationName: string;
  branchName: string | null;
  divisionName: string | null;
  departmentName: string | null;
  packageId: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  basicSalary: number;
  components: SalaryComponent[];
  totalAllowances: number;
  totalDeductions: number;
  grossSalary: number;
  netSalary: number;
}

interface Register {
  on: string;
  rows: RegisterRow[];
}

const amount = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * A figure on an employee's line. Nothing reads as a dash rather than 0.00,
 * because an allowance somebody does not get is not an allowance of nothing.
 */
const money = (n: number) => (n === 0 ? '-' : amount(n));

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The salary register: what everybody is on, on a given day.
 *
 * The columns are NOT fixed. Every allowance and deduction actually used on
 * that date becomes a column of its own — which is the whole reason components
 * are rows against a lookup rather than columns on a table. A company that adds
 * "Night Shift Allowance" tomorrow gets a Night Shift Allowance column here the
 * day somebody is paid it, without anybody touching this file.
 *
 * A DATE rather than "now", because the question a payroll clerk asks is always
 * about a month that may already have closed — and the register resolves it the
 * same way payroll does, so the two cannot disagree.
 *
 * Employees with NO package appear too, with dashes. Dropping them would hide
 * exactly the people payroll is about to fail on.
 */
export default function SalaryRegisterReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');

  const [on, setOn] = useState(today());
  const [groupBy, setGroupBy] = useState('division');

  const { data, loading } = useFetch<Register>(
    `/hr-registers/salary?on=${on}`,
    [on],
  );

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);

  /**
   * The components in use on this date, allowances then deductions, each
   * alphabetical — the dynamic middle of the report.
   *
   * Only the ones somebody is actually paid: a register with a column for every
   * allowance ever defined would be mostly dashes.
   *
   * The head is the lookup value's ALIAS where it has one ("HRA"), and the full
   * label only where it has not. A register is a grid of figures, and
   * "Conveyance Allowance" sets a column three times the width of the numbers
   * beneath it — which is what pushes the totals off the edge of a printed page.
   * The alias is edited in HR → Lookups, so the width of this report is the
   * business's to decide without anybody touching it here.
   */
  const componentCols = useMemo(() => {
    const seen = new Map<
      string,
      { key: string; head: string; name: string; kind: string }
    >();
    for (const r of rows) {
      for (const c of r.components) {
        const key = `${c.kind}:${c.componentId}`;
        if (!seen.has(key)) {
          const name = c.componentName ?? `#${c.componentId}`;
          seen.set(key, {
            key,
            head: c.componentAlias?.trim() || name,
            name,
            kind: c.kind,
          });
        }
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.kind === b.kind
        ? a.head.localeCompare(b.head)
        : a.kind === 'ALLOWANCE'
          ? -1
          : 1,
    );
  }, [rows]);

  // Allowances and deductions kept apart, because each side of the payslip
  // sits next to the total it adds up to.
  const allowanceCols = useMemo(
    () => componentCols.filter((c) => c.kind === 'ALLOWANCE'),
    [componentCols],
  );
  const deductionCols = useMemo(
    () => componentCols.filter((c) => c.kind !== 'ALLOWANCE'),
    [componentCols],
  );

  /**
   * The register reads left to right the way a payslip is worked out:
   * Basic → what is added → Gross → what is taken off → Net. Each total
   * follows the columns that make it, so a reader can check the arithmetic
   * across the row without jumping over the other side of the payslip.
   */
  const { columns, weights, groups } = useMemo(() => {
    const fixed = ['Emp. ID', 'Employee', 'Designation', 'Basic'];
    const cols = [
      ...fixed,
      ...allowanceCols.map((c) => c.head),
      'Gross',
      ...deductionCols.map((c) => c.head),
      'Deductions',
      'Net',
    ];
    // The two-tier header says which side of the payslip a column is on —
    // without it a wide register is a row of numbers with no sign. The
    // totals stay ungrouped: they belong to the row, not to either side.
    const grp: (string | undefined)[] = [
      ...fixed.map(() => undefined),
      ...allowanceCols.map(() => 'Allowances'),
      undefined,
      ...deductionCols.map(() => 'Deductions'),
      undefined,
      undefined,
    ];
    const w = [
      9,
      15,
      13,
      9,
      ...allowanceCols.map(() => 10),
      10,
      ...deductionCols.map(() => 10),
      10,
      10,
    ];
    return { columns: cols, weights: w, groups: grp };
  }, [allowanceCols, deductionCols]);

  /** How the register is being read — what the combo above is set to. */
  const keyOf = useCallback(
    (r: RegisterRow) =>
      groupBy === 'division'
        ? (r.divisionName ?? '— No division —')
        : groupBy === 'branch'
          ? (r.branchName ?? '— Whole company —')
          : (r.designationName ?? '— No designation —'),
    [groupBy],
  );

  /** The rows under each heading, headings in alphabetical order. */
  const grouped = useMemo(() => {
    const map = new Map<string, RegisterRow[]>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, keyOf]);

  /**
   * One employee's line. Written beside the totals line below it, and in the
   * same column order, because the two drifting apart is how a subtotal ends up
   * under the wrong column.
   */
  const rowCells = useCallback(
    (r: RegisterRow) => {
      const byKey = new Map(
        r.components.map((c) => [`${c.kind}:${c.componentId}`, c.amount]),
      );
      return [
        r.employeeCode,
        r.employeeName,
        r.designationName,
        // No package on this date reads as a dash the whole way across, not as
        // zeroes — the difference matters.
        r.packageId ? money(r.basicSalary) : '-',
        ...allowanceCols.map((c) =>
          byKey.has(c.key) ? money(byKey.get(c.key)!) : '-',
        ),
        r.packageId ? money(r.grossSalary) : '-',
        ...deductionCols.map((c) =>
          byKey.has(c.key) ? money(byKey.get(c.key)!) : '-',
        ),
        r.packageId ? money(r.totalDeductions) : '-',
        r.packageId ? money(r.netSalary) : '-',
      ];
    },
    [allowanceCols, deductionCols],
  );

  /**
   * A totals line over a set of employees.
   *
   * Every money column adds up, including a column per allowance and per
   * deduction — a total that skipped them would leave the reader adding the
   * middle of the report by hand. Somebody with no package contributes nothing
   * rather than breaking the sum; a total of zero prints as 0.00, not as the
   * dash a missing figure uses, since "they are paid nothing" and "nobody has
   * said what they are paid" are different answers.
   *
   * The label goes in the Employee column rather than the Emp. ID one: it is
   * the widest column, and the eye is already reading down it.
   */
  const totalCells = useCallback(
    (label: string, list: RegisterRow[]) => {
      const sum = (of: (r: RegisterRow) => number) =>
        list.reduce((t, r) => t + (r.packageId ? of(r) : 0), 0);
      const component = (key: string) =>
        list.reduce(
          (t, r) =>
            t +
            r.components
              .filter((c) => `${c.kind}:${c.componentId}` === key)
              .reduce((n, c) => n + c.amount, 0),
          0,
        );
      return [
        '',
        label,
        '',
        amount(sum((r) => r.basicSalary)),
        ...allowanceCols.map((c) => amount(component(c.key))),
        amount(sum((r) => r.grossSalary)),
        ...deductionCols.map((c) => amount(component(c.key))),
        amount(sum((r) => r.totalDeductions)),
        amount(sum((r) => r.netSalary)),
      ];
    },
    [allowanceCols, deductionCols],
  );

  const blocks = useMemo<ReportBlock[]>(() => {
    const groups: ReportBlock[] = grouped.map(([heading, list]) => {
      const body = [...list]
        .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
        .map(rowCells);
      // The subtotal sits INSIDE the table, at the foot of the rows it adds
      // up — a heading is a caption, and the reader running down a column
      // wants the answer at the bottom of that column.
      body.push(totalCells(`Total — ${heading}`, list));
      return {
        heading,
        count: list.length,
        tables: [
          {
            rows: body,
            shade: [...list.map(() => false), true],
            noSerial: [...list.map(() => false), true],
          },
        ],
      };
    });

    // The grand total stands on its own, under everything, so it is never
    // mistaken for the last group's subtotal — and without a column header,
    // which over a single summed line would only announce a serial number, an
    // employee id and a designation that the line does not have.
    if (rows.length) {
      groups.push({
        tables: [
          {
            rows: [totalCells('Grand Total', rows)],
            shade: [true],
            noSerial: [true],
            noHeader: true,
          },
        ],
      });
    }
    return groups;
  }, [rows, grouped, rowCells, totalCells]);

  /**
   * The headline counts, for the filter bar and the report's own subtitle.
   *
   * The money is not here any more: it is on the grand total line, worked out
   * by the same function that works out every other total on the page.
   */
  const totals = useMemo(
    () => ({
      people: rows.length,
      unpaid: rows.filter((r) => !r.packageId).length,
    }),
    [rows],
  );

  /**
   * The distribution, and only the distribution: how many people are in each
   * group the report is currently cut by — each designation, or each division,
   * or each branch, according to the combo above.
   *
   * The money is NOT repeated here. Every figure the summary used to carry is
   * now on the grand total line, in the column it belongs to and to the same
   * two decimals; saying it twice, once rounded to whole rupees, was two
   * answers to one question.
   */
  const summary = useMemo(
    () =>
      grouped.map(([heading, list]) => ({
        label: heading,
        value: list.length,
      })),
    [grouped],
  );

  /**
   * Everything from Basic rightwards is money, and right-aligned everywhere.
   *
   * Stated rather than left to be inferred: the exports guess only from cells
   * that are raw numbers, and these are pre-formatted strings ("15,500.00")
   * so that every figure carries its two decimals. Without this the screen
   * right-aligned them and the printed page did not.
   */
  const numericCols = useMemo(
    () => columns.map((_, i) => i).filter((i) => i >= 3),
    [columns],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Salary Register as at ${formatDayMonthYear(data?.on ?? on)} - ${totals.people} ${
      totals.people === 1 ? 'employee' : 'employees'
    }`,
    columns,
    weights,
    blocks,
    fileBase: 'salary-register',
    serial: true,
    summary,
    numericCols,
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Salary Register"
        description="What everybody is on, as at a date — a column per allowance and deduction"
        icon={<Wallet className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={() => {
              if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
            }}
            onPrint={() => {
              if (!printReport(spec, { autoPrint: true })) popupBlocked();
            }}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec, { headingLabel: 'Group' })}
            disabled={totals.people === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <DateInput
            label="As at"
            wrapClassName="w-44"
            value={on}
            onChange={setOn}
          />
          <Select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            wrapClassName="w-52"
            sortOptions={false}
            options={[
              { value: 'division', label: 'Group by division' },
              { value: 'branch', label: 'Group by branch' },
              { value: 'designation', label: 'Group by designation' },
            ]}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {totals.people} employee{totals.people === 1 ? '' : 's'}
            {totals.unpaid > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {totals.unpaid} without a package
              </span>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={columns}
            weights={weights}
            groups={groups}
            blocks={blocks}
            loading={loading}
            serial
            numericCols={numericCols}
            summary={summary}
            emptyText="No employees to show for this date."
          />
        </div>
      </div>
    </div>
  );
}
