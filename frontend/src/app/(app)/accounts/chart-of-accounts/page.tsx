'use client';

import { useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
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
  type ReportTable,
} from '@/lib/reportDoc';
import type {
  AccountGroup,
  AccountNature,
  CoaAccount,
  Company,
} from '@/lib/types';

const ROUTE = '/accounts/chart-of-accounts';

/**
 * The four primary groups every account ultimately rolls into, in the order the
 * statements are read: the balance sheet pair first, then the two that make up
 * the profit and loss.
 *
 * EQUITY sits under Liabilities rather than forming a fifth section — capital
 * and reserves are what the business owes its owners, which is why they carry a
 * credit balance and sit on that side of the balance sheet (and why Tally shows
 * Capital Account there too).
 */
const PRIMARY_GROUPS: { key: string; label: string; natures: AccountNature[] }[] =
  [
    { key: 'ASSET', label: 'Assets', natures: ['ASSET'] },
    { key: 'LIABILITY', label: 'Liabilities', natures: ['LIABILITY', 'EQUITY'] },
    { key: 'INCOME', label: 'Income', natures: ['INCOME'] },
    { key: 'EXPENSE', label: 'Expenses', natures: ['EXPENSE'] },
  ];

/**
 * A line of the chart: either a group heading or a postable account. Both go
 * through the same columns, so a heading prints in place among its own accounts
 * rather than being smuggled in as a caption.
 */
type ChartRow =
  | { kind: 'group'; code: string; name: string }
  | ({ kind: 'account' } & CoaAccount);

/** What an entry to this account is asked for, in one short phrase. */
const costAnalysis = (a: CoaAccount) => {
  const centre = a.entryRules ? a.entryRules.costCenter === 'REQUIRED' : a.hasCostCenter;
  const object = a.entryRules ? a.entryRules.costObject === 'REQUIRED' : a.hasCostObject;
  if (object) return 'Centre + Object';
  if (centre) return 'Centre';
  return '—';
};

/** Blank on a group row — a heading has no nature of its own to state twice. */
const ALL_COLUMNS: ReportColumn<ChartRow>[] = [
  { key: 'code', header: 'Code', weight: 9, cell: (r) => r.code },
  {
    key: 'name',
    header: 'Account',
    weight: 30,
    bold: true,
    cell: (r) => (r.kind === 'group' ? r.name : (r.localName ?? r.name)),
  },
  {
    key: 'nature',
    header: 'Nature',
    weight: 10,
    cell: (r) => (r.kind === 'group' ? '' : r.nature),
  },
  {
    key: 'statement',
    header: 'Statement',
    weight: 12,
    cell: (r) =>
      r.kind === 'group' ? '' : r.statement === 'BS' ? 'Balance Sheet' : 'Profit & Loss',
  },
  {
    key: 'normalSide',
    header: 'Dr/Cr',
    weight: 7,
    cell: (r) => (r.kind === 'group' ? '' : r.normalSide),
  },
  {
    key: 'tallyGroup',
    header: 'Tally Group',
    weight: 15,
    cell: (r) => (r.kind === 'group' ? '' : (r.tallyGroup ?? '')),
  },
  {
    key: 'costAnalysis',
    header: 'Cost Analysis',
    weight: 12,
    cell: (r) => (r.kind === 'group' ? '' : costAnalysis(r)),
  },
  {
    key: 'adopted',
    header: 'Used Here',
    weight: 9,
    cell: (r) => (r.kind === 'group' ? '' : r.adopted ? 'Yes' : 'No'),
  },
];

/**
 * The Chart of Accounts read the way a statement is: primary group, the blocks
 * beneath it, the sub-groups under those, and the postable accounts at the
 * bottom.
 *
 * This is the master as a REPORT — nothing is edited here. Groups and accounts
 * are maintained on their own screens; what this adds is the shape, which is
 * exactly what a printed chart is for.
 */
