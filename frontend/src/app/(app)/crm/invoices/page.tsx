'use client';

import { useMemo, useState } from 'react';
import {
  ReceiptIndianRupee,
  Plus,
  ArrowLeft,
  Printer,
  FileDown,
  Sheet,

  Check,
  Ban,
  QrCode,
  Truck,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { FormSection } from '@/components/ui/FormSection';
import { Input, Select } from '@/components/ui/Field';
import {
  buildInvoiceHtml,
  openDocument,
  type InvoiceDocInput,
} from '@/lib/invoiceDoc';
import { excelReport, type ReportSpec } from '@/lib/reportDoc';
import type { Company } from '@/lib/types';

const ROUTE = '/crm/invoices';

type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';
type EInvoiceStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'REGISTERED'
  | 'CANCELLED'
  | 'FAILED';

interface InvoiceLine {
  id: number;
  description: string;
  hsnCode: string | null;
  quantity: number;
  unitSymbol: string | null;
  rate: number;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  lineTotal: number;
}

interface Invoice {
  id: number;
  companyId: number;
  branchId: number | null;
  invoiceNo: string;
  finYear: string;
  invoiceDate: string;
  customerId: number;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  deliveryNoteId: number | null;
  deliveryNoteNo: string | null;
  contractNo: string | null;
  supplyType: string;
  placeOfSupply: string | null;
  placeOfSupplyCode: string;
  isInterState: boolean;
  reverseCharge: boolean;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  roundOff: number;
  grandTotal: number;
  totalTax: number;
  einvoiceStatus: EInvoiceStatus;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  signedQrCode: string | null;
  ewbNo: string | null;
  ewbDate: string | null;
  distanceKm: number | null;
  transportMode: string | null;
  transporterName: string | null;
  vehicleNo: string | null;
  status: InvoiceStatus;
  notes: string | null;
  lines: InvoiceLine[];
}

interface UnbilledNote {
  id: number;
  docNo: string;
  docDate: string;
  customerId: number | null;
  customerName: string | null;
}

const money = (n: number) =>
  (n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const statusColor = (s: InvoiceStatus) =>
  s === 'ISSUED' ? 'green' : s === 'CANCELLED' ? 'red' : 'blue';

const eInvoiceColor = (s: EInvoiceStatus) =>
  s === 'REGISTERED'
    ? 'green'
    : s === 'PENDING'
      ? 'amber'
      : s === 'FAILED'
        ? 'red'
        : 'slate';

/**
 * Sales Invoices — the GST bill, raised against a delivery note.
 *
 * The document is the point of the screen, so most of it is about getting a
 * correct bill out: print, PDF and the e-invoice / e-way bill numbers the
 * portals hand back. Nothing on an issued invoice is editable — it is what the
 * customer owes and what the return reports.
 */
export default function InvoicesPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const canAdd = can(ROUTE, 'add');
  const canEditPriv = can(ROUTE, 'edit');

  const [mode, setMode] = useState<'list' | 'view' | 'new'>('list');
  const [current, setCurrent] = useState<Invoice | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: rows, loading, refetch } = useFetch<Invoice[]>('/sales-invoices');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: unbilled, refetch: refetchUnbilled } =
    useFetch<UnbilledNote[]>('/sales-invoices/unbilled');

  const company = useMemo(
    () => (companies ?? []).find((c) => c.id === activeCompanyId) ?? null,
    [companies, activeCompanyId],
  );

  // ---- raising one ----
  const [noteId, setNoteId] = useState('');

  const raise = async () => {
    if (!noteId) return toast.error('Choose the delivery note to bill.');
    setSaving(true);
    try {
      const made = await api.post<Invoice>('/sales-invoices', {
        deliveryNoteId: Number(noteId),
      });
      toast.success(`Invoice ${made.invoiceNo} raised.`);
      setCurrent(made);
      setMode('view');
      setNoteId('');
      refetch();
      refetchUnbilled();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to raise it.');
    } finally {
      setSaving(false);
    }
  };

  const open = async (row: Invoice) => {
    try {
      const full = await api.get<Invoice>(`/sales-invoices/${row.id}`);
      setCurrent(full);
      setMode('view');
    } catch {
      toast.error('Failed to open the invoice.');
    }
  };

  const act = async (path: string, label: string, body?: unknown) => {
    if (!current) return;
    setSaving(true);
    try {
      const updated = await api.post<Invoice>(
        `/sales-invoices/${current.id}/${path}`,
        body ?? {},
      );
      setCurrent(updated);
      toast.success(label);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed.');
    } finally {
      setSaving(false);
    }
  };

  // ---- the document ----
  const docInput = (inv: Invoice): InvoiceDocInput => ({
    company: {
      name: company?.name ?? '',
      legalName: company?.legalName ?? null,
      gstin: company?.gstin ?? null,
      address: company?.address ?? null,
      state: company?.state ?? null,
    },
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    customer: {
      name: inv.customerName,
      gstin: inv.customerGstin,
      address: inv.customerAddress,
      state: inv.placeOfSupply,
      stateCode: inv.placeOfSupplyCode,
    },
    placeOfSupply: inv.placeOfSupply,
    placeOfSupplyCode: inv.placeOfSupplyCode,
    isInterState: inv.isInterState,
    reverseCharge: inv.reverseCharge,
    supplyType: inv.supplyType,
    deliveryNoteNo: inv.deliveryNoteNo,
    contractNo: inv.contractNo,
    status: inv.status,
    lines: inv.lines,
    taxableValue: inv.taxableValue,
    cgstAmount: inv.cgstAmount,
    sgstAmount: inv.sgstAmount,
    igstAmount: inv.igstAmount,
    cessAmount: inv.cessAmount,
    roundOff: inv.roundOff,
    grandTotal: inv.grandTotal,
    irn: inv.irn,
    ackNo: inv.ackNo,
    ackDate: inv.ackDate,
    signedQrCode: inv.signedQrCode,
    ewbNo: inv.ewbNo,
    ewbDate: inv.ewbDate,
    vehicleNo: inv.vehicleNo,
    transporterName: inv.transporterName,
    notes: inv.notes,
  });

  const print = (inv: Invoice) => openDocument(buildInvoiceHtml(docInput(inv)));

  /**
   * PDF via the browser's own print-to-PDF rather than a second layout built in
   * jsPDF. A tax invoice has a prescribed shape, and keeping two renderings of
   * it in step is how one of them quietly stops being compliant.
   */
  const pdf = (inv: Invoice) => {
    const html = buildInvoiceHtml(docInput(inv));
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
    toast.info('Choose "Save as PDF" in the print dialog.');
  };

  /** The register, as a spreadsheet — one row per invoice. */
  const exportExcel = () => {
    const list = rows ?? [];
    if (!list.length) return toast.error('Nothing to export.');
    const spec: ReportSpec = {
      companyName: company?.name ?? 'Sales Invoices',
      subtitle: `Sales Invoice Register — ${list.length} invoice${list.length === 1 ? '' : 's'}`,
      columns: [
        'Invoice',
        'Date',
        'Customer',
        'GSTIN',
        'Place of supply',
        'Taxable',
        'CGST',
        'SGST',
        'IGST',
        'Cess',
        'Total',
        'IRN',
        'E-Way Bill',
        'Status',
      ],
      weights: [10, 8, 18, 12, 10, 9, 7, 7, 7, 6, 9, 14, 10, 8],
      numericCols: [5, 6, 7, 8, 9, 10],
      blocks: [
        {
          tables: [
            {
              rows: list.map((r) => [
            r.invoiceNo,
            formatDayMonthYear(r.invoiceDate),
            r.customerName,
            r.customerGstin ?? '',
            `${r.placeOfSupply ?? ''} (${r.placeOfSupplyCode})`,
            money(r.taxableValue),
            money(r.cgstAmount),
            money(r.sgstAmount),
            money(r.igstAmount),
            money(r.cessAmount),
            money(r.grandTotal),
                r.irn ?? '',
                r.ewbNo ?? '',
                r.status,
              ]),
            },
          ],
        },
      ],
      fileBase: 'sales-invoice-register',
      serial: true,
    };
    excelReport(spec);
  };

  const columns: Column<Invoice>[] = [
    { key: 'invoiceNo', header: 'Invoice', accessor: (r) => r.invoiceNo },
    {
      key: 'invoiceDate',
      header: 'Date',
      sortAccessor: (r) => r.invoiceDate,
      render: (r) => formatDayMonthYear(r.invoiceDate),
    },
    { key: 'customer', header: 'Customer', accessor: (r) => r.customerName },
    {
      key: 'pos',
      header: 'Place of supply',
      accessor: (r) => r.placeOfSupply ?? r.placeOfSupplyCode,
      render: (r) => (
        <span className="text-xs">
          {r.placeOfSupply ?? '—'}{' '}
          <span className="text-slate-400">({r.placeOfSupplyCode})</span>
        </span>
      ),
    },
    {
      key: 'tax',
      header: 'Tax',
      sortAccessor: (r) => r.totalTax,
      render: (r) => (
        <span className="text-xs tabular-nums">
          {money(r.totalTax)}
          <span className="ml-1 text-slate-400">
            {r.isInterState ? 'IGST' : 'CGST+SGST'}
          </span>
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'grandTotal',
      header: 'Total',
      sortAccessor: (r) => r.grandTotal,
      render: (r) => money(r.grandTotal),
      className: 'text-right tabular-nums font-medium',
    },
    {
      key: 'einvoice',
      header: 'E-invoice',
      accessor: (r) => r.einvoiceStatus,
      render: (r) => (
        <Badge color={eInvoiceColor(r.einvoiceStatus)}>
          {r.einvoiceStatus.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => r.status,
      render: (r) => <Badge color={statusColor(r.status)}>{r.status}</Badge>,
    },
  ];

  // ---- raise screen ----
  if (mode === 'new') {
    return (
      <div className="p-6">
        <PageHeader
          title="Raise an invoice"
          description="Against a delivery note — what actually went out"
          icon={<ReceiptIndianRupee className="h-5 w-5" />}
          actions={
            <>
              <button className="btn-secondary" onClick={() => setMode('list')}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button className="btn-primary" onClick={raise} disabled={saving}>
                {saving ? 'Raising…' : 'Raise invoice'}
              </button>
            </>
          }
        />
        <div className="card p-6">
          <FormSection>The delivery</FormSection>
          <Select
            label="Delivery note"
            required
            value={noteId}
            onChange={(e) => setNoteId(e.target.value)}
            placeholder={
              (unbilled ?? []).length
                ? 'Choose a delivery note'
                : 'Every delivery note is already billed'
            }
            options={(unbilled ?? []).map((n) => ({
              value: n.id,
              label: `${n.docNo} — ${n.customerName ?? 'no customer'} — ${formatDayMonthYear(n.docDate)}`,
            }))}
          />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Everything billed comes from the note — its lines, quantities and
            rates, and the tax rates captured when the goods moved. The tax heads
            follow the place of supply: within Kerala it is CGST + SGST, outside
            it is IGST.
          </p>
        </div>
      </div>
    );
  }

  // ---- one invoice ----
  if (mode === 'view' && current) {
    const inv = current;
    return (
      <div className="p-6">
        <PageHeader
          title={`Tax Invoice ${inv.invoiceNo}`}
          description={`${inv.customerName} · ${formatDayMonthYear(inv.invoiceDate)} · ${inv.finYear}`}
          icon={<ReceiptIndianRupee className="h-5 w-5" />}
          actions={
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setMode('list');
                  setCurrent(null);
                  refetch();
                }}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button className="btn-secondary" onClick={() => print(inv)}>
                <Printer className="h-4 w-4" /> Print
              </button>
              <button className="btn-secondary" onClick={() => pdf(inv)}>
                <FileDown className="h-4 w-4" /> PDF
              </button>
              {inv.status === 'DRAFT' && canEditPriv && (
                <button
                  className="btn-success"
                  onClick={() => act('issue', 'Invoice issued.')}
                  disabled={saving}
                >
                  <Check className="h-4 w-4" /> Issue
                </button>
              )}
              {inv.status !== 'CANCELLED' && canEditPriv && (
                <button
                  className="btn-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Cancel invoice',
                      message:
                        'The invoice keeps its number and stays in the series — a GST series with a hole in it is a hole somebody has to explain. Cancel it?',
                      confirmText: 'Cancel invoice',
                      danger: true,
                    });
                    if (ok) act('cancel', 'Invoice cancelled.');
                  }}
                  disabled={saving}
                >
                  <Ban className="h-4 w-4" /> Cancel
                </button>
              )}
            </>
          }
        />

        <div className="card mb-4 grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
          <Figure label="Taxable value" value={money(inv.taxableValue)} />
          <Figure
            label={inv.isInterState ? 'IGST' : 'CGST + SGST'}
            value={money(inv.totalTax)}
            hint={
              inv.isInterState
                ? `Inter-state: supplied to ${inv.placeOfSupply ?? inv.placeOfSupplyCode}, so the whole tax is IGST.`
                : `Intra-state: supplied within ${inv.placeOfSupply ?? inv.placeOfSupplyCode}, so the tax splits into CGST and SGST.`
            }
          />
          <Figure label="Round off" value={money(inv.roundOff)} />
          <Figure label="Grand total" value={money(inv.grandTotal)} strong />
        </div>

        <div className="card mb-4 overflow-x-auto p-0">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
                <th className="px-3 py-2">Description</th>
                <th className="px-2 py-2">HSN</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2 text-right">Taxable</th>
                {inv.isInterState ? (
                  <th className="px-2 py-2 text-right">IGST</th>
                ) : (
                  <>
                    <th className="px-2 py-2 text-right">CGST</th>
                    <th className="px-2 py-2 text-right">SGST</th>
                  </>
                )}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-slate-100 dark:border-slate-800/60"
                >
                  <td className="px-3 py-1.5">{l.description}</td>
                  <td className="px-2 text-xs text-slate-500">{l.hsnCode ?? '—'}</td>
                  <td className="px-2 text-right tabular-nums">
                    {l.quantity} {l.unitSymbol ?? ''}
                  </td>
                  <td className="px-2 text-right tabular-nums">{money(l.rate)}</td>
                  <td className="px-2 text-right tabular-nums">
                    {money(l.taxableValue)}
                  </td>
                  {inv.isInterState ? (
                    <td className="px-2 text-right tabular-nums">
                      {money(l.igstAmount)}
                      <span className="ml-1 text-xs text-slate-400">
                        {l.igstRate}%
                      </span>
                    </td>
                  ) : (
                    <>
                      <td className="px-2 text-right tabular-nums">
                        {money(l.cgstAmount)}
                        <span className="ml-1 text-xs text-slate-400">
                          {l.cgstRate}%
                        </span>
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {money(l.sgstAmount)}
                        <span className="ml-1 text-xs text-slate-400">
                          {l.sgstRate}%
                        </span>
                      </td>
                    </>
                  )}
                  <td className="px-3 text-right font-medium tabular-nums">
                    {money(l.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EInvoicePanel
            invoice={inv}
            disabled={!canEditPriv || saving}
            onSaved={(updated) => {
              setCurrent(updated);
              refetch();
            }}
          />
          <EwayBillPanel
            invoice={inv}
            disabled={!canEditPriv || saving}
            onSaved={(updated) => {
              setCurrent(updated);
              refetch();
            }}
          />
        </div>
      </div>
    );
  }

  // ---- the register ----
  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Sales Invoices"
        description="The GST bill, raised against a delivery note"
        icon={<ReceiptIndianRupee className="h-5 w-5" />}
        actions={
          <>
            <button className="btn-secondary" onClick={exportExcel}>
              <Sheet className="h-4 w-4" /> Excel
            </button>
            {canAdd && (
              <button className="btn-primary" onClick={() => setMode('new')}>
                <Plus className="h-4 w-4" /> Raise invoice
              </button>
            )}
          </>
        }
      />
      <DataTable
        columns={columns}
        rows={rows ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Invoice, customer or IRN…"
        onView={open}
        canView
        rowActions={(r) => (
          <button
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
            title="Print"
            onClick={(e) => {
              e.stopPropagation();
              print(r);
            }}
          >
            <Printer className="h-4 w-4" />
          </button>
        )}
        emptyMessage="No invoices raised yet"
      />
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div title={hint}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={
          strong
            ? 'text-lg font-bold tabular-nums text-slate-900 dark:text-white'
            : 'font-medium tabular-nums text-slate-700 dark:text-slate-200'
        }
      >
        {value}
      </p>
    </div>
  );
}

