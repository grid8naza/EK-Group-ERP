'use client';

import { useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input, Select } from '@/components/ui/Field';
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
import type { Category, Company, Store, Supplier } from '@/lib/types';

const ROUTE = '/purchase/reports/purchase-register';

/** One goods-receipt LINE — what arrived, from whom, at what rate. */
interface PurchaseRow {
  id: number;
  documentId: number;
  docNo: string;
  date: string;
  supplierId: number | null;
  supplierName: string | null;
  poRef: string | null;
  reference: string | null;
  storeName: string | null;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  primaryGroupName: string | null;
  parentGroupName: string | null;
  batchNo1: string | null;
  batchNo2: string | null;
  expiryDate: string | null;
  qty: number;
  unitSymbol: string;
  rate: number;
  value: number;
  enteredQty: number | null;
  enteredUnitSymbol: string;
  enteredRate: number | null;
  /** The rate charged (%), and what it came to per head. */
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
  total: number;
}

const asDate = (v: string | null) => (v ? v.slice(0, 10) : '');

/** The first day of the month a report opens on, and today's date. */
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * How the register is read. The rows never change — only what they are gathered
 * under, which is the whole question a purchase report answers: whom did we buy
 * from, what did we buy, or when did it arrive.
 */
const GROUPINGS = [
  { value: 'supplier', label: 'By supplier' },
  { value: 'category', label: 'By category' },
  { value: 'item', label: 'By item' },
  { value: 'document', label: 'By receipt' },
  { value: 'none', label: 'One flat list' },
];

const NO_SUPPLIER = '— No supplier named —';
const UNCATEGORISED = '— Uncategorised —';

const ALL_COLUMNS: ReportColumn<PurchaseRow>[] = [
  { key: 'date', header: 'Date', weight: 10, cell: (r) => asDate(r.date) },
  { key: 'docNo', header: 'GRN', weight: 12, cell: (r) => r.docNo },
  {
    key: 'supplier',
    header: 'Supplier',
    weight: 18,
    cell: (r) => r.supplierName ?? '',
  },
  { key: 'name', header: 'Item', weight: 22, dark: true, cell: (r) => r.name },
  {
    key: 'category',
    header: 'Category',
    weight: 14,
    cell: (r) => r.categoryName ?? '',
  },
  { key: 'batch', header: 'Batch', weight: 12, cell: (r) => r.batchNo1 ?? '' },
  {
    // The supplier's own batch, which is what a recall or a complaint quotes.
    key: 'supplierBatch',
    header: 'Supplier Batch',
    weight: 12,
    cell: (r) => r.batchNo2 ?? '',
  },
  {
    key: 'expiry',
    header: 'Expiry',
    weight: 10,
    cell: (r) => asDate(r.expiryDate),
  },
  { key: 'store', header: 'Store', weight: 12, cell: (r) => r.storeName ?? '' },
  { key: 'poRef', header: 'PO Ref', weight: 12, cell: (r) => r.poRef ?? '' },
  {
    key: 'qty',
    header: 'Qty',
    weight: 10,
    numeric: true,
    cell: (r) => `${qty(r.qty, 3)} ${r.unitSymbol}`.trim(),
  },
  {
    // As INVOICED — 2 cartons at 600 — beside the stock figures below, which
    // are per stock unit. Both are stored on the movement precisely so a
    // purchase report can show the supplier's numbers next to the ledger's.
    key: 'billedQty',
    header: 'Billed Qty',
    weight: 10,
    numeric: true,
    cell: (r) =>
      r.enteredQty == null
        ? ''
        : `${qty(r.enteredQty, 3)} ${r.enteredUnitSymbol}`.trim(),
  },
  {
    key: 'billedRate',
    header: 'Billed Rate',
    weight: 11,
    numeric: true,
    cell: (r) => (r.enteredRate == null ? '' : money(r.enteredRate)),
  },
  {
    key: 'rate',
    header: 'Rate',
    weight: 11,
    numeric: true,
    cell: (r) => money(r.rate),
  },
  {
    // Taxable, i.e. before tax — named Value because that is what it has always
    // been on this report, and what the costing side of the business means by it.
    key: 'value',
    header: 'Value',
    weight: 13,
    numeric: true,
    cell: (r) => money(r.value),
  },
  {
    key: 'gstRate',
    header: 'GST %',
    weight: 8,
    numeric: true,
    cell: (r) => (r.gstRate ? String(r.gstRate) : ''),
  },
  {
    key: 'cgst',
    header: 'CGST',
    weight: 10,
    numeric: true,
    cell: (r) => (r.cgst ? money(r.cgst) : ''),
  },
  {
    key: 'sgst',
    header: 'SGST',
    weight: 10,
    numeric: true,
    cell: (r) => (r.sgst ? money(r.sgst) : ''),
  },
  {
    key: 'igst',
    header: 'IGST',
    weight: 10,
    numeric: true,
    cell: (r) => (r.igst ? money(r.igst) : ''),
  },
  {
    key: 'cess',
    header: 'Cess',
    weight: 9,
    numeric: true,
    cell: (r) => (r.cess ? money(r.cess) : ''),
  },
  {
    key: 'total',
    header: 'Total',
    weight: 13,
    numeric: true,
    cell: (r) => money(r.total),
  },
];

