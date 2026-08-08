'use client';

import { useMemo, useState } from 'react';
import { ListTree, Search, X } from 'lucide-react';
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
import { PRIMARY_GROUPS, mainGroupLabel } from '@/lib/accountGroups';
import type { AccountGroup, CoaAccount, Company, MainGroup } from '@/lib/types';

const ROUTE = '/accounts/chart-of-accounts';

/**
 * A line of the chart: either a group heading or a postable account. Both go
 * through the same columns, so a heading prints in place among its own accounts
 * rather than being smuggled in as a caption.
 */
type ChartRow =
  | { kind: 'group'; code: string; name: string }
  | ({ kind: 'account' } & CoaAccount);

/**
 * What an entry to this account is asked for.
 *
 * Read off the RESOLVED rules where they were sent, not the account's own boxes:
 * an account that asks for a centre in a company not set up for cost centres
 * asks for nothing, and the chart would be lying to print otherwise.
 */
const costKey = (a: CoaAccount): 'OBJECT' | 'CENTRE' | 'NONE' => {
  const centre = a.entryRules ? a.entryRules.costCenter === 'REQUIRED' : a.hasCostCenter;
  const object = a.entryRules ? a.entryRules.costObject === 'REQUIRED' : a.hasCostObject;
  return object ? 'OBJECT' : centre ? 'CENTRE' : 'NONE';
};

/** The same three answers as one short phrase, for the column. */
const COST_LABEL = {
  OBJECT: 'Centre + Object',
  CENTRE: 'Centre',
  NONE: '—',
} as const;

/** …and as a filter, where the dash needs saying in words. */
const COST_OPTIONS = [
  { value: 'OBJECT', label: 'Centre + Object' },
  { value: 'CENTRE', label: 'Centre only' },
  { value: 'NONE', label: 'Neither' },
];

const costAnalysis = (a: CoaAccount) => COST_LABEL[costKey(a)];

/**
 * The Used Here column, asked as a question.
 *
 * Only worth asking of the whole master: on "accounts this company uses" every
 * row already answers Yes, so the filter would be a control with one useful
 * setting and one that empties the page.
 */
const USED_OPTIONS = [
  { value: 'yes', label: 'Used here' },
  { value: 'no', label: 'Not used here' },
];