/**
 * What the Invoice Registration Portal returned.
 *
 * Typed in today. The fields are the IRP's own, so when the upload is wired the
 * panel becomes a button and the shape it stores does not change.
 */
function EInvoicePanel({
  invoice,
  disabled,
  onSaved,
}: {
  invoice: Invoice;
  disabled: boolean;
  onSaved: (i: Invoice) => void;
}) {
  const toast = useToast();
  const [irn, setIrn] = useState(invoice.irn ?? '');
  const [ackNo, setAckNo] = useState(invoice.ackNo ?? '');
  const [qr, setQr] = useState(invoice.signedQrCode ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Invoice>(
        `/sales-invoices/${invoice.id}/e-invoice`,
        {
          irn: irn.trim() || undefined,
          ackNo: ackNo.trim() || undefined,
          signedQrCode: qr.trim() || undefined,
          status: irn.trim() ? 'REGISTERED' : 'PENDING',
        },
      );
      onSaved(updated);
      toast.success('E-invoice details saved.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <QrCode className="h-4 w-4" /> E-invoice
        </h3>
        <Badge color={eInvoiceColor(invoice.einvoiceStatus)}>
          {invoice.einvoiceStatus.replace('_', ' ')}
        </Badge>
      </div>
      {invoice.einvoiceStatus === 'NOT_REQUIRED' ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A B2C bill is not registered with the IRP, so there is nothing to
          record here.
        </p>
      ) : (
        <div className="space-y-3">
          <Input
            label="IRN"
            value={irn}
            disabled={disabled}
            onChange={(e) => setIrn(e.target.value)}
            placeholder="64-character Invoice Reference Number"
          />
          <Input
            label="Acknowledgement no."
            value={ackNo}
            disabled={disabled}
            onChange={(e) => setAckNo(e.target.value)}
          />
          <Input
            label="Signed QR"
            value={qr}
            disabled={disabled}
            onChange={(e) => setQr(e.target.value)}
            placeholder="The signed JWT the IRP returns"
          />
          <button
            className="btn-secondary text-xs"
            onClick={save}
            disabled={disabled || busy}
          >
            {busy ? 'Saving…' : 'Save e-invoice details'}
          </button>
        </div>
      )}
    </div>
  );
}

