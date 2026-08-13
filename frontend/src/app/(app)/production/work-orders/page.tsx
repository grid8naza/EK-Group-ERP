'use client';

import { useMemo, useState } from 'react';
import { Hammer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, CloseFooter } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import type { WorkOrder, WorkOrderStatus, Product, Unit } from '@/lib/types';

const ROUTE = '/production/work-orders';

const statusColor = (s: WorkOrderStatus) =>
  s === 'COMPLETED'
    ? 'green'
    : s === 'IN_PROGRESS'
      ? 'blue'
      : s === 'CANCELLED'
        ? 'slate'
        : 'amber';
const statusLabel = (s: WorkOrderStatus) =>
  s === 'IN_PROGRESS' ? 'In progress' : s.charAt(0) + s.slice(1).toLowerCase();

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

export default function WorkOrdersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<WorkOrder[]>('/work-orders');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: units } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, guardDelete, bulkLock } =
    useLock<WorkOrder>({
      endpoint: '/work-orders',
      route: ROUTE,
      noun: 'work order',
      nameOf: (w) => w.orderNo,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<WorkOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const canView = can(ROUTE, 'view');
  const canDelete = can(ROUTE, 'delete');
  const canEdit = can(ROUTE, 'edit');
  const canRecord = can('/production/receipts', 'add');

  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );
  const unitById = useMemo(
    () => new Map((units ?? []).map((u) => [u.id, u])),
    [units],
  );
  const productName = (id: number) => productById.get(id)?.name ?? `#${id}`;
  const unitLabel = (id: number) => {
    const u = unitById.get(id);
    return u?.symbol ?? u?.code ?? '';
  };

  const openView = async (row: WorkOrder) => {
    try {
      const full = await api.get<WorkOrder>(`/work-orders/${row.id}`);
      setCurrent(full);
      setOpen(true);
    } catch {
      toast.error('Failed to open the work order.');
    }
  };

  const remove = async (w: WorkOrder) => {
    const ok = await confirm({
      title: 'Delete work order',
      message: `Delete ${w.orderNo}? This frees its sales order to raise one again.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/work-orders/${w.id}`);
      toast.success('Work order deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const setStatus = async (status: WorkOrderStatus) => {
    if (!current) return;
    setBusy(true);
    try {
      const upd = await api.patch<WorkOrder>(
        `/work-orders/${current.id}/status`,
        { status },
      );
      setCurrent({ ...current, status: upd.status });
      toast.success('Work order updated.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
    } finally {
      setBusy(false);
    }
  };

  // Record production: bank the work order's products into stock as new batches
  // and complete the order.
  const recordProduction = async () => {
    if (!current) return;
    const ok = await confirm({
      title: 'Record production?',
      message: `Bank the products of ${current.orderNo} into store stock as new batches and complete the work order?`,
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/production-receipts/from-work-order/${current.id}`, {});
      toast.success('Production recorded — finished goods banked to stock.');
      setCurrent({ ...current, status: 'COMPLETED' });
      refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to record production.',
      );
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<WorkOrder>[] = [
    { key: 'orderNo', header: 'Work Order', accessor: (r) => r.orderNo },
    {
      key: 'soNumber',
      header: 'Sales Order',
      accessor: (r) => r.soNumber ?? '—',
    },
    { key: 'items', header: 'Items', accessor: (r) => String(r.lines.length) },
    {
      key: 'delivery',
      header: 'Delivery',
      accessor: (r) => fmtDate(r.soDeliveryAt),
    },
    {
      key: 'created',
      header: 'Created',
      accessor: (r) => fmtDate(r.createdAt),
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
        title="Work Order"
        description="What must be produced to fulfil approved sales orders"
        icon={<Hammer className="h-5 w-5" />}
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search work orders..."
        onView={openView}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canDelete={canDelete}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No work orders yet"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={current ? current.orderNo : 'Work Order'}
        subtitle="Production work order"
        icon={<Hammer className="h-5 w-5" />}
        footer={<CloseFooter onClose={() => setOpen(false)} />}
      >
        {current && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Sales order" value={current.soNumber ?? '—'} />
              <Field label="Delivery" value={fmt(current.soDeliveryAt)} />
              <Field label="Created" value={fmt(current.createdAt)} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </p>
                <div className="mt-1">
                  <Badge color={statusColor(current.status)}>
                    {statusLabel(current.status)}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Lines */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="w-10 py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Product</th>
                    <th className="w-28 py-2 text-right">To produce</th>
                    <th className="w-14 py-2 pl-2">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {current.lines.map((l, i) => (
                    <tr
                      key={l.id}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-2 pr-2 text-slate-400 tabular-nums">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {productName(l.productId)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {l.quantity.toLocaleString()}
                      </td>
                      <td className="py-2 pl-2 text-slate-500">
                        {unitLabel(l.unitId)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Status actions (production tracking) */}
            {canEdit &&
              current.status !== 'COMPLETED' &&
              current.status !== 'CANCELLED' && (
                <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                  {current.status === 'PENDING' && (
                    <button
                      className="btn-secondary"
                      onClick={() => setStatus('IN_PROGRESS')}
                      disabled={busy}
                    >
                      Start production
                    </button>
                  )}
                  {canRecord && (
                    <button
                      className="btn-primary"
                      onClick={recordProduction}
                      disabled={busy}
                    >
                      Record production
                    </button>
                  )}
                  <button
                    className="btn-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={() => setStatus('CANCELLED')}
                    disabled={busy}
                  >
                    Cancel work order
                  </button>
                </div>
              )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}