export default function ChartOfAccountsReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();

  const { data: accounts, loading } = useFetch<CoaAccount[]>('/coa/accounts');
  const { data: groups } = useFetch<AccountGroup[]>('/coa/groups');
  const { data: companies } = useFetch<Company[]>('/companies');

  // A chart is normally read for ONE company's books, so it opens on what this
  // company has adopted; the whole master is a filter away.
  const [scope, setScope] = useState('adopted'); // 'adopted' | 'all'

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const rows = useMemo(
    () => (accounts ?? []).filter((a) => scope === 'all' || a.adopted),
    [accounts, scope],
  );

  const { blocks, perPrimary } = useMemo(() => {
    const all = groups ?? [];
    const empty = { blocks: [] as ReportBlock[], perPrimary: [] as number[] };
    if (!all.length) return empty;

    const byGroup = new Map<number, CoaAccount[]>();
    for (const a of rows) {
      const list = byGroup.get(a.groupId);
      if (list) list.push(a);
      else byGroup.set(a.groupId, [a]);
    }
    const accountsOf = (g: AccountGroup): ChartRow[] =>
      (byGroup.get(g.id) ?? [])
        .sort((x, y) => x.code.localeCompare(y.code))
        .map((a) => ({ kind: 'account', ...a }) as ChartRow);

    const blocks: ReportBlock[] = [];
    const perPrimary: number[] = [];

    for (const primary of PRIMARY_GROUPS) {
      // The blocks of this primary group — 10000 Fixed Assets, 12000
      // Inventories, and so on.
      const roots = all
        .filter((g) => !g.parentGroupId && primary.natures.includes(g.nature))
        .sort((a, b) => a.code.localeCompare(b.code));

      const tables: ReportTable[] = [];
      let count = 0;

      for (const root of roots) {
        const lines: ChartRow[] = [];
        // Accounts hanging straight off the block, before any sub-group — e.g.
        // Inventories, which has no sub-groups at all.
        lines.push(...accountsOf(root));
        for (const child of all
          .filter((g) => g.parentGroupId === root.id)
          .sort((a, b) => a.code.localeCompare(b.code))) {
          const kids = accountsOf(child);
          if (!kids.length) continue;
          // The sub-group heads its own accounts as a row of the table, so it
          // keeps its place in the chart when the report is printed.
          lines.push({ kind: 'group', code: child.code, name: child.name });
          lines.push(...kids);
        }
        const held = lines.filter((l) => l.kind === 'account').length;
        if (!held) continue;
        tables.push({
          subheading: `${root.code} · ${root.name}`,
          subcount: held,
          rows: lines.map(selected.cells),
          shade: lines.map((l) => l.kind === 'group'),
        });
        count += held;
      }

      perPrimary.push(count);
      // An empty section is left out rather than printed as a bare heading: on
      // "adopted only" a company can drop whole blocks, and a page of empty
      // headings is not a chart of accounts.
      if (!count) continue;
      blocks.push({ heading: primary.label, count, tables });
    }
    return { blocks, perPrimary };
  }, [groups, rows, selected]);

  const summary = useMemo(
    () => [
      ...PRIMARY_GROUPS.map((p, i) => ({
        label: p.label,
        value: perPrimary[i] ?? 0,
      })),
      { label: 'Ledger Accounts', value: rows.length },
    ],
    [perPrimary, rows],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Chart of Accounts - ${rows.length} ledger accounts${
      scope === 'adopted' ? ' in use' : ' (full master)'
    }`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'chart-of-accounts',
    summary,
    numericCols: selected.numericCols,
  };

  const has = rows.length > 0;
  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');
  const onPreview = () => {
    if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
  };
  const onPrint = () => {
    if (!printReport(spec, { autoPrint: true })) popupBlocked();
  };

  const blockCount = blocks.reduce((n, b) => n + b.tables.length, 0);

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Chart of Accounts"
        description="The account master by primary group, block, sub-group and ledger — the Annexure D chart as it reads for this company"
        icon={<ListTree className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec)}
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            options={[
              { value: 'adopted', label: 'Accounts this company uses' },
              { value: 'all', label: 'The whole master' },
            ]}
            className="w-64"
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {rows.length} account{rows.length === 1 ? '' : 's'} in {blockCount}{' '}
              group{blockCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            boldCol={selected.boldCol}
            emptyText="No accounts to show — this company has adopted none yet."
          />
        </div>
      </div>
    </div>
  );
}
