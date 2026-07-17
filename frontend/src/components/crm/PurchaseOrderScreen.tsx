'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShoppingCart,
  Inbox,
  Plus,
  Trash2,
  ArrowLeft,
  Send,
  Check,
  X,
  Ban,
  ClipboardList,
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
import { PurchaseOrderDoc } from '@/components/crm/PurchaseOrderDoc';
import { resolveIcon } from '@/lib/icons';
import type {
  Branch,
  Company,
  Product,
  Unit,
  PurchaseOrder,
  PurchaseOrderStatus,
  WorkflowStatus,
} from '@/lib/types';

/**
 * Which side of an inter-company order this screen shows. A PO is ONE row: the
 * active company is either the requester (`sent`) or the supplier (`received`).
 * Only the requester raises and edits it; the supplier reads it and acts on its
 * workflow task. Keeping the two apart matters because a company is usually both.
 */
export type PurchaseOrderScope = 'sent' | 'received';

type DraftLine = { productId: string; quantity: string };
type Mode = 'list' | 'edit' | 'view';

// The buyer's side lives in the Purchase module, the supplier's in CRM, and the
// routes are module-namespaced to match. Titles carry the full expansion — the
// menu only has room for the acronym.
const SCREEN = {
  sent: {
    route: '/purchase/icpo',
    title: 'Inter-Company Purchase Order (ICPO)',
    description: 'Orders your company raised on another group company',
    partyHeader: 'Supplier',
    empty: 'No inter-company purchase orders raised yet',
  },
  received: {
    route: '/crm/icpo-received',
    title: 'Inter-Company Purchase Order — Received',
    description: 'Orders other group companies raised on yours',
    partyHeader: 'Customer',
    empty: 'No inter-company purchase orders received yet',
  },
} as const;

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
const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function PurchaseOrderScreen({ scope }: { scope: PurchaseOrderScope }) {
  const isSent = scope === 'sent';
  const screen = SCREEN[scope];
  const ROUTE = screen.route;

  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { data: units } = useFetch<Unit[]>('/units');
  // Status vocabulary — to show each order's status as its configured icon/colour.
  const { data: statuses } = useFetch<WorkflowStatus[]>('/workflow-statuses');
  const statusByName = useMemo(
    () => new Map((statuses ?? []).map((s) => [s.name, s])),
    [statuses],
  );
  const {
    data: rows,
    loading,
    refetch,
  } = useFetch<PurchaseOrder[]>(`/purchase-orders?scope=${scope}`, [scope]);
  // When a workflow governs the PO form, it supersedes the Add privilege: only
  // the workflow's designated creator may raise an order. Only the requester
  // ever creates, so the Received screen doesn't ask.
  const { data: createAccess } = useFetch<{
    workflowGoverned: boolean;
    canCreate: boolean;
  }>(isSent ? '/purchase-orders/create-access' : null);

  const canAdd = can(ROUTE, 'add');
  const canDeletePriv = can(ROUTE, 'delete');
  // Show "New" only when the screen privilege allows AND the workflow (if any)
  // designates this user a creator.
  const canCreate = isSent && canAdd && (createAccess?.canCreate ?? false);

  const suppliers = useMemo(
    () => (companies ?? []).filter((c) => c.id !== activeCompanyId),
    [companies, activeCompanyId],
  );
  const companyName = (id: number) =>
    (companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`;
  const branchName = (id?: number | null) =>
    id ? ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`) : '—';

  // The counterparty is whichever side the active company is NOT: on Sent we
  // raised it, so the other party is the supplier (companyId); on Received it
  // was raised on us, so the other party is the customer (orderingCompanyId).
  const counterpartyId = (r: PurchaseOrder) =>
    isSent ? r.companyId : r.orderingCompanyId;
  const counterpartyName = (r: PurchaseOrder) => companyName(counterpartyId(r));

  // ---- filters (Company / Branch / Status) ----
  const [fCompany, setFCompany] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fStatus, setFStatus] = useState('');

  // Options are derived from the loaded rows, so only values actually present
  // are offered (and they match what the list shows).
  const companyOptions = useMemo(() => {
    const m = new Map<number, string>();
    (rows ?? []).forEach((r) => m.set(counterpartyId(r), counterpartyName(r)));
    return [...m.entries()].map(([value, label]) => ({ value, label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, companies, isSent]);
  const branchOptions = useMemo(() => {
    const m = new Map<number, string>();
    (rows ?? []).forEach((r) => {
      if (r.orderingBranchId)
        m.set(r.orderingBranchId, branchName(r.orderingBranchId));
    });
    return [...m.entries()].map(([value, label]) => ({ value, label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, branches]);
  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    (rows ?? []).forEach((r) => s.add(r.workflowStatus ?? r.status));
    return [...s].map((v) => ({ value: v, label: v }));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!fCompany || String(counterpartyId(r)) === fCompany) &&
          (!fBranch || String(r.orderingBranchId ?? '') === fBranch) &&
          (!fStatus || (r.workflowStatus ?? r.status) === fStatus),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, fCompany, fBranch, fStatus, isSent],
  );
  const hasFilters = !!(fCompany || fBranch || fStatus);
  const clearFilters = () => {
    setFCompany('');
    setFBranch('');
    setFStatus('');
  };
  const unitLabel = (id: number) => {
    const u = (units ?? []).find((x) => x.id === id);
    return u?.symbol ?? u?.code ?? '';
  };

  // ---- screen state ----
  const [mode, setMode] = useState<Mode>('list');
  const [current, setCurrent] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  // Approver action state (when the open order has a pending task for this user).
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const myTask = current?.workflow?.myTask ?? null;

  // ---- editable draft form ----
  const [supplierId, setSupplierId] = useState('');
  const [deliveryAt, setDeliveryAt] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Product[]>([]);

  // Products belong to the SUPPLIER; fetch that company's catalogue. Needed on
  // both screens — the document view names each ordered product.
  useEffect(() => {
    if (!supplierId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    api
      .get<Product[]>(`/products?forCompanyId=${supplierId}`)
      .then((p) => !cancelled && setProducts(p ?? []))
      .catch(() => !cancelled && setProducts([]));
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const productName = (id: number) => productById.get(id)?.name ?? `#${id}`;

  const addLine = () => setLines((ls) => [...ls, { productId: '', quantity: '' }]);
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  // ---- navigation ----
  const openNew = () => {
    setCurrent(null);
    setSupplierId('');
    setDeliveryAt('');
    setLines([]);
    setNotes('');
    setMode('edit');
  };

  const loadOrder = async (id: number) => {
    const full = await api.get<PurchaseOrder>(`/purchase-orders/${id}`);
    setCurrent(full);
    setComment('');
    setSupplierId(String(full.companyId));
    setDeliveryAt(toLocalInput(full.deliveryAt));
    setLines(
      full.lines.map((l) => ({
        productId: String(l.productId),
        quantity: String(l.quantity),
      })),
    );
    setNotes(full.notes ?? '');
    return full;
  };

  const openView = async (row: PurchaseOrder) => {
    try {
      const full = await loadOrder(row.id);
      // Drafts are the requester's to edit; they never reach the Received list.
      setMode(isSent && full.status === 'DRAFT' ? 'edit' : 'view');
    } catch {
      toast.error('Failed to open the order.');
    }
  };

  const backToList = () => {
    setMode('list');
    setCurrent(null);
    refetch();
  };

  const del = async (row: PurchaseOrder) => {
    const ok = await confirm({
      title: 'Delete draft',
      message: `Delete draft ${row.orderNo}? This cannot be undone.`,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/purchase-orders/${row.id}`);
      toast.success('Draft deleted.');
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- persistence ----
  const buildLines = () => {
    const clean = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    return clean.map((l) => ({
      productId: Number(l.productId),
      quantity: Number(l.quantity),
      unitId: productById.get(Number(l.productId))!.unitId,
    }));
  };

  const validate = (): string | null => {
    if (!current && !supplierId) return 'Select a supplier company.';
    if (buildLines().length === 0)
      return 'Add at least one product line with a quantity.';
    return null;
  };

  // Create or update the draft; returns the persisted order (with id).
  const persist = async (): Promise<PurchaseOrder> => {
    const payloadLines = buildLines();
    if (current) {
      return api.patch<PurchaseOrder>(`/purchase-orders/${current.id}`, {
        deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
        notes: notes.trim(),
        lines: payloadLines,
      });
    }
    return api.post<PurchaseOrder>('/purchase-orders', {
      supplierCompanyId: Number(supplierId),
      deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
      notes: notes.trim() || undefined,
      lines: payloadLines,
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
      if (close) {
        backToList();
      } else {
        setCurrent(saved);
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
      await api.post(`/purchase-orders/${saved.id}/submit`, {});
      toast.success('Order submitted for approval.');
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to submit.');
    } finally {
      setSaving(false);
    }
  };

  // Turn an approved order into our own sales order. Supplier side only — we're
  // the seller — and deliberate rather than automatic, because the point of the
  // step is checking the quantities we can actually commit to.
  const [converting, setConverting] = useState(false);
  const doConvert = async () => {
    if (!current) return;
    const ok = await confirm({
      title: 'Convert to sales order',
      message: `Create a sales order from ${current.orderNo}? It opens as a draft with the quantities ${counterpartyName(current)} asked for — trim them before submitting.`,
      confirmText: 'Convert',
    });
    if (!ok) return;
    setConverting(true);
    try {
      const so = await api.post<{ id: number; orderNo: string }>(
        `/sales-orders/from-purchase-order/${current.id}`,
        {},
      );
      toast.success(`Sales order ${so.orderNo} created.`);
      router.push('/crm/icso');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to convert.');
    } finally {
      setConverting(false);
    }
  };

  // Approver action on a routed order (forward / approve / reject / cancel).
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

  // ---- list columns ----
  const columns: Column<PurchaseOrder>[] = [
    { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
    {
      key: 'party',
      header: screen.partyHeader,
      accessor: (r) => counterpartyName(r),
    },
    {
      key: 'branch',
      // The branch is always the requester's — ours on Sent, theirs on Received.
      header: isSent ? 'Branch' : 'Customer Branch',
      accessor: (r) => branchName(r.orderingBranchId),
    },
    {
      key: 'items',
      header: 'Items',
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
      // Workflow statuses show as their configured icon (hover shows the text);
      // plain draft/rejected/etc. statuses fall back to a text badge.
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
    // Only the supplier converts, only once the order is approved, and only with
    // the privilege to create the sales order it produces.
    const showConvert =
      !isSent && current?.status === 'APPROVED' && can('/crm/icso', 'add');
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-y-auto pb-6">
        {/* action bar */}
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
              <button
                className="btn-primary"
                onClick={doForward}
                disabled={saving}
              >
                <Send className="h-4 w-4" /> {submitLabel}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* Cancel: the acting approver's step, or the creator withdrawing
                  their own in-progress order. */}
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
              {/* Convert: ours to make only once the order is approved, and only
                  on the Received side — we're the seller. Converting twice is
                  blocked outright, so say so rather than offer a button. */}
              {showConvert &&
                (current?.salesOrderId ? (
                  <span className="text-sm text-slate-500">
                    Converted to{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {current.salesOrderNo}
                    </span>
                  </span>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={doConvert}
                    disabled={converting}
                  >
                    <ClipboardList className="h-4 w-4" /> Convert to Sales Order
                  </button>
                ))}
            </div>
          )}
        </div>

        {isEditing ? (
          <DraftEditor
            creating={!current}
            supplierId={supplierId}
            onSupplier={(v) => {
              setSupplierId(v);
              setLines([]);
            }}
            suppliers={suppliers}
            deliveryAt={deliveryAt}
            onDelivery={setDeliveryAt}
            lines={lines}
            products={products}
            productById={productById}
            addLine={addLine}
            setLine={setLine}
            removeLine={removeLine}
            notes={notes}
            onNotes={setNotes}
            orderNo={current?.orderNo}
          />
        ) : (
          current && (
            <>
              <PurchaseOrderDoc
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
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title={screen.title}
        description={screen.description}
        icon={
          isSent ? (
            <ShoppingCart className="h-5 w-5" />
          ) : (
            <Inbox className="h-5 w-5" />
          )
        }
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New ICPO
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
        emptyMessage={screen.empty}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={fCompany}
              onChange={(e) => setFCompany(e.target.value)}
              placeholder={isSent ? 'All suppliers' : 'All customers'}
              options={companyOptions}
              wrapClassName="w-44"
            />
            <Select
              value={fBranch}
              onChange={(e) => setFBranch(e.target.value)}
              placeholder="All branches"
              options={branchOptions}
              wrapClassName="w-40"
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
                onClick={clearFilters}
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
  suppliers: Company[];
  deliveryAt: string;
  onDelivery: (v: string) => void;
  lines: DraftLine[];
  products: Product[];
  productById: Map<number, Product>;
  addLine: () => void;
  setLine: (i: number, patch: Partial<DraftLine>) => void;
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
    deliveryAt,
    onDelivery,
    lines,
    products,
    productById,
    addLine,
    setLine,
    removeLine,
    notes,
    onNotes,
    orderNo,
  } = props;

  // What this order is worth at today's transfer prices. A draft tracks the
  // master; placing it fixes the rates, and the backend is the one that decides
  // them — this is a preview, not the source of truth.
  const draftTotal = lines.reduce((s, l) => {
    const p = l.productId ? productById.get(Number(l.productId)) : undefined;
    return s + (Number(l.quantity) || 0) * (p?.intercompanyPrice ?? 0);
  }, 0);

  return (
    <div className="card border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {orderNo ? `Draft ${orderNo}` : 'New ICPO'}
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
          placeholder="Select a supplier company"
          options={suppliers.map((c) => ({
            value: c.id,
            label: `${c.name} (${c.code})`,
          }))}
        />
        <Input
          label="Delivery date & time"
          type="datetime-local"
          value={deliveryAt}
          onChange={(e) => onDelivery(e.target.value)}
        />
      </div>

      {supplierId && (
        <>
          <div className="mt-6 flex items-center justify-between">
            <span className="label !mb-0">Products</span>
            <button className="btn-secondary text-xs" onClick={addLine}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </button>
          </div>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="py-2 pr-2">Product</th>
                <th className="w-28 py-2 px-1 text-right">Quantity</th>
                <th className="w-14 py-2 px-1">Unit</th>
                <th className="w-24 py-2 px-1 text-right">Rate</th>
                <th className="w-28 py-2 px-1 text-right">Value</th>
                <th className="w-12 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-4 text-center text-xs text-slate-400"
                  >
                    No lines yet — click “Add line”.
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => {
                  const p = l.productId
                    ? productById.get(Number(l.productId))
                    : undefined;
                  const rate = p?.intercompanyPrice ?? 0;
                  const value = (Number(l.quantity) || 0) * rate;
                  return (
                    <tr
                      key={i}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-1.5 pr-2">
                        <Select
                          value={l.productId}
                          onChange={(e) =>
                            setLine(i, { productId: e.target.value })
                          }
                          placeholder="Select product"
                          // Only sellable products can be ordered.
                          options={products
                            .filter((pr) => pr.canSell)
                            .map((pr) => ({ value: pr.id, label: pr.name }))}
                        />
                      </td>
                      <td className="px-1">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.quantity}
                          onChange={(e) =>
                            setLine(i, { quantity: e.target.value })
                          }
                          className="text-right tabular-nums"
                        />
                      </td>
                      <td className="px-1 text-slate-500">
                        {p ? (p.unit?.symbol ?? p.unit?.code ?? '') : ''}
                      </td>
                      {/* The transfer price is group policy — shown, not edited.
                          It's fixed onto the order when it's placed. */}
                      <td className="px-1 text-right tabular-nums text-slate-500">
                        {p ? money(rate) : ''}
                      </td>
                      <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {p ? money(value) : ''}
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
                  <td
                    colSpan={4}
                    className="py-2 pr-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Order value
                  </td>
                  <td className="px-1 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {money(draftTotal)}
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
        </>
      )}
    </div>
  );
}