function EwayBillPanel({
  invoice,
  disabled,
  onSaved,
}: {
  invoice: Invoice;
  disabled: boolean;
  onSaved: (i: Invoice) => void;
}) {
  const toast = useToast();
  const [ewbNo, setEwbNo] = useState(invoice.ewbNo ?? '');
  const [distance, setDistance] = useState(
    invoice.distanceKm != null ? String(invoice.distanceKm) : '',
  );
  const [vehicle, setVehicle] = useState(invoice.vehicleNo ?? '');
  const [transporter, setTransporter] = useState(invoice.transporterName ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Invoice>(
        `/sales-invoices/${invoice.id}/eway-bill`,
        {
          ewbNo: ewbNo.trim() || undefined,
          distanceKm: distance ? Number(distance) : undefined,
          vehicleNo: vehicle.trim() || undefined,
          transporterName: transporter.trim() || undefined,
          transportMode: 'Road',
        },
      );
      onSaved(updated);
      toast.success('E-way bill saved.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Truck className="h-4 w-4" /> E-way bill
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="E-way bill no."
          value={ewbNo}
          disabled={disabled}
          onChange={(e) => setEwbNo(e.target.value)}
        />
        <Input
          label="Distance (km)"
          type="number"
          min={0}
          value={distance}
          disabled={disabled}
          onChange={(e) => setDistance(e.target.value)}
        />
        <Input
          label="Vehicle no."
          value={vehicle}
          disabled={disabled}
          onChange={(e) => setVehicle(e.target.value)}
        />
        <Input
          label="Transporter"
          value={transporter}
          disabled={disabled}
          onChange={(e) => setTransporter(e.target.value)}
        />
      </div>
      <button
        className="btn-secondary mt-3 text-xs"
        onClick={save}
        disabled={disabled || busy}
      >
        {busy ? 'Saving…' : 'Save e-way bill'}
      </button>
    </div>
  );
}
