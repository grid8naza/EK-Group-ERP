'use client';

import { useMemo, useState } from 'react';
import { Network } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
import { ColumnToggle } from '@/components/ui/ColumnToggle';
import {
  ReportView,
  ReportExportButtons,
  useReportColumns,
} from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import { PRIMARY_GROUPS, mainGroupLabel } from '@/lib/accountGroups';
import type { AccountGroup, Company, MainGroup } from '@/lib/types';

const ROUTE = '/accounts/reports/account-groups';

/** A group with the parent it hangs from resolved, so a cell can name it. */
type GroupRow = AccountGroup & { parent?: AccountGroup };

const ALL_COLUMNS: ReportColumn<GroupRow>[] = [
  { key: 'code', header: 'Code', weight: 9, cell: (g) => g.code },
  {
    key: 'name',
    header: 'Group',
    weight: 24,
    dark: true,
    cell: (g) => g.name,
  },
  {
    // The hierarchy as a column rather than as indentation: a printed indent
    // is lost the moment the sheet is sorted, and a parent code is not.
    key: 'under',
    header: 'Under',
    weight: 20,
    cell: (g) => (g.parent ? `${g.parent.code} · ${g.parent.name}` : ''),
  },
  { key: 'nature', header: 'Nature', weight: 10, cell: (g) => g.nature },
  {
    key: 'statement',
    header: 'Statement',
    weight: 13,
    cell: (g) => (g.statement === 'BS' ? 'Balance Sheet' : 'Profit & Loss'),
  },
  { key: 'normalSide', header: 'Dr/Cr', weight: 7, cell: (g) => g.normalSide },
  {
    key: 'tallyGroup',
    header: 'Tally Group',
    weight: 14,
    cell: (g) => g.tallyGroup ?? '',
  },
  {
    key: 'accounts',
    header: 'Accounts',
    weight: 9,
    numeric: true,
    cell: (g) => g.accountCount ?? 0,
  },
  {
    key: 'status',
    header: 'Status',
    weight: 10,
    status: true,
    cell: (g) => (g.isActive ? 'Active' : 'Inactive'),
  },
];

/**
 * The chart's headings on their own — primary group, schedule, block, and the
 * sub-groups under each.
 *
 * The Chart of Accounts report shows the same shape with all 253 accounts
 * hanging off it. This one is what you print to agree the STRUCTURE: whether a
 * block reports under the right schedule, what rolls up into what, and which
 * headings are still empty.
 */
export default function AccountGroupsReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();

  const { data: groups, loading } = useFetch<AccountGroup[]>('/coa/groups');
  const { data: companies } = useFetch<Company[]>('/companies');

  const [primary, setPrimary] = useState('');
  const [main, setMain] = useState<MainGroup | ''>('');
  const [level, setLevel] = useState(''); // '' | 'top' | 'child'

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const mainOptions = useMemo(
    () =>
      (primary
        ? (PRIMARY_GROUPS.find((p) => p.key === primary)?.mains ?? [])
        : PRIMARY_GROUPS.flatMap((p) => p.mains)
      ).map((m) => ({ value: m.key, label: m.label })),
    [primary],
  );

  const { blocks, counts } = useMemo(() => {
    const all = groups ?? [];
    const byId = new Map(all.map((g) => [g.id, g]));
    const blocks: ReportBlock[] = [];
    const counts = { groups: 0, top: 0, children: 0, accounts: 0 };

    for (const section of PRIMARY_GROUPS) {
      if (primary && section.key !== primary) continue;

      for (const schedule of section.mains) {
        if (main && schedule.key !== main) continue;

        const roots = all
          .filter(
            (g) =>
              !g.parentGroupId &&
              section.natures.includes(g.nature) &&
              g.mainGroup === schedule.key,
          )
          .sort((a, b) => a.code.localeCompare(b.code));
        if (!roots.length) continue;

        // Each block, then the sub-groups under it, so the table reads down
        // the hierarchy rather than by code alone.
        const lines: GroupRow[] = [];
        for (const root of roots) {
          if (level !== 'child') lines.push(root);
          if (level === 'top') continue;
          for (const child of all
            .filter((g) => g.parentGroupId === root.id)
            .sort((a, b) => a.code.localeCompare(b.code))) {
            lines.push({ ...child, parent: byId.get(child.parentGroupId!) });
          }
        }
        if (!lines.length) continue;

        counts.groups += lines.length;
        counts.top += lines.filter((g) => !g.parentGroupId).length;
        counts.children += lines.filter((g) => !!g.parentGroupId).length;
        counts.accounts += lines.reduce((n, g) => n + (g.accountCount ?? 0), 0);

        blocks.push({
          section: section.label,
          heading: schedule.label,
          count: lines.length,
          tables: [
            {
              rows: lines.map(selected.cells),
              // A block gets the level-1 highlight; its sub-groups sit plain
              // beneath it.
              shade: lines.map((g) => !g.parentGroupId),
            },
          ],
        });
      }
    }
    return { blocks, counts };
  }, [groups, selected, primary, main, level]);

  const summary = useMemo(
    () => [
      { label: 'Groups', value: counts.groups },
      { label: 'Blocks', value: counts.top },
      { label: 'Sub-groups', value: counts.children },
      { label: 'Accounts Held', value: counts.accounts },
    ],
    [counts],
  );

  const filterNote = [
    primary ? PRIMARY_GROUPS.find((p) => p.key === primary)?.label : null,
    main ? mainGroupLabel(main) : null,
    level === 'top'
      ? 'Blocks only'
      : level === 'child'
        ? 'Sub-groups only'
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const spec: ReportSpec = {
    companyName,
    subtitle: `Account Groups - ${counts.groups} groups${
      filterNote ? ` - ${filterNote}` : ''
    }`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'account-groups',
    summary,
    numericCols: selected.numericCols,
  };

  const has = counts.groups > 0;
  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');
  const onPreview = () => {
    if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
  };
  const onPrint = () => {
    if (!printReport(spec, { autoPrint: true })) popupBlocked();
  };

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Account Groups"
        description="The headings of the chart — primary group, main group, block and the sub-groups under each"
        icon={<Network className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() =>
              excelReport(spec, {
                sectionLabel: 'Primary Group',
                headingLabel: 'Main Group',
              })
            }
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={primary}
            onChange={(e) => {
              setPrimary(e.target.value);
              // The main groups are drawn from the primary, so one held by the
              // old primary would filter everything away.
              setMain('');
            }}
            options={PRIMARY_GROUPS.map((p) => ({
              value: p.key,
              label: p.label,
            }))}
            placeholder="All primary groups"
            className="w-48"
          />
          <Select
            value={main}
            onChange={(e) => setMain(e.target.value as MainGroup | '')}
            options={mainOptions}
            placeholder="All main groups"
            className="w-52"
          />
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            options={[
              { value: 'top', label: 'Blocks only' },
              { value: 'child', label: 'Sub-groups only' },
            ]}
            placeholder="Any level"
            className="w-44"
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({
                key: c.key,
                label: c.header,
              }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {counts.groups} group{counts.groups === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            darkCol={selected.darkCol}
            statusCol={selected.statusCol}
            collapsible
            emptyText={
              filterNote ? 'No groups under this filter.' : 'No groups found.'
            }
          />
        </div>
      </div>
    </div>
  );
}