/** Blank on a group row — a heading has no nature of its own to state twice. */
const ALL_COLUMNS: ReportColumn<ChartRow>[] = [
  { key: 'code', header: 'Code', weight: 9, cell: (r) => r.code },
  {
    // `dark` rather than `bold`: the account name is what the eye lands on, so
    // it carries the primary text colour, but weight in a chart belongs to the
    // headings and the group rows — an account is a leaf and reads as one.
    key: 'name',
    header: 'Account',
    weight: 30,
    dark: true,
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
  const [primary, setPrimary] = useState(''); // '' = all four
  const [main, setMain] = useState<MainGroup | ''>(''); // '' = every schedule
  const [groupId, setGroupId] = useState(''); // '' = every group in scope
  // What a line to the account is asked for — '' = don't ask.
  const [cost, setCost] = useState(''); // '' | 'OBJECT' | 'CENTRE' | 'NONE'
  // Adopted or not, asked only of the whole master. '' = either.
  const [used, setUsed] = useState(''); // '' | 'yes' | 'no'
  // Typed, and the term actually applied. Held apart so a half-typed word does
  // not rewrite the report — and the printed subtitle names what was searched,
  // which a live box would change under the reader mid-keystroke.
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accounts ?? []).filter((a) => {
      if (scope !== 'all' && !a.adopted) return false;
      if (cost && costKey(a) !== cost) return false;
      // Only the whole master can hold a row that answers No, so the filter is
      // ignored outright on the adopted scope rather than emptying the page.
      if (scope === 'all' && used && (used === 'yes') !== !!a.adopted) return false;
      // Code and name together, so "12001" and "raw mat" both land — and the
      // local name where the company has given the account one, since that is
      // what the reader is looking at in the column.
      if (
        q &&
        !`${a.code} ${a.localName ?? ''} ${a.name}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [accounts, scope, cost, used, search]);

  // The schedules a filter can pick from — those of the chosen primary group,
  // or all nine.
  const mainOptions = useMemo(
    () =>
      (primary
        ? (PRIMARY_GROUPS.find((p) => p.key === primary)?.mains ?? [])
        : PRIMARY_GROUPS.flatMap((p) => p.mains)
      ).map((m) => ({ value: m.key, label: m.label })),
    [primary],
  );

  // The blocks a group filter can pick from — top-level groups only, narrowed
  // by whatever is chosen above it, so the three filters read as one drill-down.
  const groupOptions = useMemo(() => {
    const natures = PRIMARY_GROUPS.find((p) => p.key === primary)?.natures;
    return (groups ?? [])
      .filter(
        (g) =>
          !g.parentGroupId &&
          (!natures || natures.includes(g.nature)) &&
          (!main || g.mainGroup === main),
      )
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((g) => ({ value: String(g.id), label: `${g.code} · ${g.name}` }));
  }, [groups, primary, main]);

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

    for (const section of PRIMARY_GROUPS) {
      // The counts under the summary describe the chart as filtered, so a
      // section filtered out counts nought rather than being left to imply its
      // unfiltered total.
      if (primary && section.key !== primary) {
        perPrimary.push(0);
        continue;
      }
      let inSection = 0;
      // Each schedule of this primary group is its own block — Non-current
      // Assets, then Current Assets — with the numbered blocks under it.
      for (const schedule of section.mains) {
        if (main && schedule.key !== main) continue;

        const roots = all
          .filter(
            (g) =>
              !g.parentGroupId &&
              section.natures.includes(g.nature) &&
              g.mainGroup === schedule.key &&
              (!groupId || String(g.id) === groupId),
          )
          .sort((a, b) => a.code.localeCompare(b.code));

        const tables: ReportTable[] = [];
        let count = 0;

        for (const root of roots) {
          const lines: ChartRow[] = [];
          // Accounts hanging straight off the block, before any sub-group —
          // e.g. Inventories, which has no sub-groups at all.
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

        // An empty schedule is left out rather than printed as a bare heading:
        // on "adopted only" a company can drop whole blocks, and a page of
        // empty headings is not a chart of accounts.
        if (!count) continue;
        blocks.push({
          section: section.label,
          heading: schedule.label,
          count,
          tables,
        });
        inSection += count;
      }

      perPrimary.push(inSection);
    }
    return { blocks, perPrimary };
  }, [groups, rows, selected, primary, main, groupId]);

  /** What the chart is showing, once both filters have had their say. */
  const shown = perPrimary.reduce((n, c) => n + c, 0);

  const summary = useMemo(
    () => [
      // Only the sections actually on the page — a filtered chart listing three
      // zeroes says nothing.
      ...PRIMARY_GROUPS.map((p, i) => ({
        label: p.label,
        value: perPrimary[i] ?? 0,
      })).filter((s) => s.value > 0),
      { label: 'Ledger Accounts', value: shown },
    ],
    [perPrimary, shown],
  );

  const filterNote = [
    primary ? PRIMARY_GROUPS.find((p) => p.key === primary)?.label : null,
    main ? mainGroupLabel(main) : null,
    groupId ? groupOptions.find((o) => o.value === groupId)?.label : null,
    // Worth naming on the printed page: "44 accounts" with the cost filter on
    // is a different statement from "44 accounts".
    cost ? `Asks for: ${COST_OPTIONS.find((o) => o.value === cost)?.label}` : null,
    scope === 'all' && used
      ? USED_OPTIONS.find((o) => o.value === used)?.label
      : null,
    search.trim() ? `Search: ${search.trim()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const spec: ReportSpec = {
    companyName,
    // The subtitle carries the filters, so a printed page says what it is
    // rather than looking like a chart with accounts missing.
    subtitle: `Chart of Accounts - ${shown} ledger accounts${
      scope === 'adopted' ? ' in use' : ' (full master)'
    }${filterNote ? ` - ${filterNote}` : ''}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'chart-of-accounts',
    summary,
    numericCols: selected.numericCols,
  };

  const has = shown > 0;
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
            // The sheet carries the three tiers as columns rather than as
            // banners, so it can be sorted and pivoted like the data it is.
            onExcel={() =>
              excelReport(spec, {
                sectionLabel: 'Primary Group',
                headingLabel: 'Main Group',
                subheadingLabel: 'Group',
              })
            }
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* One line, and it stays one line: every control shrinks (min-w-0 with
            a shared basis) rather than the row wrapping or running past the
            card. The dropdowns render in a portal, so narrowing the trigger
            costs the menu nothing. */}
        <div className="flex items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              // Nothing to ask once the scope is what the company uses.
              if (e.target.value !== 'all') setUsed('');
            }}
            options={[
              { value: 'adopted', label: 'Accounts this company uses' },
              { value: 'all', label: 'The whole master' },
            ]}
            wrapClassName="min-w-0 flex-[1.4] basis-0"
          />
          <Select
            value={primary}
            onChange={(e) => {
              setPrimary(e.target.value);
              // Each list below is drawn from the one above it, so a schedule
              // or group held by the old primary would filter everything away.
              setMain('');
              setGroupId('');
            }}
            options={PRIMARY_GROUPS.map((p) => ({ value: p.key, label: p.label }))}
            placeholder="All primary groups"
            wrapClassName="min-w-0 flex-1 basis-0"
          />
          <Select
            value={main}
            onChange={(e) => {
              setMain(e.target.value as MainGroup | '');
              setGroupId('');
            }}
            options={mainOptions}
            placeholder="All main groups"
            wrapClassName="min-w-0 flex-1 basis-0"
          />
          <Select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            options={groupOptions}
            placeholder="All groups"
            wrapClassName="min-w-0 flex-1 basis-0"
          />
          {/* The Cost Analysis column, asked as a question: which accounts make
              an entry name a division, which go down to the department, and
              which ask for neither. */}
          <Select
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            options={COST_OPTIONS}
            placeholder="Any cost analysis"
            wrapClassName="min-w-0 flex-1 basis-0"
          />
          {/* The Used Here column, asked as a question — of the master only. */}
          {scope === 'all' && (
            <Select
              value={used}
              onChange={(e) => setUsed(e.target.value)}
              options={USED_OPTIONS}
              placeholder="Used or not"
              wrapClassName="min-w-0 flex-1 basis-0"
            />
          )}
          <div className="relative min-w-0 flex-1 basis-0">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // Enter is what a reader reaches for in a search box; the button
              // beside it is the same action for a reader who does not.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setSearch(draft);
                } else if (e.key === 'Escape' && (draft || search)) {
                  setDraft('');
                  setSearch('');
                }
              }}
              placeholder="Code or account"
              aria-label="Search the chart by code or account name"
              className="input-base w-full pr-8"
            />
            {(draft || search) && (
              <button
                type="button"
                title="Clear the search"
                aria-label="Clear the search"
                onClick={() => {
                  setDraft('');
                  setSearch('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            title="Search"
            aria-label="Search"
            onClick={() => setSearch(draft)}
            className="btn-secondary flex-none px-2.5"
          >
            <Search className="h-4 w-4" />
          </button>
          <div className="flex-none">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            darkCol={selected.darkCol}
            // What the page is holding, on the fold row rather than up in the
            // filter bar — that line is full of controls, and this is an answer
            // rather than another question.
            toolbarNote={
              <>
                {shown} account{shown === 1 ? '' : 's'} in {blockCount} group
                {blockCount === 1 ? '' : 's'}
                {filterNote ? ` · ${filterNote}` : ''}
              </>
            }
            // Thirty-six blocks over four sections is more than fits on a
            // screen, so the reader can fold away what they are not looking at.
            collapsible
            emptyText={
              filterNote
                ? 'No accounts under this filter.'
                : 'No accounts to show — this company has adopted none yet.'
            }
          />
        </div>
      </div>
    </div>
  );
}
