'use client';

import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { formatDayMonthYear } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DateInput, Select } from '@/components/ui/Field';
import { ReportView, ReportExportButtons } from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type ReportBlock,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Company, RosterRegister, RosterRegisterRow } from '@/lib/types';

const ROUTE = '/hr/reports/roster';

const toTime = (m: number | null) =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hours = (m: number | null) =>
  m === null || m === undefined
    ? '—'
    : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

const today = () => new Date().toISOString().slice(0, 10);

/** Nobody on a shift — the group the report exists to surface. */
const UNROSTERED = '— Not on a shift —';
/** Nobody's team — marked on the branch's own sheet, along with the rest. */
const UNTEAMED = '— Not in a team —';
const NO_BRANCH = '— No branch —';
const NO_DIVISION = '— No division —';
const NO_DEPARTMENT = '— No department —';
const NO_DESIGNATION = '— No designation —';

/**
 * A group named for what its people LACK sits last, whichever way the report is
 * grouped: it is the remainder, not a heading. It is also the group a manager
 * most often opened the report to find, which is why it is never left off.
 */
const REMAINDERS = new Set([
  UNROSTERED,
  UNTEAMED,
  NO_BRANCH,
  NO_DIVISION,
  NO_DEPARTMENT,
  NO_DESIGNATION,
]);
const byHeading = (a: string, b: string) =>
  REMAINDERS.has(a) ? 1 : REMAINDERS.has(b) ? -1 : a.localeCompare(b);

/** Every way the register can be read, and what each groups a row under. */
const GROUPINGS: {
  value: string;
  label: string;
  of: (r: RosterRegisterRow) => string;
}[] = [
  {
    value: 'shift',
    label: 'Group by shift',
    of: (r) => (r.shiftName ? `${r.shiftCode} — ${r.shiftName}` : UNROSTERED),
  },
  { value: 'team', label: 'Group by team', of: (r) => r.teamName ?? UNTEAMED },
  {
    value: 'branch',
    label: 'Group by branch',
    of: (r) => r.branchName ?? NO_BRANCH,
  },
  {
    value: 'division',
    label: 'Group by division',
    of: (r) => r.divisionName ?? NO_DIVISION,
  },
  {
    value: 'department',
    label: 'Group by department',
    of: (r) => r.departmentName ?? NO_DEPARTMENT,
  },
  {
    value: 'designation',
    label: 'Group by designation',
    of: (r) => r.designationName ?? NO_DESIGNATION,
  },
];

/**
 * The shift roster — who is on what, as at a day.
 *
 * A DATE rather than "now", because the question is usually about next Monday:
 * the roster is a dated series, so it answers for any day, past or future.
 *
 * Grouped by shift, and the people nobody has rostered are a group of their own
 * rather than being left off. Those are the ones whose attendance falls back to
 * their own hours or the branch's ordinary day — which is a perfectly good
 * answer, and one a manager should be looking at deliberately.
 */
export default function ShiftRosterReportPage() {
  const { can, activeCompany, activeCompanyId, activeBranchId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');

  const [on, setOn] = useState(today());
  const [groupBy, setGroupBy] = useState('shift');

  const { data, loading } = useFetch<RosterRegister>(`/hr-rosters?on=${on}`, [
    on,
    activeBranchId,
  ]);

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const columns = [
    'Emp. ID',
    'Employee',
    'Designation',
    'Team',
    'Shift',
    'Time In',
    'Time Out',
    'Hours',
    'From',
    'Until',
  ];
  const weights = [9, 17, 15, 13, 12, 8, 8, 8, 5, 5];

  const blocks = useMemo<ReportBlock[]>(() => {
    const keyOf =
      GROUPINGS.find((g) => g.value === groupBy)?.of ?? GROUPINGS[0].of;

    const grouped = new Map<string, RosterRegisterRow[]>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(r);
    }

    return (
      [...grouped.entries()]
        // The remainder sits last: it is what is left, not a heading.
        .sort((a, b) => byHeading(a[0], b[0]))
        .map(([heading, list]) => ({
          heading,
          count: list.length,
          tables: [
            {
              rows: list.map((r) => [
                r.employeeCode,
                r.employeeName,
                r.designationName,
                r.teamName ?? '—',
                // Said on the line, because a team works its shift together
                // and that beats anything on the person's own roster: these
                // hours are the team's, and a reader who took them for an
                // individual line would draw the wrong conclusion from the
                // blank dates beside them.
                r.shiftName
                  ? `${r.shiftCode} — ${r.shiftName}${r.shiftFromTeam ? ' (team)' : ''}`
                  : '—',
                toTime(r.timeIn),
                toTime(r.timeOut),
                hours(r.workMinutes),
                r.effectiveFrom ? formatDayMonthYear(r.effectiveFrom) : '—',
                r.effectiveTo
                  ? formatDayMonthYear(r.effectiveTo)
                  : r.shiftId
                    ? 'until changed'
                    : '—',
              ]),
            },
          ],
        }))
    );
  }, [rows, groupBy]);

  /**
   * The distribution, nothing else — and of whatever the report is grouped by,
   * so the footer counts the same thing the headings do. A summary of shifts
   * under a report grouped by team would be answering a question nobody asked.
   */
  const summary = useMemo(() => {
    const keyOf =
      GROUPINGS.find((g) => g.value === groupBy)?.of ?? GROUPINGS[0].of;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = keyOf(r);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => byHeading(a[0], b[0]))
      .map(([label, value]) => ({ label, value }));
  }, [rows, groupBy]);

  const spec: ReportSpec = {
    companyName,
    subtitle: `Shift Roster as at ${formatDayMonthYear(data?.on ?? on)} · ${rows.length} ${
      rows.length === 1 ? 'employee' : 'employees'
    }`,
    columns,
    weights,
    blocks,
    fileBase: 'shift-roster',
    serial: true,
    summary,
    centerCols: [5, 6, 8, 9],
    numericCols: [7],
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  const unrostered = rows.filter((r) => !r.shiftId).length;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Shift Roster"
        description="Who is on which shift, as at a day — including the people nobody has rostered"
        icon={<Clock className="h-5 w-5" />}
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
            disabled={rows.length === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <DateInput
            label="As at"
            wrapClassName="w-44"
            value={on}
            onChange={(iso) => iso && setOn(iso)}
          />
          <Select
            wrapClassName="w-52"
            sortOptions={false}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            options={GROUPINGS.map((g) => ({
              value: g.value,
              label: g.label,
            }))}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {rows.length} employee{rows.length === 1 ? '' : 's'}
            {unrostered > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {unrostered} not on a shift
              </span>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <ReportView
            columns={columns}
            weights={weights}
            blocks={blocks}
            loading={loading}
            serial
            centerCols={[5, 6, 8, 9]}
            numericCols={[7]}
            summary={summary}
            emptyText="Nobody is on the books at this branch on this day."
          />
        </div>
      </div>
    </div>
  );
}
