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
import type { AccountGroup, CoaAccount, Company } from '@/lib/types';

const ROUTE = '/accounts/chart-of-accounts';

/** What an entry to this account is asked for, in one short phrase. */
const costAnalysis = (a: CoaAccount) => {
  const centre = a.entryRules ? a.entryRules.costCenter === 'REQUIRED' : a.hasCostCenter;
  const object = a.entryRules ? a.entryRules.costObject === 'REQUIRED' : a.hasCostObject;
  if (object) return 'Centre + Object';
  if (centre) return 'Centre';
  return '—';
};

const ALL_COLUMNS: ReportColumn<CoaAccount>[] = [
  { key: 'code', header: 'Code', weight: 9, cell: (a) => a.code },
  {
    key: 'name',
    header: 'Account',
    weight: 30,
    bold: true,
    cell: (a) => a.localName ?? a.name,
  },
  { key: 'nature', header: 'Nature', weight: 10, cell: (a) => a.nature },
  {
    key: 'statement',
    header: 'Statement',
    weight: 12,
    cell: (a) => (a.statement === 'BS' ? 'Balance Sheet' : 'Profit & Loss'),
  },
  { key: 'normalSide', header: 'Dr/Cr', weight: 7, cell: (a) => a.normalSide },
  {
    key: 'tallyGroup',
    header: 'Tally Group',
    weight: 15,
    cell: (a) => a.tallyGroup ?? '',
  },
  {
    key: 'costAnalysis',
    header: 'Cost Analysis',
    weight: 12,
    cell: costAnalysis,
  },
  {
    key: 'adopted',
    header: 'Used Here',
    weight: 9,
    cell: (a) => (a.adopted ? 'Yes' : 'No'),
  },
];

/**
 * The Chart of Accounts read the way a statement is: top-level block, the
 * sub-groups beneath it, and the postable accounts under each.
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

  const blocks = useMemo<ReportBlock[]>(() => {
    const all = groups ?? [];
    if (!all.length) return [];

    const byGroup = new Map<number, CoaAccount[]>();
    for (const a of rows) {
      const list = byGroup.get(a.groupId);
      if (list) list.push(a);
      else byGroup.set(a.groupId, [a]);
    }
    const sorted = (g: AccountGroup) =>
      (byGroup.get(g.id) ?? []).sort((x, y) => x.code.localeCompare(y.code));

    const roots = all
      .filter((g) => !g.parentGroupId)
      .sort((a, b) => a.code.localeCompare(b.code));

    const out: ReportBlock[] = [];
    for (const root of roots) {
      const children = all
        .filter((g) => g.parentGroupId === root.id)
        .sort((a, b) => a.code.localeCompare(b.code));

      const tables: ReportTable[] = [];
      let count = 0;

      // Accounts hanging straight off the block, before any sub-group — e.g.
      // Inventories, which has no sub-groups at all.
      const direct = sorted(root);
      if (direct.length) {
        tables.push({ rows: direct.map(selected.cells) });
        count += direct.length;
      }
      for (const child of children) {
        const kids = sorted(child);
        if (!kids.length) continue;
        tables.push({
          subheading: `${child.code} · ${child.name}`,
          subcount: kids.length,
          rows: kids.map(selected.cells),
        });
        count += kids.length;
      }
      // An empty block is left out rather than printed as a bare heading: on
      // "adopted only" most companies drop whole blocks, and a page of empty
      // headings is not a chart of accounts.
      if (!count) continue;
      out.push({ heading: `${root.code} · ${root.name}`, count, tables });
    }
    return out;
  }, [groups, rows, selected]);

  const summary = useMemo(
    () => [
      { label: 'Groups', value: blocks.length },
      {
        label: 'Sub-groups',
        value: blocks.reduce(
          (n, b) => n + b.tables.filter((t) => t.subheading).length,
          0,
        ),
      },
      { label: 'Ledger Accounts', value: rows.length },
    ],
    [blocks, rows],
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

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Chart of Accounts"
        description="The account master by group, sub-group and ledger — the Annexure D chart as it reads for this company"
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
              {rows.length} account{rows.length === 1 ? '' : 's'} in{' '}
              {blocks.length} group{blocks.length === 1 ? '' : 's'}
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
