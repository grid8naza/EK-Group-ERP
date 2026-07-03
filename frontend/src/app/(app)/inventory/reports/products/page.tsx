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
  money,
  qty,
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Product, Group, Unit, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/products';
const UNGROUPED = '— Ungrouped —';

export default function ProductsReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Product[]>('/products');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: companies } = useFetch<Company[]>('/companies');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // A stock unit's decimal places (from the Unit master) drives quantity
  // precision; prices/percentages are always two decimals.
  const unitDecimalsById = useMemo(() => {
    const m = new Map<number, number>();
    for (const u of units ?? []) m.set(u.id, u.decimalPlaces);
    return m;
  }, [units]);

  // Rows are grouped by product group (the group is the block heading), so it is
  // not repeated as a column. Rebuilt when the unit map loads so Box Quantity
  // resolves its unit's decimals.
  const allColumns = useMemo<ReportColumn<Product>[]>(
    () => [
      { key: 'code', header: 'Code', weight: 11, cell: (p) => p.code },
      { key: 'name', header: 'Name', weight: 20, bold: true, cell: (p) => p.name },
      {
        key: 'cost',
        header: 'Cost Price',
        weight: 9,
        numeric: true,
        cell: (p) => money(p.costPrice ?? 0),
      },
      { key: 'unit', header: 'Unit', weight: 7, cell: (p) => p.unit?.code ?? '-' },
      {
        key: 'intercoPrice',
        header: 'Intercompany Price',
        weight: 10,
        numeric: true,
        cell: (p) => money(p.intercompanyPrice ?? 0),
      },
      {
        key: 'intercoPct',
        header: 'Intercompany Profit %',
        weight: 10,
        numeric: true,
        cell: (p) => money(p.intercompanyProfitPct ?? 0),
      },
      {
        key: 'wholesalePrice',
        header: 'Wholesale Price',
        weight: 10,
        numeric: true,
        cell: (p) => money(p.wholesalePrice ?? 0),
      },
      {
        key: 'wholesalePct',
        header: 'Wholesale Profit %',
        weight: 10,
        numeric: true,
        cell: (p) => money(p.wholesaleProfitPct ?? 0),
      },
      {
        key: 'retailPrice',
        header: 'Retail Price',
        weight: 10,
        numeric: true,
        cell: (p) => money(p.retailPrice ?? 0),
      },
      {
        key: 'retailPct',
        header: 'Retail Profit %',
        weight: 10,
        numeric: true,
        cell: (p) => money(p.retailProfitPct ?? 0),
      },
      {
        key: 'boxQty',
        header: 'Box Quantity',
        weight: 8,
        numeric: true,
        cell: (p) => qty(p.boxQty ?? 0, unitDecimalsById.get(p.unitId) ?? 0),
      },
      {
        key: 'boxUnit',
        header: 'Box Unit',
        weight: 8,
        cell: (p) => p.boxUnit?.code ?? '-',
      },
      {
        key: 'status',
        header: 'Status',
        weight: 9,
        status: true,
        cell: (p) => (p.isActive ? 'Active' : 'Inactive'),
      },
    ],
    [unitDecimalsById],
  );

  const { hidden, toggle, selected } = useReportColumns(ROUTE, allColumns);

  const [groupFilter, setGroupFilter] = useState('');
  const [packing, setPacking] = useState(''); // '' | 'packed' | 'unpacked'
  const [ingredient, setIngredient] = useState(''); // '' | 'yes' | 'no'
  const [sellable, setSellable] = useState(''); // '' | 'yes' | 'no'

  // Group filter lists only the leaf groups products actually attach to.
  const productGroups = useMemo(
    () => (groups ?? []).filter((g) => g.forProduct && !g.subGroupApplicable),
    [groups],
  );

  // Report grouped by product group (heading), products sorted by name within
  // each; groups ordered by code so they follow the hierarchy.
  const blocks = useMemo<ReportBlock[]>(() => {
    let list = data ?? [];
    if (groupFilter)
      list = list.filter((p) => String(p.groupId) === groupFilter);
    if (packing === 'packed') list = list.filter((p) => p.packed);
    else if (packing === 'unpacked') list = list.filter((p) => p.unpacked);
    if (ingredient === 'yes') list = list.filter((p) => p.isIngredient);
    else if (ingredient === 'no') list = list.filter((p) => !p.isIngredient);
    if (sellable === 'yes') list = list.filter((p) => p.canSell);
    else if (sellable === 'no') list = list.filter((p) => !p.canSell);

    const byGroup = new Map<string, { code: string; items: Product[] }>();
    for (const p of list) {
      const name = p.group?.name ?? UNGROUPED;
      if (!byGroup.has(name))
        byGroup.set(name, { code: p.group?.code ?? '￿', items: [] });
      byGroup.get(name)!.items.push(p);
    }
    return [...byGroup.entries()]
      .sort((a, b) => a[1].code.localeCompare(b[1].code))
      .map(([groupName, { items }]) => ({
        heading: groupName,
        count: items.length,
        tables: [
          {
            rows: [...items]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(selected.cells),
          },
        ],
      }));
  }, [data, groupFilter, packing, ingredient, sellable, selected]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  const summary = useMemo(
    () => [
      { label: 'Total Groups', value: blocks.length },
      { label: 'Total Products', value: total },
    ],
    [blocks.length, total],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Products List - ${total} ${total === 1 ? 'product' : 'products'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'products-report',
    serial: true,
    summary,
    numericCols: selected.numericCols,
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
        title="Products List Report"
        description="Products grouped by product group, with pricing, profit margins and packing"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec, { headingLabel: 'Group' })}
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            wrapClassName="w-48"
            placeholder="All groups"
            options={productGroups.map((g) => ({
              value: String(g.id),
              label: g.name,
            }))}
          />
          <Select
            value={packing}
            onChange={(e) => setPacking(e.target.value)}
            wrapClassName="w-40"
            placeholder="Packing: All"
            options={[
              { value: 'packed', label: 'Packed' },
              { value: 'unpacked', label: 'Unpacked' },
            ]}
          />
          <Select
            value={ingredient}
            onChange={(e) => setIngredient(e.target.value)}
            wrapClassName="w-44"
            placeholder="Recipe Ingredient: All"
            options={[
              { value: 'yes', label: 'Ingredient' },
              { value: 'no', label: 'Not ingredient' },
            ]}
          />
          <Select
            value={sellable}
            onChange={(e) => setSellable(e.target.value)}
            wrapClassName="w-40"
            placeholder="Sellable: All"
            options={[
              { value: 'yes', label: 'Sellable' },
              { value: 'no', label: 'Not sellable' },
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={allColumns.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} product{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            statusCol={selected.statusCol}
            boldCol={selected.boldCol}
            numericCols={selected.numericCols}
            serial
            summary={summary}
            emptyText="No products match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