/**
 * The PURCHASE REGISTER — what was bought, from whom, at what rate.
 *
 * Read from the goods receipts, not from a purchase expense account. A receipt
 * debits inventory and the cost reaches the profit and loss when the material is
 * consumed, so the purchase block of the chart is never posted to; and even if
 * it were, a ledger balance could only give a total. The document knows the
 * supplier, the item, the batch, the store and the rate on the day, which is
 * what anyone asking "what did we buy" actually wants.
 */
export default function PurchaseRegisterPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();

  // Opens on the current month: a register is read for a period, and the period
  // anyone means by default is the one they are in.
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [groupBy, setGroupBy] = useState('supplier');

  const query = [
    from ? `from=${from}` : '',
    to ? `to=${to}` : '',
    supplierId ? `supplierId=${supplierId}` : '',
    categoryId ? `categoryId=${categoryId}` : '',
    storeId ? `storeId=${storeId}` : '',
  ]
    .filter(Boolean)
    .join('&');

  const { data, loading } = useFetch<PurchaseRow[]>(
    `/stock-transactions/purchase-register?${query}`,
    [query],
  );
  const { data: suppliers } = useFetch<Supplier[]>('/suppliers');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: stores } = useFetch<Store[]>('/stores');
  const { data: companies } = useFetch<Company[]>('/companies');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const rows = useMemo(() => data ?? [], [data]);
  const total = useMemo(() => rows.reduce((n, r) => n + r.value, 0), [rows]);
  const tax = useMemo(() => rows.reduce((n, r) => n + r.tax, 0), [rows]);

  /** What this row is gathered under, given the chosen grouping. */
  const keyOf = (r: PurchaseRow) => {
    switch (groupBy) {
      case 'supplier':
        return r.supplierName ?? NO_SUPPLIER;
      case 'category':
        return r.categoryName ?? UNCATEGORISED;
      case 'item':
        return r.name;
      case 'document':
        return `${asDate(r.date)} · ${r.docNo}${r.supplierName ? ` · ${r.supplierName}` : ''}`;
      default:
        return '';
    }
  };

  const blocks = useMemo<ReportBlock[]>(() => {
    if (!rows.length) return [];
    if (groupBy === 'none') {
      return [
        {
          tables: [
            {
              rows: rows.map(selected.cells),
              subcount: rows.length,
            },
          ],
        },
      ];
    }
    const buckets = new Map<string, PurchaseRow[]>();
    for (const r of rows) {
      const k = keyOf(r);
      const list = buckets.get(k);
      if (list) list.push(r);
      else buckets.set(k, [r]);
    }
    // Largest spend first — a purchase report is read to see where the money
    // went, and alphabetical order buries that.
    // Every money column that can be added up gets its own subtotal, so a
    // register read for a return foots the same way one read for costing does.
    const columnTotals: { header: string; of: (r: PurchaseRow) => number }[] = [
      { header: 'Value', of: (r: PurchaseRow) => r.value },
      { header: 'CGST', of: (r: PurchaseRow) => r.cgst },
      { header: 'SGST', of: (r: PurchaseRow) => r.sgst },
      { header: 'IGST', of: (r: PurchaseRow) => r.igst },
      { header: 'Cess', of: (r: PurchaseRow) => r.cess },
      { header: 'Total', of: (r: PurchaseRow) => r.total },
    ];
    const totalled = columnTotals.filter((t) =>
      selected.columns.includes(t.header),
    );
    return [...buckets.entries()]
      .map(([label, list]) => ({
        label,
        list,
        spend: list.reduce((n, r) => n + r.value, 0),
      }))
      .sort((a, b) => b.spend - a.spend)
      .map(({ label, list, spend }) => {
        const body = list.map(selected.cells);
        // A subtotal row inside the table rather than only in the heading, so
        // the PRINTED page carries it too — a heading is a caption, and the
        // reader adding up a column wants the answer at the foot of it.
        if (totalled.length) {
          const sums = new Map(
            totalled.map((t) => [t.header, list.reduce((n, r) => n + t.of(r), 0)]),
          );
          body.push(
            selected.columns.map((header, i) => {
              const sum = sums.get(header);
              if (sum != null) return money(sum);
              return i === 0 ? 'Total' : '';
            }),
          );
        }
        return {
          tables: [
            {
              subheading: `${label} — ${money(spend)}`,
              subcount: list.length,
              rows: body,
              shade: [...list.map(() => false), ...(totalled.length ? [true] : [])],
            },
          ],
        };
      });
  }, [rows, groupBy, selected]);

  const summary = useMemo(
    () => [
      { label: 'Receipt lines', value: rows.length },
      {
        label: 'Receipts',
        value: new Set(rows.map((r) => r.documentId)).size,
      },
      {
        label: 'Suppliers',
        value: new Set(rows.map((r) => r.supplierId ?? 0)).size,
      },
      { label: 'Taxable', value: Math.round(total * 100) / 100 },
      { label: 'Tax', value: Math.round(tax * 100) / 100 },
      { label: 'Total', value: Math.round((total + tax) * 100) / 100 },
    ],
    [rows, total, tax],
  );

  const filterNote = [
    supplierId
      ? suppliers?.find((s) => String(s.id) === supplierId)?.name
      : null,
    categoryId
      ? categories?.find((c) => String(c.id) === categoryId)?.name
      : null,
    storeId ? stores?.find((s) => String(s.id) === storeId)?.name : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const spec: ReportSpec = {
    companyName,
    subtitle:
      `Purchase Register - ${from || '…'} to ${to || '…'}` +
      ` - ${rows.length} line${rows.length === 1 ? '' : 's'}, ${money(total)}` +
      (tax > 0 ? ` + ${money(tax)} tax = ${money(total + tax)}` : '') +
      (filterNote ? ` - ${filterNote}` : ''),
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'purchase-register',
    summary,
    numericCols: selected.numericCols,
  };

  const has = rows.length > 0;
  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Purchase Register"
        description="Goods received, by supplier, item and batch — what was bought and at what rate"
        icon={<Receipt className="h-5 w-5" />}
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
            onExcel={() =>
              excelReport(spec, {
                subheadingLabel:
                  GROUPINGS.find((g) => g.value === groupBy)?.label ?? 'Group',
              })
            }
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
          <span className="text-sm text-slate-400">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            options={(suppliers ?? []).map((s) => ({
              value: String(s.id),
              label: `${s.code} · ${s.name}`,
            }))}
            placeholder="All suppliers"
            className="w-56"
          />
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={(categories ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
            placeholder="All categories"
            className="w-48"
          />
          <Select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            options={(stores ?? []).map((s) => ({
              value: String(s.id),
              label: s.name,
            }))}
            placeholder="All stores"
            className="w-44"
          />
          <Select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            options={GROUPINGS}
            className="w-44"
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {rows.length} line{rows.length === 1 ? '' : 's'} · {money(total)}
              {tax > 0 ? ` + ${money(tax)} tax` : ''}
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
            numericCols={selected.numericCols}
            summary={summary}
            collapsible
            emptyText="No goods received in this period — nothing was bought, or the receipts have not been entered."
          />
        </div>
      </div>
    </div>
  );
}
