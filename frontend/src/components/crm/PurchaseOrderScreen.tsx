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
  Package,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useDocumentLink, useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PurchaseOrderDoc } from '@/components/crm/PurchaseOrderDoc';
import {
  PurchaseOrderReview,
  type ReviewLine,
} from '@/components/crm/PurchaseOrderReview';
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
  // Stock & acceptance is its own tab rather than a card stacked under the
  // document: on an order with many lines it would sit a long scroll away, and
  // it answers a different question from the one the document answers.
  const [tab, setTab] = useState<'order' | 'stock'>('order');
  const [current, setCurrent] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  // Approver action state (when the open order has a pending task for this user).
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const myTask = current?.workflow?.myTask ?? null;

  // Unsaved edits (draft fields or the reviewer's accepted quantities). Set by
  // every edit path, cleared on load and after a successful save — so leaving
  // the form or closing the tab can warn before the work is lost.
  const [dirty, setDirty] = useState(false);
  const markDirty = () => setDirty(true);
  // Leaving the screen entirely — the sidebar menu, any other in-app link, or a
  // browser refresh — is caught here; the in-app Back button, which only drops
  // back to the list, gets its own Yes/No dialog (see requestBackToList).
  useUnsavedChangesGuard(() => dirty);

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

  const addLine = () => {
    markDirty();
    setLines((ls) => [...ls, { productId: '', quantity: '' }]);
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => {
    markDirty();
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const removeLine = (i: number) => {
    markDirty();
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  };

  // ---- navigation ----
  const openNew = () => {
    setCurrent(null);
    setSupplierId('');
    setDeliveryAt('');
    setLines([]);
    setNotes('');
    setDirty(false);
    setMode('edit');
  };

  const loadOrder = async (id: number) => {
    const full = await api.get<PurchaseOrder>(`/purchase-orders/${id}`);
    setCurrent(full);
    seedReview(full);
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
    setDirty(false);
    return full;
  };

  const openById = async (id: number) => {
    try {
      const full = await loadOrder(id);
      // Always open on the document — it's what identifies the order. The
      // reviewer switches to Stock & acceptance when they're ready to answer.
      setTab('order');
      // Drafts are the requester's to edit; they never reach the Received list.
      setMode(isSent && full.status === 'DRAFT' ? 'edit' : 'view');
    } catch {
      toast.error('Failed to open the order.');
    }
  };
  /** Opened straight from a link — the approvals inbox sends an id, not a row. */
  useDocumentLink(openById);

  const openView = async (row: PurchaseOrder) => openById(row.id);

  const backToList = () => {
    setMode('list');
    setCurrent(null);
    setDirty(false);
    refetch();
  };

  // The Back button: warn before discarding unsaved edits. Programmatic returns
  // (after a save / action) go straight through backToList — by then there is
  // nothing pending, so they never reach this prompt.
  const requestBackToList = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes. Leave without saving?',
        confirmText: 'Yes',
        cancelText: 'No',
        danger: true,
        defaultCancel: true,
      });
      if (!ok) return;
    }
    backToList();
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
    const ok = await confirm({
      title: current ? 'Save changes?' : 'Save draft?',
      message: current
        ? 'Save the changes to this order?'
        : 'Save this order as a draft?',
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const saved = await persist();
      setDirty(false);
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
    const ok = await confirm({
      title: 'Submit for approval?',
      message: 'Submit this order into the approval workflow?',
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const saved = await persist();
      await api.post(`/purchase-orders/${saved.id}/submit`, {});
      setDirty(false);
      toast.success('Order submitted for approval.');
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to submit.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Customer Relations' review (Received side, while we hold the task) ----
  // Seeded from the order: an unreviewed line defaults to the buyer's ask, so
  // "accept it all" needs no typing.
  const [review, setReview] = useState<ReviewLine[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [reserving, setReserving] = useState(false);
  const seedReview = (o: PurchaseOrder) =>
    setReview(
      o.lines.map((l) => ({
        lineId: l.id,
        acceptedQty: String(l.acceptedQty ?? l.quantity),
        cancelled: !!l.cancelled,
      })),
    );
  const setAccepted = (lineId: number, acceptedQty: string) => {
    markDirty();
    setReview((ls) =>
      ls.map((l) => (l.lineId === lineId ? { ...l, acceptedQty } : l)),
    );
  };
  const toggleCancel = (lineId: number) => {
    markDirty();
    setReview((ls) =>
      ls.map((l) => (l.lineId === lineId ? { ...l, cancelled: !l.cancelled } : l)),
    );
  };

  const saveReview = async (): Promise<PurchaseOrder | null> => {
    if (!current) return null;
    setReviewing(true);
    try {
      const saved = await api.patch<PurchaseOrder>(
        `/purchase-orders/${current.id}/review`,
        {
          lines: review.map((l) => ({
            lineId: l.lineId,
            acceptedQty: Number(l.acceptedQty) || 0,
            cancelled: l.cancelled,
          })),
        },
      );
      setCurrent(saved);
      seedReview(saved);
      setDirty(false);
      return saved;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
      return null;
    } finally {
      setReviewing(false);
    }
  };

  // The review Save BUTTON confirms first; the internal saveReview() that
  // Forward and Reserve call ahead of their own action deliberately does not,
  // so those flows prompt once, not twice.
  const confirmSaveReview = async () => {
    const ok = await confirm({
      title: 'Save accepted quantities?',
      message: 'Save the accepted quantities on this order?',
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (!ok) return;
    await saveReview();
  };

  // Save first, then reserve: reserving allocates against the accepted
  // quantities, so sending them separately would hold stock for whatever was
  // saved last rather than what's on screen.
  const doReserve = async () => {
    if (!current) return;
    const ok = await confirm({
      title: 'Reserve stock?',
      message:
        'Save the accepted quantities and reserve stock against them (FEFO)?',
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (!ok) return;
    const saved = await saveReview();
    if (!saved) return;
    setReserving(true);
    try {
      const after = await api.post<PurchaseOrder>(
        `/purchase-orders/${current.id}/reserve`,
        {},
      );
      setCurrent(after);
      seedReview(after);
      const short = after.lines.filter((l) => (l.balanceQty ?? 0) > 0).length;
      toast.success(
        short
          ? `Stock reserved. ${short} line${short === 1 ? '' : 's'} short — the balance needs producing.`
          : 'Stock reserved in full.',
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to reserve.');
    } finally {
      setReserving(false);
    }
  };

  // Turn an approved order into our own sales order. Supplier side only — we're
  // the seller — and deliberate rather than automatic, because the point of the
  // step is checking the quantities we can actually commit to.
  const [converting, setConverting] = useState(false);
  const doConvert = async () => {
    if (!current) return;
    const ok = await confirm({
      title: 'Convert to sales order?',
      message: `Create a sales order from ${current.orderNo}? It opens as a draft with the quantities ${counterpartyName(current)} asked for — trim them before submitting.`,
      confirmText: 'Yes',
      cancelText: 'No',
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

  // Does the acting user still have a further action on this same order? Two
  // ways the workflow can hand someone consecutive steps: another routed task
  // lands back on them (workflow.myTask), or an approval unlocks the supplier's
  // manual convert-to-sales-order step. When either holds we keep the form open
  // on the refreshed order rather than closing it — the operations manager who
  // gives final approval then converts straight away, no reopen.
  const hasFollowUpAction = (o: PurchaseOrder) =>
    !!o.workflow?.myTask ||
    (!isSent &&
      o.status === 'APPROVED' &&
      !o.salesOrderId &&
      can('/crm/icso', 'add'));

  // Approver action on a routed order (forward / approve / reject / cancel).
  const doAct = async (action: 'FORWARD' | 'REJECT' | 'CANCEL') => {
    if (!current) return;
    if (action === 'REJECT' && !comment.trim()) {
      toast.error('A reason is required to reject.');
      return;
    }
    // Every workflow action is confirmed Yes/No before it fires — each one moves
    // the order through approval and can't be undone.
    const actLabel =
      action === 'REJECT'
        ? 'Reject'
        : action === 'CANCEL'
          ? 'Cancel order'
          : (myTask?.buttonText ?? current.viewer?.submitButtonText ?? 'Forward');
    const ok = await confirm({
      title: `${actLabel}?`,
      message:
        action === 'CANCEL'
          ? `Cancel ${current.orderNo}? This withdraws it from the approval workflow and cannot be undone.`
          : action === 'REJECT'
            ? `Reject ${current.orderNo}? It returns to the requester and cannot be undone.`
            : `${actLabel} ${current.orderNo}? This moves it to the next level.`,
      confirmText: 'Yes',
      cancelText: 'No',
      danger: action !== 'FORWARD',
    });
    if (!ok) return;
    setActing(true);
    try {
      // Forwarding hands the order to the next approver, so whatever the reviewer
      // typed has to be on it first — otherwise Operations approves quantities
      // that were never saved. Reject/cancel discard the review anyway.
      if (action === 'FORWARD' && current.viewer?.canReview) {
        const saved = await saveReview();
        if (!saved) return;
      }
      // `act` returns the freshly recomputed order for THIS user at the new
      // workflow position — including whether they still hold the next step.
      const updated = await api.post<PurchaseOrder>(
        `/purchase-orders/${current.id}/act`,
        {
          action,
          comment: comment.trim() || undefined,
        },
      );
      // Approving may leave the same user with the very next action. Stay on the
      // document, refreshed, so they act again without reopening it. Reject and
      // cancel are terminal for the actor, so those always return to the list.
      if (action === 'FORWARD' && hasFollowUpAction(updated)) {
        setCurrent(updated);
        seedReview(updated);
        setComment('');
        refetch();
        toast.success('Done — this order still needs your next step.');
      } else {
        toast.success(
          action === 'REJECT'
            ? 'Order rejected.'
            : action === 'CANCEL'
              ? 'Order cancelled.'
              : 'Done — moved to the next level.',
        );
        backToList();
      }
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
    // The stock answer belongs to the ORDER, not to whoever is holding it: once
    // Customer Relations has said what they'll supply and reserved against it,
    // everyone downstream needs to see those numbers — Operations is approving
    // exactly them. So the panel shows for the whole of the supplier's side of
    // the order's life, and only the INPUTS are gated on holding an editing task.
    const showReview =
      !isSent &&
      !!current &&
      current.status !== 'DRAFT' &&
      current.status !== 'CANCELLED';
    // The seller answers the order while it sits with them on an editing step.
    const canReview = showReview && !!current?.viewer?.canReview;
    return (
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto pb-6">
        {/* Action bar — frozen to the top of the scroll area, so Save / Reserve /
            Forward stay reachable however far down the document you are. The
            translucent backdrop keeps the lines from showing through as they pass
            underneath. */}
        <div className="sticky top-0 z-20 -mt-1 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 bg-[#f0f2f5]/90 py-3 backdrop-blur dark:border-slate-800/60 dark:bg-slate-950/90">
          <button className="btn-ghost" onClick={requestBackToList}>
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
              {/* The reviewer's own actions, before they hand the order on. */}
              {canReview && (
                <>
                  <button
                    className="btn-secondary"
                    onClick={confirmSaveReview}
                    disabled={reviewing || reserving}
                  >
                    Save
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={doReserve}
                    disabled={reviewing || reserving}
                  >
                    <Package className="h-4 w-4" />{' '}
                    {reserving ? 'Reserving…' : 'Reserve stock'}
                  </button>
                </>
              )}
              {myTask && (
                <button
                  className="btn-primary"
                  onClick={() => doAct('FORWARD')}
                  disabled={acting || reviewing || reserving}
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

        {/* Tabs ride with the frozen bar, so switching sides of the order never
            means scrolling back up. Only the supplier gets a second side. */}
        {showReview && !isEditing && (
          <div className="sticky top-[3.75rem] z-10 -mt-2 bg-[#f0f2f5]/90 pb-1 pt-1 backdrop-blur dark:bg-slate-950/90">
            <Tabs
              tabs={[
                { key: 'order', label: 'Purchase Order' },
                {
                  key: 'stock',
                  label: 'Stock & acceptance',
                  icon: <Package className="h-4 w-4" />,
                },
              ]}
              active={tab}
              onChange={(k) => setTab(k as 'order' | 'stock')}
            />
          </div>
        )}

        {isEditing ? (
          <DraftEditor
            creating={!current}
            supplierId={supplierId}
            onSupplier={(v) => {
              markDirty();
              setSupplierId(v);
              setLines([]);
            }}
            suppliers={suppliers}
            deliveryAt={deliveryAt}
            onDelivery={(v) => {
              markDirty();
              setDeliveryAt(v);
            }}
            lines={lines}
            products={products}
            productById={productById}
            addLine={addLine}
            setLine={setLine}
            removeLine={removeLine}
            notes={notes}
            onNotes={(v) => {
              markDirty();
              setNotes(v);
            }}
            orderNo={current?.orderNo}
          />
        ) : (
          current && (
            <>
              {/* One tab at a time — stacking them meant scrolling the whole
                  document to reach the stock answer on a long order. */}
              {(!showReview || tab === 'order') && (
                <PurchaseOrderDoc
                  order={current}
                  companyName={companyName}
                  branchName={branchName}
                  productName={productName}
                  unitLabel={unitLabel}
                />
              )}
              {showReview && tab === 'stock' && (
                <PurchaseOrderReview
                  order={current}
                  lines={review}
                  productName={productName}
                  unitLabel={unitLabel}
                  onAccepted={setAccepted}
                  onToggleCancel={toggleCancel}
                  // Read-only for everyone but the current reviewer — the next
                  // approver reads these numbers, they don't set them.
                  readOnly={!canReview}
                  disabled={reviewing || reserving}
                />
              )}
              {/* The comment feeds Reject / Forward, which live in the frozen bar
                  above — so it belongs to the order, not to either tab. */}
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

  // What this SUPPLIER sells. Two criteria: the product is sold at all
  // (product-level Can Sell — an intermediate never is), and the supplier's own
  // company row is ticked Sells. The second is what keeps a company that merely
  // buys the product in from being offered as a source of it.
  const sellableOptions = useMemo(() => {
    const supplier = Number(supplierId);
    return products
      .filter(
        (pr) =>
          pr.canSell &&
          pr.companies?.some((c) => c.companyId === supplier && c.canSell),
      )
      .map((pr) => ({ value: pr.id, label: pr.name }));
  }, [products, supplierId]);

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
                          options={sellableOptions}
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
          </table>
          {/* No value here on purpose: an intercompany order is quantities only.
              What it will be worth depends on the batches that end up filling it,
              which nobody knows yet — the sales order carries the prices. */}

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
