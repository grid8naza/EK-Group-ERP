'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Truck,
  Plus,
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
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { LocalPurchaseOrderDoc } from '@/components/purchase/LocalPurchaseOrderDoc';
import { resolveIcon } from '@/lib/icons';
import type {
  Item,
  Product,
  Store,
  Supplier,
  Unit,
  LocalPurchaseOrder,
  LocalPurchaseOrderStatus,
  WorkflowStatus,
} from '@/lib/types';

const ROUTE = '/purchase/lpo';

/**
 * A line's target, encoded as one string so a single Select can offer items and
 * products together: "item:12" / "product:7". The backend takes them apart again
 * into the itemId / productId exclusive-or.
 */
type DraftLine = { target: string; quantity: string; rate: string };
type Mode = 'list' | 'edit' | 'view';

const statusColor = (s: LocalPurchaseOrderStatus) =>
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
// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
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

const targetOf = (l: { itemId?: number | null; productId?: number | null }) =>
  l.itemId ? `item:${l.itemId}` : `product:${l.productId}`;

export function LocalPurchaseOrderScreen() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  // Everything here is scoped to the ACTIVE company — unlike the ICPO, whose
  // catalogue comes from the counterparty. An external supplier has none.
  const { data: suppliers } = useFetch<Supplier[]>('/suppliers');
  const { data: stores } = useFetch<Store[]>('/stores');
  const { data: items } = useFetch<Item[]>('/items');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: statuses } = useFetch<WorkflowStatus[]>('/workflow-statuses');
  const statusByName = useMemo(
    () => new Map((statuses ?? []).map((s) => [s.name, s])),
    [statuses],
  );

  const {
    data: rows,
    loading,
    refetch,
  } = useFetch<LocalPurchaseOrder[]>('/local-purchase-orders');
  // When a workflow governs the LPO form, it supersedes the Add privilege.
  const { data: createAccess } = useFetch<{
    workflowGoverned: boolean;
    canCreate: boolean;
  }>('/local-purchase-orders/create-access');

  const canAdd = can(ROUTE, 'add');
  const canDeletePriv = can(ROUTE, 'delete');
  const canCreate = canAdd && (createAccess?.canCreate ?? false);

  const supplierName = (id: number) =>
    (suppliers ?? []).find((s) => s.id === id)?.name ?? `#${id}`;
  const storeName = (id?: number | null) =>
    id ? ((stores ?? []).find((s) => s.id === id)?.name ?? `#${id}`) : '—';
  const unitLabel = (id: number) => {
    const u = (units ?? []).find((x) => x.id === id);
    return u?.symbol ?? u?.code ?? '';
  };

  // One option list spanning both masters, grouped so it's obvious which is
  // which — a raw material and a finished good can share a name.
  const targetOptions = useMemo(
    () => [
      ...(items ?? [])
        .filter((i) => i.isActive)
        .map((i) => ({ value: `item:${i.id}`, label: `${i.name} — Item` })),
      // Products are offered by the Can Sell capability alone — never by group
      // or form factor — the same rule the inter-company order uses.
      ...(products ?? [])
        .filter((p) => p.isActive && p.canSell)
        .map((p) => ({ value: `product:${p.id}`, label: `${p.name} — Product` })),
    ],
    [items, products],
  );
  // Unit + default rate come from whichever master the line points at.
  const targetInfo = useMemo(() => {
    const m = new Map<string, { unitId: number; rate: number; name: string }>();
    (items ?? []).forEach((i) =>
      m.set(`item:${i.id}`, {
        unitId: i.unitId,
        rate: i.lastPurchasePrice ?? 0,
        name: i.name,
      }),
    );
    (products ?? []).forEach((p) =>
      m.set(`product:${p.id}`, {
        unitId: p.unitId,
        rate: p.costPrice ?? 0,
        name: p.name,
      }),
    );
    return m;
  }, [items, products]);

  const targetName = (l: { itemId?: number | null; productId?: number | null }) =>
    targetInfo.get(targetOf(l))?.name ??
    (l.itemId ? `Item #${l.itemId}` : `Product #${l.productId}`);

  // ---- filters ----
  const [fSupplier, setFSupplier] = useState('');
  const [fStatus, setFStatus] = useState('');

  const supplierOptions = useMemo(() => {
    const m = new Map<number, string>();
    (rows ?? []).forEach((r) => m.set(r.supplierId, supplierName(r.supplierId)));
    return [...m.entries()].map(([value, label]) => ({ value, label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, suppliers]);
  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    (rows ?? []).forEach((r) => s.add(r.workflowStatus ?? r.status));
    return [...s].map((v) => ({ value: v, label: v }));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!fSupplier || String(r.supplierId) === fSupplier) &&
          (!fStatus || (r.workflowStatus ?? r.status) === fStatus),
      ),
    [rows, fSupplier, fStatus],
  );
  const hasFilters = !!(fSupplier || fStatus);

  // ---- screen state ----
  const [mode, setMode] = useState<Mode>('list');
  const [current, setCurrent] = useState<LocalPurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const myTask = current?.workflow?.myTask ?? null;

  // ---- editable draft form ----
  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [deliveryAt, setDeliveryAt] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');

  const addLine = () =>
    setLines((ls) => [...ls, { target: '', quantity: '', rate: '' }]);
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  // Picking a target seeds the rate from the master, but leaves it editable —
  // the agreed price is whatever the buyer negotiated.
  const pickTarget = (i: number, target: string) => {
    const info = targetInfo.get(target);
    setLines((ls) =>
      ls.map((l, idx) =>
        idx === i
          ? { ...l, target, rate: l.rate || String(info?.rate ?? '') }
          : l,
      ),
    );
  };

  const draftTotal = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
        0,
      ),
    [lines],
  );

  // ---- navigation ----
  const openNew = () => {
    setCurrent(null);
    setSupplierId('');
    // Default store: the one the masters flag as default for this branch.
    setStoreId(String((stores ?? []).find((s) => s.isDefault)?.id ?? ''));
    setDeliveryAt('');
    setLines([]);
    setNotes('');
    setMode('edit');
  };

  const loadOrder = async (id: number) => {
    const full = await api.get<LocalPurchaseOrder>(`/local-purchase-orders/${id}`);
    setCurrent(full);
    setComment('');
    setSupplierId(String(full.supplierId));
    setStoreId(full.storeId ? String(full.storeId) : '');
    setDeliveryAt(toLocalInput(full.deliveryAt));
    setLines(
      full.lines.map((l) => ({
        target: targetOf(l),
        quantity: String(l.quantity),
        rate: String(l.rate),
      })),
    );
    setNotes(full.notes ?? '');
    return full;
  };

  const openView = async (row: LocalPurchaseOrder) => {
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

  const del = async (row: LocalPurchaseOrder) => {
    const ok = await confirm({
      title: 'Delete draft',
      message: `Delete draft ${row.orderNo}? This cannot be undone.`,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/local-purchase-orders/${row.id}`);
      toast.success('Draft deleted.');
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- persistence ----
  const buildLines = () =>
    lines
      .filter((l) => l.target && Number(l.quantity) > 0)
      .map((l) => {
        const [kind, id] = l.target.split(':');
        return {
          itemId: kind === 'item' ? Number(id) : undefined,
          productId: kind === 'product' ? Number(id) : undefined,
          quantity: Number(l.quantity),
          rate: Number(l.rate) || 0,
        };
      });

  const validate = (): string | null => {
    if (!current && !supplierId) return 'Select a supplier.';
    if (buildLines().length === 0)
      return 'Add at least one line with a quantity.';
    return null;
  };

  const persist = async (): Promise<LocalPurchaseOrder> => {
    const payloadLines = buildLines();
    const body = {
      deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
      storeId: storeId ? Number(storeId) : null,
      notes: notes.trim(),
      lines: payloadLines,
    };
    if (current) {
      return api.patch<LocalPurchaseOrder>(
        `/local-purchase-orders/${current.id}`,
        body,
      );
    }
    return api.post<LocalPurchaseOrder>('/local-purchase-orders', {
      ...body,
      supplierId: Number(supplierId),
      notes: notes.trim() || undefined,
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
      toast.success(current ? 'Draft saved.' : 'Draft created.');
      if (close) backToList();
      else setCurrent(saved);
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
      await api.post(`/local-purchase-orders/${saved.id}/submit`, {});
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
      await api.post(`/local-purchase-orders/${current.id}/act`, {
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
  const columns: Column<LocalPurchaseOrder>[] = [
    { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
    {
      key: 'supplier',
      header: 'Supplier',
      accessor: (r) => supplierName(r.supplierId),
    },
    {
      key: 'store',
      header: 'Deliver To',
      accessor: (r) => storeName(r.storeId),
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
      key: 'date',
      header: 'Placed',
      accessor: (r) => new Date(r.createdAt).toLocaleDateString(),
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
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto pb-6">
        {/* Action bar — frozen to the top of the scroll area, so the buttons stay
            reachable however far down the document you are. */}
        <div className="sticky top-0 z-20 -mt-1 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 bg-[#f0f2f5]/90 py-3 backdrop-blur dark:border-slate-800/60 dark:bg-slate-950/90">
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

        {isEditing ? (
          <DraftEditor
            creating={!current}
            supplierId={supplierId}
            onSupplier={setSupplierId}
            suppliers={(suppliers ?? []).filter((s) => s.isActive)}
            storeId={storeId}
            onStore={setStoreId}
            stores={(stores ?? []).filter((s) => s.isActive)}
            deliveryAt={deliveryAt}
            onDelivery={setDeliveryAt}
            lines={lines}
            targetOptions={targetOptions}
            targetInfo={targetInfo}
            unitLabel={unitLabel}
            total={draftTotal}
            addLine={addLine}
            setLine={setLine}
            pickTarget={pickTarget}
            removeLine={removeLine}
            notes={notes}
            onNotes={setNotes}
            orderNo={current?.orderNo}
          />
        ) : (
          current && (
            <>
              <LocalPurchaseOrderDoc
                order={current}
                supplierName={supplierName}
                storeName={storeName}
                targetName={targetName}
                unitLabel={unitLabel}
              />
              {myTask && (
                <div className="mx-auto w-full max-w-5xl">
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
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Local Purchase Order (LPO)"
        description="Orders your company raised on an external supplier"
        icon={<Truck className="h-5 w-5" />}
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New LPO
            </button>
          ) : undefined
        }
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
        emptyMessage="No local purchase orders yet"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={fSupplier}
              onChange={(e) => setFSupplier(e.target.value)}
              placeholder="All suppliers"
              options={supplierOptions}
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
                  setFSupplier('');
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

// --- draft editor (extracted to keep the screen readable) ---
function DraftEditor(props: {
  creating: boolean;
  supplierId: string;
  onSupplier: (v: string) => void;
  suppliers: Supplier[];
  storeId: string;
  onStore: (v: string) => void;
  stores: Store[];
  deliveryAt: string;
  onDelivery: (v: string) => void;
  lines: DraftLine[];
  targetOptions: { value: string; label: string }[];
  targetInfo: Map<string, { unitId: number; rate: number; name: string }>;
  unitLabel: (id: number) => string;
  total: number;
  addLine: () => void;
  setLine: (i: number, patch: Partial<DraftLine>) => void;
  pickTarget: (i: number, target: string) => void;
  removeLine: (i: number) => void;
  notes: string;
  onNotes: (v: string) => void;
  orderNo?: string;
}) {
  const {
    creating,
    supplierId,
    onSupplier,
    suppliers,
    storeId,
    onStore,
    stores,
    deliveryAt,
    onDelivery,
    lines,
    targetOptions,
    targetInfo,
    unitLabel,
    total,
    addLine,
    setLine,
    pickTarget,
    removeLine,
    notes,
    onNotes,
    orderNo,
  } = props;

  return (
    <div className="card border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {orderNo ? `Draft ${orderNo}` : 'New LPO'}
        </h2>
        {orderNo && <Badge color="blue">DRAFT</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Supplier"
          required
          disabled={!creating}
          title={!creating ? 'Supplier cannot change after creation' : undefined}
          value={supplierId}
          onChange={(e) => onSupplier(e.target.value)}
          placeholder="Select a supplier"
          options={suppliers.map((s) => ({
            value: s.id,
            label: `${s.name} (${s.code})`,
          }))}
        />
        <Select
          label="Deliver to"
          value={storeId}
          onChange={(e) => onStore(e.target.value)}
          placeholder="Select a store"
          options={stores.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Input
          label="Delivery date & time"
          type="datetime-local"
          value={deliveryAt}
          onChange={(e) => onDelivery(e.target.value)}
        />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="label !mb-0">Items &amp; products</span>
        <button className="btn-secondary text-xs" onClick={addLine}>
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
            <th className="py-2 pr-2">Item / Product</th>
            <th className="w-28 py-2 px-1 text-right">Quantity</th>
            <th className="w-14 py-2 px-1">Unit</th>
            <th className="w-28 py-2 px-1 text-right">Rate</th>
            <th className="w-28 py-2 px-1 text-right">Value</th>
            <th className="w-12 py-2" />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-4 text-center text-xs text-slate-400">
                No lines yet — click “Add line”.
              </td>
            </tr>
          ) : (
            lines.map((l, i) => {
              const info = l.target ? targetInfo.get(l.target) : undefined;
              const value = (Number(l.quantity) || 0) * (Number(l.rate) || 0);
              return (
                <tr
                  key={i}
                  className="border-b border-slate-100 dark:border-slate-800/60"
                >
                  <td className="py-1.5 pr-2">
                    <Select
                      value={l.target}
                      onChange={(e) => pickTarget(i, e.target.value)}
                      placeholder="Select an item or product"
                      options={targetOptions}
                    />
                  </td>
                  <td className="px-1">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td className="px-1 text-slate-500">
                    {info ? unitLabel(info.unitId) : ''}
                  </td>
                  <td className="px-1">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={l.rate}
                      onChange={(e) => setLine(i, { rate: e.target.value })}
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                    {money(value)}
                  </td>
                  <td className="text-center">
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                      onClick={() => removeLine(i)}
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {lines.length > 0 && (
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700">
              <td colSpan={4} className="py-2 pr-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                Order value
              </td>
              <td className="px-1 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {money(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        )}
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
