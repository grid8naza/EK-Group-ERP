'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, ArrowLeft, Check, X, Ban } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Textarea } from '@/components/ui/Field';
import { PurchaseOrderDoc } from '@/components/crm/PurchaseOrderDoc';
import type {
  Company,
  Product,
  Unit,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@/lib/types';

const statusColor = (s: PurchaseOrderStatus) =>
  s === 'APPROVED'
    ? 'green'
    : s === 'REJECTED'
      ? 'red'
      : s === 'CANCELLED'
        ? 'slate'
        : s === 'DRAFT'
          ? 'blue'
          : 'amber';

const fmtDelivery = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

type Action = 'FORWARD' | 'REJECT' | 'CANCEL';

export default function SalesOrdersPage() {
  const toast = useToast();
  const { data, loading, refetch } = useFetch<PurchaseOrder[]>(
    '/purchase-orders?scope=incoming',
  );
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: units } = useFetch<Unit[]>('/units');

  const companyName = (id: number) =>
    (companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`;
  const productName = (id: number) =>
    (products ?? []).find((p) => p.id === id)?.name ?? `#${id}`;
  const unitLabel = (id: number) => {
    const u = (units ?? []).find((x) => x.id === id);
    return u?.symbol ?? u?.code ?? '';
  };

  const [current, setCurrent] = useState<PurchaseOrder | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  const myTask = current?.workflow?.myTask ?? null;

  const openView = async (row: PurchaseOrder) => {
    try {
      const full = await api.get<PurchaseOrder>(`/purchase-orders/${row.id}`);
      setCurrent(full);
      setComment('');
    } catch {
      toast.error('Failed to open the order.');
    }
  };

  const backToList = () => {
    setCurrent(null);
    refetch();
  };

  const doAct = async (action: Action) => {
    if (!current) return;
    if (action === 'REJECT' && !comment.trim()) {
      toast.error('A reason is required to reject.');
      return;
    }
    setActing(true);
    try {
      await api.post(`/purchase-orders/${current.id}/act`, {
        action,
        comment: comment.trim() || undefined,
      });
      toast.success(
        action === 'REJECT'
          ? 'Order rejected.'
          : action === 'CANCEL'
            ? 'Order cancelled.'
            : 'Done — moved to the next level.',
      );
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Action failed.');
    } finally {
      setActing(false);
    }
  };

  const columns: Column<PurchaseOrder>[] = useMemo(
    () => [
      { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
      {
        key: 'from',
        header: 'From (Requester)',
        accessor: (r) => companyName(r.orderingCompanyId),
      },
      {
        key: 'items',
        header: 'Items',
        accessor: (r) => r.lines.length,
        className: 'text-right tabular-nums',
        headerClassName: 'text-right',
      },
      {
        key: 'qty',
        header: 'Total Qty',
        accessor: (r) =>
          r.lines.reduce((s, l) => s + l.quantity, 0).toLocaleString(),
        className: 'text-right tabular-nums',
        headerClassName: 'text-right',
      },
      {
        key: 'delivery',
        header: 'Delivery',
        accessor: (r) => fmtDelivery(r.deliveryAt),
        className: 'text-center',
        headerClassName: 'text-center',
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <Badge color={statusColor(r.status)}>{r.status}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies],
  );

  // ============================ DOCUMENT MODE ============================
  if (current) {
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-y-auto pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={backToList}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </button>
          {myTask && (
            <div className="flex flex-wrap gap-2">
              {myTask.canCancel && (
                <button
                  className="btn-ghost text-slate-600"
                  onClick={() => doAct('CANCEL')}
                  disabled={acting}
                >
                  <Ban className="h-4 w-4" /> Cancel
                </button>
              )}
              {myTask.canReject && (
                <button
                  className="btn-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => doAct('REJECT')}
                  disabled={acting}
                >
                  <X className="h-4 w-4" /> Reject
                </button>
              )}
              <button
                className="btn-primary"
                onClick={() => doAct('FORWARD')}
                disabled={acting}
              >
                <Check className="h-4 w-4" /> {myTask.buttonText}
              </button>
            </div>
          )}
        </div>

        <PurchaseOrderDoc
          order={current}
          companyName={companyName}
          productName={productName}
          unitLabel={unitLabel}
        />

        {myTask && (
          <div className="mx-auto w-full max-w-3xl">
            <Textarea
              label={
                myTask.canReject
                  ? 'Comment (required to reject)'
                  : 'Comment (optional)'
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note for the approval trail…"
            />
          </div>
        )}
      </div>
    );
  }

  // ============================== LIST MODE ==============================
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Sales Orders"
        description="Inter-company orders awaiting your review — approve, forward or reject"
        icon={<ClipboardList className="h-5 w-5" />}
      />
      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search orders..."
        onView={openView}
        canView
        emptyMessage="No orders awaiting you"
      />
    </div>
  );
}
