'use client';

import { useMemo, useState } from 'react';
import { Plus, Truck, Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  Dispatch,
  DispatchStatus,
  SalesOrder,
  Company,
  Branch,
  Unit,
} from '@/lib/types';

const ROUTE = '/crm/dispatch';

const statusColor = (s: DispatchStatus) =>
  s === 'RECEIVED' ? 'green' : s === 'CANCELLED' ? 'slate' : 'amber';
const statusLabel = (s: DispatchStatus) =>
  s.charAt(0) + s.slice(1).toLowerCase();
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';
const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function DispatchPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, refetch } = useFetch<Dispatch[]>('/dispatches');
  const { data: orders } = useFetch<SalesOrder[]>('/sales-orders');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { data: units } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, bulkLock } = useLock<Dispatch>({
    endpoint: '/dispatches',
    route: ROUTE,
    noun: 'dispatch',
    nameOf: (d) => d.dispatchNo,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'view' | 'new'>('view');
  const [current, setCurrent] = useState<Dispatch | null>(null);
  const [form, setForm] = useState({
    salesOrderId: '',
    driverName: '',
    vehicleNo: '',
  });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canView = can(ROUTE, 'view');

  const companyName = (id?: number | null) =>
    id ? ((companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`) : '—';
  const branchName = (id?: number | null) =>
    id ? ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`) : '';
  const unitById = useMemo(
    () => new Map((units ?? []).map((u) => [u.id, u])),
    [units],
  );
  const unitLabel = (id: number) => {
    const u = unitById.get(id);
    return u?.symbol ?? u?.code ?? '';
  };

  // Approved sales orders are the ones that can be dispatched.
  const approvedOrders = useMemo(
    () => (orders ?? []).filter((o) => o.status === 'APPROVED'),
    [orders],
  );

  const openNew = () => {
    setMode('new');
    setCurrent(null);
    setForm({ salesOrderId: '', driverName: '', vehicleNo: '' });
    setOpen(true);
  };
  const openView = async (row: Dispatch) => {
    try {
      const full = await api.get<Dispatch>(`/dispatches/${row.id}`);
      setMode('view');
      setCurrent(full);
      setOpen(true);
    } catch {
      toast.error('Failed to open the dispatch.');
    }
  };

  const save = async () => {
    if (!form.salesOrderId) {
      toast.error('Select an approved sales order to dispatch.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<Dispatch>(
        `/dispatches/from-sales-order/${form.salesOrderId}`,
        {
          driverName: form.driverName.trim() || null,
          vehicleNo: form.vehicleNo.trim() || null,
        },
      );
      toast.success(`Dispatch ${created.dispatchNo} created.`);
      await refetch();
      setMode('view');
      setCurrent(created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to dispatch.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Dispatch>[] = [
    { key: 'dispatchNo', header: 'Dispatch', accessor: (r) => r.dispatchNo },
    {
      key: 'soNumber',
      header: 'Sales Order',
      accessor: (r) => r.soNumber ?? '—',
    },
    {
      key: 'buyer',
      header: 'Buyer',
      accessor: (r) => companyName(r.buyerCompanyId),
    },
    { key: 'invoice', header: 'Invoice', accessor: (r) => r.invoiceNo ?? '—' },
    {
      key: 'date',
      header: 'Dispatched',
      accessor: (r) => fmtDate(r.dispatchDate),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Dispatch"
        description="Ship an approved sales order — invoice, delivery note and e-way bill travel with the goods"
        icon={<Truck className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New Dispatch
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search dispatches..."
        onView={openView}
        canView={canView}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No dispatches yet"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          mode === 'new'
            ? 'New Dispatch'
            : current
              ? current.dispatchNo
              : 'Dispatch'
        }
        subtitle="Goods dispatch"
        icon={<Truck className="h-5 w-5" />}
        footer={
          mode === 'new' ? (
            <DrawerFooter
              onCancel={() => setOpen(false)}
              onSave={save}
              saving={saving}
              dataEntry
            />
          ) : (
            <CloseFooter onClose={() => setOpen(false)} />
          )
        }
      >
        {mode === 'new' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-500">
              Ship an approved sales order. Stock goes out of the default store
              and the invoice, delivery note and e-way bill are generated.
            </p>
            <Select
              label="Sales order"
              required
              value={form.salesOrderId}
              onChange={(e) =>
                setForm({ ...form, salesOrderId: e.target.value })
              }
              placeholder="Select an approved sales order"
              options={approvedOrders.map((o) => ({
                value: String(o.id),
                label: `${o.orderNo} — ${companyName(o.buyerCompanyId)}`,
              }))}
            />
            <Input
              label="Driver name"
              value={form.driverName}
              onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              placeholder="Driver carrying the goods"
            />
            <Input
              label="Vehicle number"
              value={form.vehicleNo}
              onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })}
              placeholder="e.g. KL-00-AB-0000"
            />
          </div>
        ) : (
          current && (
            <DispatchDoc
              d={current}
              companyName={companyName}
              branchName={branchName}
              unitLabel={unitLabel}
            />
          )
        )}
      </Drawer>
    </div>
  );

  function DispatchDoc({
    d,
    companyName,
    branchName,
    unitLabel,
  }: {
    d: Dispatch;
    companyName: (id?: number | null) => string;
    branchName: (id?: number | null) => string;
    unitLabel: (id: number) => string;
  }) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge color={statusColor(d.status)}>{statusLabel(d.status)}</Badge>
          <button className="btn-ghost" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>

        {/* Document numbers that travel with the goods */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 sm:grid-cols-3">
          <Field label="Tax Invoice" value={d.invoiceNo ?? '—'} mono />
          <Field label="Delivery Note" value={d.deliveryNoteNo ?? '—'} mono />
          <Field label="E-Way Bill" value={d.ewayBillNo ?? '—'} mono />
          <Field label="Sales Order" value={d.soNumber ?? '—'} />
          <Field label="Dispatched" value={fmtDate(d.dispatchDate)} />
          <Field label="From store" value={d.storeName ?? '—'} />
        </div>

        {/* From / To */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Seller
            </p>
            <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {companyName(d.companyId)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Buyer
            </p>
            <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
              {companyName(d.buyerCompanyId)}
            </p>
            {branchName(d.buyerBranchId) && (
              <p className="text-sm text-slate-500">
                {branchName(d.buyerBranchId)}
              </p>
            )}
          </div>
          <Field label="Driver" value={d.driverName ?? '—'} />
          <Field label="Vehicle" value={d.vehicleNo ?? '—'} />
        </div>

        {/* Lines */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="py-2 pr-2">Product</th>
                <th className="w-20 py-2 text-right">Qty</th>
                <th className="w-12 py-2 pl-2">Unit</th>
                <th className="py-2 pl-2">Batch</th>
                <th className="w-24 py-2 text-right">Rate</th>
                <th className="w-28 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-slate-100 dark:border-slate-800/60"
                >
                  <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                    {l.productName}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {l.quantity.toLocaleString()}
                  </td>
                  <td className="py-1.5 pl-2 text-slate-500">
                    {unitLabel(l.unitId)}
                  </td>
                  <td className="py-1.5 pl-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {l.batchNo ?? '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {money(l.rate)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {money(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
                <td className="py-2" colSpan={5}>
                  Total
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(d.subtotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          Tax is not yet computed on this document — GST wiring lands with the
          Accounts/GST module.
        </p>
      </div>
    );
  }
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={
          'mt-1 text-slate-700 dark:text-slate-300' +
          (mono ? ' font-mono text-sm' : '')
        }
      >
        {value}
      </p>
    </div>
  );
}
