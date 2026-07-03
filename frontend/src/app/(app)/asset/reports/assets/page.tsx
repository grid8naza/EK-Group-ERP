'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
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
import type {
  Asset,
  AssetStatus,
  AssetCategory,
  AssetGroup,
  Unit,
  Company,
} from '@/lib/types';

const ROUTE = '/asset/reports/assets';

const UNCATEGORISED = '— Uncategorised —';
const UNGROUPED = '— Ungrouped —';

const STATUS_LABEL: Record<AssetStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  UNDER_REPAIR: 'Under Repair',
};

// "min–max" when a maximum is set, otherwise just the minimum.
const capacityText = (a: Asset) =>
  a.maxCapacity > 0 ? `${a.minCapacity}–${a.maxCapacity}` : String(a.minCapacity);

export default function AssetListReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Asset[]>('/assets');
  const { data: categories } = useFetch<AssetCategory[]>('/asset-categories');
  const { data: groups } = useFetch<AssetGroup[]>('/asset-groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: companies } = useFetch<Company[]>('/companies');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Capacity unit code lookup (the capacity's unit is a Unit-master id).
  const unitCodeById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of units ?? []) m.set(u.id, u.code);
    return m;
  }, [units]);

  // Column model — Code is wide (18-digit positional code stays on one line);
  // the user can show/hide any column via the picker. Rebuilt when the unit map
  // loads so the Unit cell resolves.
  const allColumns = useMemo<ReportColumn<Asset>[]>(
    () => [
      { key: 'code', header: 'Code', weight: 17, cell: (a) => a.code },
      { key: 'name', header: 'Machine', weight: 20, bold: true, cell: (a) => a.name },
      { key: 'capacity', header: 'Capacity', weight: 9, cell: capacityText },
      {
        key: 'unit',
        header: 'Unit',
        weight: 7,
        cell: (a) =>
          a.capacityUnitId != null
            ? (unitCodeById.get(a.capacityUnitId) ?? '-')
            : '-',
      },
      { key: 'brand', header: 'Brand', weight: 11, cell: (a) => a.brand ?? '-' },
      {
        key: 'serial',
        header: 'Serial No',
        weight: 11,
        cell: (a) => a.serialNumber ?? '-',
      },
      {
        key: 'lifeSpan',
        header: 'Life Span',
        weight: 7,
        cell: (a) => a.lifeSpanYears ?? 0,
      },
      {
        key: 'prodLine',
        header: 'Prod. Line',
        weight: 8,
        cell: (a) => (a.isProductionLine ? 'Yes' : 'No'),
      },
      {
        key: 'status',
        header: 'Status',
        weight: 8,
        status: true,
        cell: (a) => STATUS_LABEL[a.status],
      },
    ],
    [unitCodeById],
  );

  const { hidden, toggle, selected } = useReportColumns(ROUTE, allColumns);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  // Group dropdown follows the selected category (all groups when none chosen).
  const filterGroups = useMemo(
    () =>
      (groups ?? []).filter(
        (g) => !categoryFilter || String(g.categoryId) === categoryFilter,
      ),
    [groups, categoryFilter],
  );

  // Build the grouped, sorted report: category (by name) → group (by name) →
  // assets (by name), honouring the two filters and the visible columns.
  const blocks = useMemo<ReportBlock[]>(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((r) => String(r.categoryId) === categoryFilter);
    if (groupFilter)
      rows = rows.filter((r) => String(r.groupId) === groupFilter);

    const byCat = new Map<string, Map<string, Asset[]>>();
    for (const a of rows) {
      const cat = a.category?.name ?? UNCATEGORISED;
      const grp = a.group?.name ?? UNGROUPED;
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const g = byCat.get(cat)!;
      if (!g.has(grp)) g.set(grp, []);
      g.get(grp)!.push(a);
    }

    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([categoryName, groupsMap]) => {
        const tables = [...groupsMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([groupName, assets]) => ({
            subheading: groupName,
            subcount: assets.length,
            rows: [...assets]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(selected.cells),
          }));
        return {
          heading: categoryName,
          count: tables.reduce((n, t) => n + t.rows.length, 0),
          tables,
        };
      });
  }, [data, categoryFilter, groupFilter, selected]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  // Summary reflects the filtered report: category blocks, group tables, assets.
  const summary = useMemo(
    () => [
      { label: 'Total Categories', value: blocks.length },
      {
        label: 'Total Groups',
        value: blocks.reduce((n, b) => n + b.tables.length, 0),
      },
      { label: 'Total Assets', value: total },
    ],
    [blocks, total],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Asset List - ${total} ${total === 1 ? 'asset' : 'assets'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'asset-list-report',
    serial: true,
    summary,
  };

  const has = total > 0;
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
        title="Asset List Report"
        description="Assets grouped by category and group, with print and export"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() =>
              excelReport(spec, { headingLabel: 'Category', subheadingLabel: 'Group' })
            }
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Filters — group cascades from category */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setGroupFilter(''); // reset group when category changes
            }}
            wrapClassName="w-48"
            placeholder="All categories"
            options={(categories ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
          <Select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            wrapClassName="w-48"
            placeholder="All groups"
            options={filterGroups.map((g) => ({
              value: String(g.id),
              label: g.name,
            }))}
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={allColumns.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} asset{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            statusCol={selected.statusCol}
            boldCol={selected.boldCol}
            serial
            summary={summary}
            emptyText="No assets match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
