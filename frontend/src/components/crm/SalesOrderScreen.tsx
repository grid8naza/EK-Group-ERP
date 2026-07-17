'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Trash2,
  ArrowLeft,
  Send,
  Check,
  X,
  Ban,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input, Textarea } from '@/components/ui/Field';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { SalesOrderDoc } from '@/components/crm/SalesOrderDoc';
import { resolveIcon } from '@/lib/icons';
import type {
  Branch,
  Company,
  Product,
  Unit,
  SalesOrder,
  SalesOrderStatus,
  WorkflowStatus,
} from '@/lib/types';

const ROUTE = '/crm/icso';

// Keyed by lineId, not product: one product SPLITS across a line per batch, so
// productId is not unique on this document. `rate` only moves on a balance line.
type DraftLine = { lineId: number; quantity: string; rate: string };
type Mode = 'list' | 'edit' | 'view';

const statusColor = (s: SalesOrderStatus) =>
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
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * ICSO — the selling company's order to supply, converted from an approved ICPO.
 *
 * There is no "New" button: an ICSO only ever comes from a purchase order, via
 * Convert on the ICPO - Received screen. What the seller decides here is the
 * QUANTITY — product, unit and rate all come from the buyer's approved order.
 */
export function SalesOrderScreen() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: statuses } = useFetch<WorkflowStatus[]>('/workflow-statuses');
  const statusByName = useMemo(
    () => new Map((statuses ?? []).map((s) => [s.name, s])),
    [statuses],
  );

  const { data: rows, loading, refetch } = useFetch<SalesOrder[]>('/sales-orders');

  const canDeletePriv = can(ROUTE, 'delete');

  const companyName = (id?: number | null) =>
    id ? ((companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`) : '—';
  const branchName = (id?: number | null) =>
    id ? ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`) : '—';
  const unitLabel = (id: number) => {
    const u = (units ?? []).find((x) => x.id === id);
    return u?.symbol ?? u?.code ?? '';
  };
  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );
  const productName = (id: number) => productById.get(id)?.name ?? `#${id}`;

  // ---- filters ----
  const [fBuyer, setFBuyer] = useState('');
  const [fStatus, setFStatus] = useState('');
  const buyerOptions = useMemo(() => {
    const m = new Map<number, string>();
    (rows ?? []).forEach((r) => {
      if (r.buyerCompanyId) m.set(r.buyerCompanyId, companyName(r.buyerCompanyId));
    });
    return [...m.entries()].map(([value, label]) => ({ value, label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, companies]);
  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    (rows ?? []).forEach((r) => s.add(r.workflowStatus ?? r.status));
    return [...s].map((v) => ({ value: v, label: v }));
  }, [rows]);
  const filteredRows = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!fBuyer || String(r.buyerCompanyId ?? '') === fBuyer) &&
          (!fStatus || (r.workflowStatus ?? r.status) === fStatus),
      ),
    [rows, fBuyer, fStatus],
  );
  const hasFilters = !!(fBuyer || fStatus);

  // ---- screen state ----
  const [mode, setMode] = useState<Mode>('list');
  const [current, setCurrent] = useState<SalesOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const myTask = current?.workflow?.myTask ?? null;

  // ---- editable draft form ----
  const [deliveryAt, setDeliveryAt] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');

  const setLineQty = (lineId: number, quantity: string) =>
    setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)));
  // Only a balance line (no batch) accepts a price — the backend enforces it too.
  const setLineRate = (lineId: number, rate: string) =>
    setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, rate } : l)));

  const draftTotal = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
        0,
      ),
    [lines, current],
  );

  const loadOrder = async (id: number) => {
    const full = await api.get<SalesOrder>(`/sales-orders/${id}`);
    setCurrent(full);
    setComment('');
    setDeliveryAt(toLocalInput(full.deliveryAt));
    setLines(
      full.lines.map((l) => ({
        lineId: l.id,
        quantity: String(l.quantity),
        rate: String(l.rate),
      })),
    );
    setNotes(full.notes ?? '');
    return full;
  };

  const openView = async (row: SalesOrder) => {
    try {
      const full = await loadOrder(row.id);
      setMode(full.status === 'DRAFT' ? 'edit' : 'view');
    } catch {
      toast.error('Failed to open the order.');
    }
  };

  const backToList = () => {
    setMode('list');
    setCurrent(null);
    refetch();
  };

  const del = async (row: SalesOrder) => {
    const ok = await confirm({
      title: 'Delete draft',
      message: `Delete draft ${row.orderNo}? The purchase order it came from can then be converted again.`,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/sales-orders/${row.id}`);
      toast.success('Draft deleted.');
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- persistence ----
  // Quantity always travels; the price only matters on a balance line, and the
  // backend ignores it on a batch-backed one.
  const buildLines = () =>
    lines.map((l) => ({
      lineId: l.lineId,
      quantity: Number(l.quantity) || 0,
      rate: Number(l.rate) || 0,
    }));

  const validate = (): string | null => {
    if (buildLines().every((l) => l.quantity <= 0))
      return 'Supply at least one line — set a quantity above zero, or delete the order.';
    return null;
  };

  const persist = async (): Promise<SalesOrder> => {
    if (!current) throw new Error('No order open.');
    return api.patch<SalesOrder>(`/sales-orders/${current.id}`, {
      deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
      notes: notes.trim(),
      lines: buildLines(),
    });
  };

  const doSave = async (close: boolean) => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const saved = await persist();
      toast.success('Draft saved.');
      if (close) backToList();
      else {
        setCurrent(saved);
        setLines(
          saved.lines.map((l) => ({
            lineId: l.id,
            quantity: String(l.quantity),
            rate: String(l.rate),
          })),
        );
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const doForward = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const saved = await persist();
      await api.post(`/sales-orders/${saved.id}/submit`, {});
      toast.success('Order submitted for approval.');
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to submit.');
    } finally {
      setSaving(false);
    }
  };

  const doAct = async (action: 'FORWARD' | 'REJECT' | 'CANCEL') => {
    if (!current) return;
    if (action === 'REJECT' && !comment.trim()) {
      toast.error('A reason is required to reject.');
      return;
    }
    if (action === 'CANCEL') {
      const ok = await confirm({
        title: 'Cancel order',
        message: `Cancel ${current.orderNo}? This withdraws it from the approval workflow and cannot be undone.`,
        confirmText: 'Cancel order',
      });
      if (!ok) return;
    }
    setActing(true);
    try {
      await api.post(`/sales-orders/${current.id}/act`, {
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

  // ---- list columns ----
  const columns: Column<SalesOrder>[] = [
    { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
    {
      key: 'buyer',
      header: 'Customer',
      accessor: (r) => companyName(r.buyerCompanyId),
    },
    {
      key: 'po',
      header: 'Against PO',
      accessor: (r) => r.poNumber ?? '—',
    },
    {
      key: 'items',
      header: 'Lines',
      accessor: (r) => r.lines.length,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'total',
      header: 'Value',
      accessor: (r) => money(r.total ?? 0),
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
      className: 'text-center',
      headerClassName: 'text-center',
      render: (r) => {
        const label = r.workflowStatus ?? r.status;
        const st = r.workflowStatus ? statusByName.get(r.workflowStatus) : null;
        if (st?.icon) {
          const Icon = resolveIcon(st.icon);
          return (
            <span
              title={label}
              className="inline-flex justify-center text-slate-600 dark:text-slate-300"
            >
              <Icon className="h-5 w-5" style={{ color: st.color || undefined }} />
            </span>
          );
        }
        return <Badge color={statusColor(r.status)}>{label}</Badge>;
      },
    },
  ];

  // ============================ DOCUMENT MODE ============================
  if (mode !== 'list') {
    const isEditing = mode === 'edit';
    const submitLabel = current?.viewer?.submitButtonText ?? 'Forward';
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-y-auto pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={backToList}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </button>
          {isEditing ? (
            <div className="flex flex-wrap gap-2">
              {current && canDeletePriv && (
                <button
                  className="btn-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => del(current)}
                  disabled={saving}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={() => doSave(false)}
                disabled={saving}
              >
                Save
              </button>
              <button
                className="btn-secondary"
                onClick={() => doSave(true)}
                disabled={saving}
              >
                Save &amp; Close
              </button>
              <button className="btn-primary" onClick={doForward} disabled={saving}>
                <Send className="h-4 w-4" /> {submitLabel}
              </button>
            </div>
          ) : myTask || current?.viewer?.canCancel ? (
            <div className="flex flex-wrap gap-2">
              {(myTask?.canCancel || current?.viewer?.canCancel) && (
                <button
                  className="btn-ghost text-slate-600"
                  onClick={() => doAct('CANCEL')}
                  disabled={acting}
                >
                  <Ban className="h-4 w-4" /> Cancel
                </button>
              )}
              {myTask?.canReject && (
                <button
                  className="btn-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => doAct('REJECT')}
                  disabled={acting}
                >
                  <X className="h-4 w-4" /> Reject
                </button>
              )}
              {myTask && (
                <button
                  className="btn-primary"
                  onClick={() => doAct('FORWARD')}
                  disabled={acting}
                >
                  <Check className="h-4 w-4" /> {myTask.buttonText}
                </button>
              )}
            </div>
          ) : null}
        </div>

        {isEditing && current ? (
          <DraftEditor
            order={current}
            companyName={companyName}
            branchName={branchName}
            productName={productName}
            unitLabel={unitLabel}
            deliveryAt={deliveryAt}
            onDelivery={setDeliveryAt}
            lines={lines}
            setLineQty={setLineQty}
            setLineRate={setLineRate}
            total={draftTotal}
            notes={notes}
            onNotes={setNotes}
          />
        ) : (
          current && (
            <>
              <SalesOrderDoc
                order={current}
                companyName={companyName}
                branchName={branchName}
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
            </>
          )
        )}
      </div>
    );
  }

  // ============================== LIST MODE ==============================
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title="Inter-Company Sales Order (ICSO)"
        description="Orders to supply another group company, converted from their purchase orders"
        icon={<ClipboardList className="h-5 w-5" />}
      />
      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search orders..."
        onView={openView}
        canView
        emptyMessage="No sales orders yet — convert an approved ICPO under “ICPO - Received”"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={fBuyer}
              onChange={(e) => setFBuyer(e.target.value)}
              placeholder="All customers"
              options={buyerOptions}
              wrapClassName="w-44"
            />
            <Select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              placeholder="All statuses"
              options={statusOptions}
              wrapClassName="w-44"
            />
            {hasFilters && (
              <button
                className="btn-ghost text-xs text-slate-500"
                onClick={() => {
                  setFBuyer('');
                  setFStatus('');
                }}
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        }
      />
    </div>
  );
}

// --- draft editor: the quantity check, which is the whole point of converting ---
function DraftEditor(props: {
  order: SalesOrder;
  companyName: (id?: number | null) => string;
  branchName: (id?: number | null) => string;
  productName: (id: number) => string;
  unitLabel: (id: number) => string;
  deliveryAt: string;
  onDelivery: (v: string) => void;
  lines: DraftLine[];
  setLineQty: (lineId: number, quantity: string) => void;
  setLineRate: (lineId: number, rate: string) => void;
  total: number;
  notes: string;
  onNotes: (v: string) => void;
}) {
  const {
    order,
    companyName,
    branchName,
    productName,
    unitLabel,
    deliveryAt,
    onDelivery,
    lines,
    setLineQty,
    setLineRate,
    total,
    notes,
    onNotes,
  } = props;

  return (
    <div className="card border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Draft {order.orderNo}
        </h2>
        <Badge color="blue">DRAFT</Badge>
      </div>

      {/* What the buyer asked for — their document, captured at conversion. */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Against purchase order
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="PO number" value={order.poNumber ?? '—'} />
          <Fact
            label="PO date"
            value={
              order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'
            }
          />
          <Fact label="Customer" value={companyName(order.buyerCompanyId)} />
          <Fact label="Branch" value={branchName(order.buyerBranchId)} />
          <Fact label="Wanted by" value={fmtDelivery(order.poDeliveryAt)} />
        </div>
        {order.poNotes && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Their instructions
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {order.poNotes}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Delivery date & time we commit to"
          type="datetime-local"
          value={deliveryAt}
          onChange={(e) => onDelivery(e.target.value)}
        />
      </div>

      <div className="mt-6">
        <span className="label !mb-0">Supply</span>
        <p className="mt-1 text-xs text-slate-500">
          One product may appear more than once — a line per batch, each at that
          batch&apos;s own price. A batch price can&apos;t be changed: the goods carry it.
          A line with no batch is still to be produced, so its price is only an
          estimate and stays editable. Set a quantity to 0 to drop a line.
        </p>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
            <th className="py-2 pr-2">Product</th>
            <th className="w-40 py-2 px-1">Batch</th>
            <th className="w-20 py-2 px-1 text-right">Asked</th>
            <th className="w-24 py-2 px-1 text-right">Supplying</th>
            <th className="w-14 py-2 px-1">Unit</th>
            <th className="w-24 py-2 px-1 text-right">Rate</th>
            <th className="w-28 py-2 px-1 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((src) => {
            const l = lines.find((x) => x.lineId === src.id);
            const qty = Number(l?.quantity) || 0;
            const rate = Number(l?.rate) || 0;
            // No batch = nothing reserved: this quantity has to be produced, and
            // there's no batch price to inherit, so the price is open.
            const toProduce = !src.batchId;
            return (
              <tr
                key={src.id}
                className="border-b border-slate-100 dark:border-slate-800/60"
              >
                <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                  {productName(src.productId)}
                </td>
                <td className="px-1 text-xs">
                  {toProduce ? (
                    <span className="font-medium text-amber-600 dark:text-amber-500">
                      To produce
                    </span>
                  ) : (
                    <span className="font-mono text-slate-500">{src.batchNo}</span>
                  )}
                </td>
                <td className="px-1 text-right tabular-nums text-slate-500">
                  {src.orderedQty.toLocaleString()}
                </td>
                <td className="px-1">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={l?.quantity ?? ''}
                    onChange={(e) => setLineQty(src.id, e.target.value)}
                    className="text-right tabular-nums"
                  />
                </td>
                <td className="px-1 text-slate-500">{unitLabel(src.unitId)}</td>
                <td className="px-1">
                  {toProduce ? (
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={l?.rate ?? ''}
                      onChange={(e) => setLineRate(src.id, e.target.value)}
                      className="text-right tabular-nums"
                      title="Estimated — no batch exists yet to set the price"
                    />
                  ) : (
                    <span
                      className="block text-right tabular-nums text-slate-500"
                      title="The batch's own price — the goods carry it"
                    >
                      {money(rate)}
                    </span>
                  )}
                </td>
                <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {money(qty * rate)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 dark:border-slate-700">
            <td
              colSpan={6}
              className="py-2 pr-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Order value
            </td>
            <td className="px-1 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>

      <Textarea
        label="Notes"
        wrapClassName="mt-4"
        value={notes}
        onChange={(e) => onNotes(e.target.value)}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">
        {value}
      </p>
    </div>
  );
}
