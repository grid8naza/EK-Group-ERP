'use client';

import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
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
import type {
  Branch,
  Company,
  CostCenter,
  CostObject,
  Employee,
  HrTeam,
} from '@/lib/types';

const ROUTE = '/hr/reports/teams';

const today = () => new Date().toISOString().slice(0, 10);

/** Nobody's team — the group the report exists as much to surface as the rest. */
const UNTEAMED = '— Not in a team —';

/**
 * The team register — who is in which team on a day, under whom.
 *
 * A DATE rather than "now", because membership is a dated series: somebody who
 * moved from the Oven Team to Packing in March was in the Oven Team all of
 * February, and a register that could not say so would be no use for reading
 * back a month that has already been marked. It answers for any day, past or
 * future — including next Monday, when the new arrangement starts.
 *
 * The people in NO team are a group of their own rather than being left off.
 * They are marked on the branch's own sheet, which is a perfectly good answer
 * and one somebody should be looking at deliberately rather than discovering.
 *
 * Each line carries the division and department of the work THAT TEAM has the
 * person doing, which is the team's own answer and not the one on the employee
 * record — the same distinction the Team form makes.
 */
export default function TeamRegisterReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');

  const [on, setOn] = useState(today());
  const [groupBy, setGroupBy] = useState('team');

  const { data: teams, loading } = useFetch<HrTeam[]>(
    '/hr-teams?branchId=all',
    [activeCompanyId],
  );
  const { data: employees } = useFetch<Employee[]>('/hr-employees', [
    activeCompanyId,
  ]);
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: costCenters } = useFetch<CostCenter[]>('/cost-centers');
  const { data: costObjects } = useFetch<CostObject[]>('/cost-objects');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const branchNames = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b.name])),
    [branches],
  );
  const divisionNames = useMemo(
    () => new Map((costCenters ?? []).map((c) => [c.id, c.name])),
    [costCenters],
  );
  const departmentNames = useMemo(
    () => new Map((costObjects ?? []).map((o) => [o.id, o.name])),
    [costObjects],
  );

  const columns = [
    'Emp. ID',
    'Employee',
    'Designation',
    'Division',
    'Department',
    'From',
    'Until',
  ];
  const weights = [10, 20, 17, 15, 15, 11.5, 11.5];

  /** One line per person, with the team they were in on the day. */
  const lines = useMemo(() => {
    const spells = (teams ?? []).flatMap((t) =>
      t.members
        .filter(
          (m) =>
            m.effectiveFrom <= on && (!m.effectiveTo || m.effectiveTo >= on),
        )
        .map((m) => ({
          team: t,
          member: m,
          branchName: t.branchId
            ? (branchNames.get(t.branchId) ?? '—')
            : 'The whole company',
        })),
    );
    const inATeam = new Set(spells.map((s) => s.member.id));

    // Everybody else who was on the books that day. The employment window, not
    // the Active flag — the same rule the attendance sheet keeps.
    const loose = (employees ?? [])
      .filter(
        (e) =>
          e.dateOfJoin <= on &&
          (e.lastWorkingDay ? e.lastWorkingDay >= on : e.isActive) &&
          !inATeam.has(e.id),
      )
      .map((e) => ({
        team: null,
        employee: e,
        branchName: e.branchName ?? '—',
      }));

    return { spells, loose };
  }, [teams, employees, on, branchNames]);

  const blocks = useMemo<ReportBlock[]>(() => {
    const grouped = new Map<string, string[][]>();
    const push = (heading: string, row: string[]) => {
      if (!grouped.has(heading)) grouped.set(heading, []);
      grouped.get(heading)!.push(row);
    };

    for (const { team, member, branchName } of lines.spells) {
      const heading =
        groupBy === 'team'
          ? `${team.name} — ${team.leaderName}${
              team.shiftCode ? ` · ${team.shiftCode} ${team.shiftName}` : ''
            }`
          : branchName;
      push(heading, [
        member.code,
        member.name,
        member.designationName,
        member.costCenterId
          ? (divisionNames.get(member.costCenterId) ?? '—')
          : '—',
        member.costObjectId
          ? (departmentNames.get(member.costObjectId) ?? '—')
          : '—',
        formatDayMonthYear(member.effectiveFrom),
        member.effectiveTo
          ? formatDayMonthYear(member.effectiveTo)
          : 'until changed',
      ]);
    }

    for (const { employee, branchName } of lines.loose) {
      push(groupBy === 'team' ? UNTEAMED : branchName, [
        employee.code,
        employee.name,
        employee.designationName,
        // Their OWN division and department: with no membership there is no
        // team answer, and a blank would read as nobody having said.
        employee.divisionName ?? '—',
        employee.departmentName ?? '—',
        '—',
        '—',
      ]);
    }

    return (
      [...grouped.entries()]
        // The unteamed sit last: they are the remainder, not a heading.
        .sort((a, b) =>
          a[0] === UNTEAMED
            ? 1
            : b[0] === UNTEAMED
              ? -1
              : a[0].localeCompare(b[0]),
        )
        .map(([heading, rows]) => ({
          heading,
          count: rows.length,
          tables: [{ rows }],
        }))
    );
  }, [lines, groupBy, divisionNames, departmentNames]);

  /** How many answer to each leader — the distribution, nothing else. */
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { team } of lines.spells) {
      counts.set(team.name, (counts.get(team.name) ?? 0) + 1);
    }
    if (lines.loose.length) counts.set(UNTEAMED, lines.loose.length);
    return [...counts.entries()]
      .sort((a, b) =>
        a[0] === UNTEAMED
          ? 1
          : b[0] === UNTEAMED
            ? -1
            : a[0].localeCompare(b[0]),
      )
      .map(([label, value]) => ({ label, value }));
  }, [lines]);

  const total = lines.spells.length + lines.loose.length;

  const spec: ReportSpec = {
    companyName,
    subtitle: `Team Register as at ${formatDayMonthYear(on)} · ${total} ${
      total === 1 ? 'employee' : 'employees'
    }`,
    columns,
    weights,
    blocks,
    fileBase: 'team-register',
    serial: true,
    summary,
    centerCols: [5, 6],
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  /** A team with nobody in it marks an empty sheet — worth noticing. */
  const emptyTeams = (teams ?? []).filter(
    (t) =>
      t.isActive &&
      !t.members.some(
        (m) => m.effectiveFrom <= on && (!m.effectiveTo || m.effectiveTo >= on),
      ),
  );

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Team Register"
        description="Who is in which team on a day, under whom — and everybody in none"
        icon={<Users className="h-5 w-5" />}
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
            onExcel={() => excelReport(spec, { headingLabel: 'Team' })}
            disabled={total === 0}
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
            options={[
              { value: 'team', label: 'Group by team' },
              { value: 'branch', label: 'Group by branch' },
            ]}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {total} employee{total === 1 ? '' : 's'}
            {lines.loose.length > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {lines.loose.length} in no team
              </span>
            )}
            {emptyTeams.length > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {emptyTeams.length} team
                {emptyTeams.length === 1 ? '' : 's'} with nobody in
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
            centerCols={[5, 6]}
            summary={summary}
            emptyText="Nobody is on the books on this day."
          />
        </div>
      </div>
    </div>
  );
}
