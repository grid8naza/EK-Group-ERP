'use client';

import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
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

const money = (n: number) =>
  n === 0
    ? '-'
    : n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

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
   */
  const componentCols = useMemo(() => {
    const seen = new Map<string, { key: string; name: string; kind: string }>();
    for (const r of rows) {
      for (const c of r.components) {
        const key = `${c.kind}:${c.componentId}`;
        if (!seen.has(key)) {
          seen.set(key, {
            key,
            name: c.componentName ?? `#${c.componentId}`,
            kind: c.kind,
          });
        }
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === 'ALLOWANCE'
          ? -1
          : 1,
    );
  }, [rows]);

  // Fixed columns, then a column per component, then the totals.
  const { columns, weights, groups } = useMemo(() => {
    const fixed = ['Emp. ID', 'Employee', 'Designation', 'Basic'];
    const tail = ['Gross', 'Deductions', 'Net'];
    const cols = [...fixed, ...componentCols.map((c) => c.name), ...tail];
    // The two-tier header says which side of the payslip a column is on —
    // without it a wide register is a row of numbers with no sign.
    const grp: (string | undefined)[] = [
      ...fixed.map(() => undefined),
      ...componentCols.map((c) =>
        c.kind === 'ALLOWANCE' ? 'Allowances' : 'Deductions',
      ),
      ...tail.map(() => undefined),
    ];
    const w = [
      9, 15, 13, 9,
      ...componentCols.map(() => 10),
      10, 10, 10,
    ];
    return { columns: cols, weights: w, groups: grp };
  }, [componentCols]);

  const blocks = useMemo<ReportBlock[]>(() => {
    const keyOf = (r: RegisterRow) =>
      groupBy === 'division'
        ? (r.divisionName ?? '— No division —')
        : groupBy === 'branch'
          ? (r.branchName ?? '— Whole company —')
          : (r.designationName ?? '— No designation —');

    const grouped = new Map<string, RegisterRow[]>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(r);
    }

    return [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([heading, list]) => ({
        heading,
        count: list.length,
        tables: [
          {
            rows: [...list]
              .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
              .map((r) => {
                const byKey = new Map(
                  r.components.map((c) => [
                    `${c.kind}:${c.componentId}`,
                    c.amount,
                  ]),
                );
                return [
                  r.employeeCode,
                  r.employeeName,
                  r.designationName,
                  // No package on this date reads as a dash the whole way
                  // across, not as zeroes — the difference matters.
                  r.packageId ? money(r.basicSalary) : '-',
                  ...componentCols.map((c) =>
                    byKey.has(c.key) ? money(byKey.get(c.key)!) : '-',
                  ),
                  r.packageId ? money(r.grossSalary) : '-',
                  r.packageId ? money(r.totalDeductions) : '-',
                  r.packageId ? money(r.netSalary) : '-',
                ];
              }),
          },
        ],
      }));
  }, [rows, groupBy, componentCols]);

  const totals = useMemo(() => {
    const paid = rows.filter((r) => r.packageId);
    return {
      people: rows.length,
      unpaid: rows.length - paid.length,
      gross: paid.reduce((t, r) => t + r.grossSalary, 0),
      deductions: paid.reduce((t, r) => t + r.totalDeductions, 0),
      net: paid.reduce((t, r) => t + r.netSalary, 0),
    };
  }, [rows]);

  const summary = useMemo(
    () => [
      { label: 'Employees', value: totals.people },
      { label: 'Without a Package', value: totals.unpaid },
      // Raw numbers: the summary strip formats them itself, and a string
      // here would be right-aligned as text and excluded from any rounding.
      { label: 'Total Gross', value: Math.round(totals.gross * 100) / 100 },
      {
        label: 'Total Deductions',
        value: Math.round(totals.deductions * 100) / 100,
      },
      { label: 'Total Net Payable', value: Math.round(totals.net * 100) / 100 },
    ],
    [totals],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Salary Register as at ${data?.on ?? on} - ${totals.people} ${
      totals.people === 1 ? 'employee' : 'employees'
    }`,
    columns,
    weights,
    blocks,
    fileBase: 'salary-register',
    serial: true,
    summary,
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  // Everything from Basic rightwards is money.
  const numericCols = useMemo(
    () => columns.map((_, i) => i).filter((i) => i >= 3),
    [columns],
  );

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
