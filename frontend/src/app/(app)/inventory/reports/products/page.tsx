'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFetch, useLookupValues } from '@/lib/hooks';
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
import { PRODUCT_SOURCE_LABEL, PRODUCT_SOURCE_OPTIONS } from '@/lib/types';
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
  // Discount authority levels, maintained in Inventory > Lookups. One report
  // column per level.
  const discountLevels = useLookupValues('DISCOUNT_LEVEL');

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
      { key: 'unit', header: 'Unit', weight: 7, cell: (p) => p.unit?.symbol ?? p.unit?.code ?? '-' },
      {
        key: 'source',
        header: 'Source',
        weight: 10,
        cell: (p) => PRODUCT_SOURCE_LABEL[p.source] ?? '-',
      },
      {
        key: 'intercoPrice',
        header: 'Intercompany Price',
        weight: 10,
        numeric: true,
        group: 'Intercompany',
        subHeader: 'Price',
        cell: (p) => money(p.intercompanyPrice ?? 0),
      },
      {
        key: 'intercoPct',
        header: 'Intercompany Profit %',
        weight: 10,
        numeric: true,
        group: 'Intercompany',
        subHeader: '%',
        cell: (p) => money(p.intercompanyProfitPct ?? 0),
      },
      {
        key: 'wholesalePrice',
        header: 'Wholesale Price',
        weight: 10,
        numeric: true,
        group: 'Wholesale',
        subHeader: 'Price',
        cell: (p) => money(p.wholesalePrice ?? 0),
      },
      {
        key: 'wholesalePct',
        header: 'Wholesale Profit %',
        weight: 10,
        numeric: true,
        group: 'Wholesale',
        subHeader: '%',
        cell: (p) => money(p.wholesaleProfitPct ?? 0),
      },
      {
        key: 'retailPrice',
        header: 'Retail Price',
        weight: 10,
        numeric: true,
        group: 'Retail',
        subHeader: 'Price',
        cell: (p) => money(p.retailPrice ?? 0),
      },
      {
        key: 'retailPct',
        header: 'Retail Profit %',
        weight: 10,
        numeric: true,
        group: 'Retail',
        subHeader: '%',
        cell: (p) => money(p.retailProfitPct ?? 0),
      },
      // One column per discount level, built from the live lookup rather than
      // fixed — renaming a level or adding a fifth shows up here on its own.
      // They share a group header, so they read as one matrix beside the
      // prices. A level with no row means no discount, shown as "-" rather
      // than 0 so it is distinguishable from a deliberate zero.
      ...discountLevels.map((l) => ({
        key: `discount:${l.id}`,
        header: `${l.label} Discount %`,
        weight: 9,
        numeric: true,
        group: 'Max Discount %',
        subHeader: l.label,
        cell: (p: Product) => {
          const row = p.discounts?.find((d) => d.lookupValueId === l.id);
          return row ? money(row.percentage) : '-';
        },
      })),
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
        cell: (p) => p.boxUnit?.symbol ?? p.boxUnit?.code ?? '-',
      },
      {
        key: 'status',
        header: 'Status',
        weight: 9,
        status: true,
        cell: (p) => (p.isActive ? 'Active' : 'Inactive'),
      },
    ],
    [unitDecimalsById, discountLevels],
  );

  const { hidden, toggle, selected } = useReportColumns(ROUTE, allColumns);

  const [groupFilter, setGroupFilter] = useState('');
  const [source, setSource] = useState(''); // '' | ProductSource
  // What the report blocks are cut by. Grouping by source is what puts in-house
  // production and traded goods in separate, separately-counted sections.
  const [groupBy, setGroupBy] = useState<'group' | 'source'>('group');
  const [packing, setPacking] = useState(''); // '' | 'packed' | 'unpacked'
  const [ingredient, setIngredient] = useState(''); // '' | 'yes' | 'no'
  const [sellable, setSellable] = useState(''); // '' | 'yes' | 'no'

  // Group filter lists only the leaf groups products actually attach to.
  const productGroups = useMemo(
    () => (groups ?? []).filter((g) => g.forProduct && !g.subGroupApplicable),
    [groups],
  );

  // The filtered product list, shared by the blocks and the source summary.
  const filtered = useMemo(() => {
    let list = data ?? [];
    if (groupFilter)
      list = list.filter((p) => String(p.groupId) === groupFilter);
    if (source) list = list.filter((p) => p.source === source);
    if (packing === 'packed') list = list.filter((p) => p.packed);
    else if (packing === 'unpacked') list = list.filter((p) => p.unpacked);
    if (ingredient === 'yes') list = list.filter((p) => p.isIngredient);
    else if (ingredient === 'no') list = list.filter((p) => !p.isIngredient);
    if (sellable === 'yes') list = list.filter((p) => p.canSell);
    else if (sellable === 'no') list = list.filter((p) => !p.canSell);
    return list;
  }, [data, groupFilter, source, packing, ingredient, sellable]);

  // Report cut into blocks by product group or by source, products sorted by
  // name within each. Group blocks are ordered by code so they follow the
  // hierarchy; source blocks put in-house production ahead of traded goods.
  const blocks = useMemo<ReportBlock[]>(() => {
    const keyed = new Map<string, { sort: string; items: Product[] }>();
    for (const p of filtered) {
      const [name, sort] =
        groupBy === 'source'
          ? [PRODUCT_SOURCE_LABEL[p.source] ?? UNGROUPED, p.source]
          : [p.group?.name ?? UNGROUPED, p.group?.code ?? '￿'];
      if (!keyed.has(name)) keyed.set(name, { sort, items: [] });
      keyed.get(name)!.items.push(p);
    }
    return [...keyed.entries()]
      .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
      .map(([heading, { items }]) => ({
        heading,
        count: items.length,
        tables: [
          {
            rows: [...items]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(selected.cells),
          },
        ],
      }));
  }, [filtered, groupBy, selected]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  // The in-house / traded split is carried in the summary whichever way the
  // report is cut, so the two never have to be counted by hand.
  const summary = useMemo(
    () => [
      {
        label: groupBy === 'source' ? 'Total Sources' : 'Total Groups',
        value: blocks.length,
      },
      { label: 'Total Products', value: total },
      {
        label: 'Manufactured',
        value: filtered.filter((p) => p.source === 'MANUFACTURED').length,
      },
      {
        label: 'Purchased',
        value: filtered.filter((p) => p.source === 'PURCHASED').length,
      },
    ],
    [blocks.length, total, filtered, groupBy],
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
    groups: selected.groups,
    subHeaders: selected.subHeaders,
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
            value={source}
            onChange={(e) => setSource(e.target.value)}
            wrapClassName="w-44"
            placeholder="Source: All"
            options={PRODUCT_SOURCE_OPTIONS.map((o) => ({
              value: o.value,
              label: PRODUCT_SOURCE_LABEL[o.value],
            }))}
          />
          <Select
            value={groupBy}
            onChange={(e) =>
              setGroupBy(e.target.value === 'source' ? 'source' : 'group')
            }
            wrapClassName="w-44"
            options={[
              { value: 'group', label: 'Group by: Product group' },
              { value: 'source', label: 'Group by: Source' },
            ]}
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
            groups={selected.groups}
            subHeaders={selected.subHeaders}
            serial
            summary={summary}
            emptyText="No products match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
