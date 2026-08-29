'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag,
  Plus,
  Trash2,
  ArrowLeft,
  Send,
  Check,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatDayMonthYear } from '@/lib/utils';
import { useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { FormSection } from '@/components/ui/FormSection';
import { Input, Select, Textarea } from '@/components/ui/Field';
import type { Branch, Customer, Product } from '@/lib/types';

const ROUTE = '/crm/lso';

type OrderStatus = 'DRAFT' | 'PLACED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface OrderLine {
  id?: number;
  productId: number;
  productCode: string | null;
  productName: string | null;
  quantity: number;
  unitId: number;
  unitSymbol: string;
  rate: number;
  amount: number;
}

interface LocalSalesOrder {
  id: number;
  branchId: number | null;
  branchName: string | null;
  orderNo: string;
  orderDate: string;
  deliveryAt: string | null;
  customerId: number | null;
  customerCode: string | null;
  customerName: string | null;
  status: OrderStatus;
  workflowStatus: string | null;
  notes: string | null;
  isLocked: boolean;
  total: number;
  lines: OrderLine[];
  // findOne only
  canEdit?: boolean;
  canSubmit?: boolean;
  submitButtonText?: string | null;
  canCancel?: boolean;
  workflow?: { myTask?: { canApprove?: boolean; canReject?: boolean } | null };
}

type DraftLine = { productId: string; quantity: string; rate: string };
const emptyLine = (): DraftLine => ({ productId: '', quantity: '', rate: '' });

const statusColor = (s: OrderStatus) =>
  s === 'APPROVED'
    ? 'green'
    : s === 'REJECTED'
      ? 'red'
      : s === 'CANCELLED'
        ? 'slate'
        : s === 'DRAFT'
          ? 'blue'
          : 'amber';

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * LSO — Local Sales Order: what an OUTSIDE customer has ordered from a branch.
 *
 * The third order document. ICPO is the branch asking the factory, ICSO is the
 * factory answering, and this is a shop, a caterer or an institution asking the
 * BRANCH. Unlike an ICSO it is typed from scratch and names its own price:
 * nobody has agreed one before it, because it is the first document in its chain.
 *
 * What it feeds: the Order Catalogue reads these as demand ON the branch. Goods
 * a customer has ordered are goods the branch must have on top of what its shelf
 * needs, so they ADD to what it orders from the factory.
 */
export default function LsoPage() {
  const { can, activeCompanyId, activeBranch } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const canAdd = can(ROUTE, 'add');
  const canDeletePriv = can(ROUTE, 'delete');

  const [mode, setMode] = useState<'list' | 'edit' | 'view'>('list');
  const [current, setCurrent] = useState<LocalSalesOrder | null>(null);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');

  const {
    data: rows,
    loading,
    refetch,
  } = useFetch<LocalSalesOrder[]>('/local-sales-orders');
  const { data: customers } = useFetch<Customer[]>('/customers');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { data: products } = useFetch<Product[]>(
    activeCompanyId ? `/products?forCompanyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  // When a workflow governs the form it supersedes the Add privilege: only its
  // designated creator may raise an order.
  const { data: createAccess } = useFetch<{
    workflowGoverned: boolean;
    canCreate: boolean;
  }>(canAdd ? '/local-sales-orders/create-access' : null);
  const canCreate = canAdd && (createAccess?.canCreate ?? false);

  // ---- the form ----
  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [deliveryAt, setDeliveryAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  useUnsavedChangesGuard(() => dirty);
  const markDirty = () => setDirty(true);

  const sellable = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.canSell)
        .map((p) => ({ value: p.id, label: p.name })),
    [products],
  );
  const productById = useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  );

  // Default the branch to the one in the header — an order is taken AT a branch,
  // and the catalogue reads it back for that branch.
  useEffect(() => {
    if (mode === 'edit' && !current && !branchId && activeBranch) {
      setBranchId(String(activeBranch.id));
    }
  }, [mode, current, branchId, activeBranch]);

  const openNew = () => {
    setCurrent(null);
    setCustomerId('');
    setBranchId(activeBranch ? String(activeBranch.id) : '');
    setDeliveryAt('');
    setNotes('');
    setLines([emptyLine()]);
    setComment('');
    setDirty(false);
    setMode('edit');
  };

  const openRow = async (row: LocalSalesOrder) => {
    try {
      const full = await api.get<LocalSalesOrder>(
        `/local-sales-orders/${row.id}`,
      );
      setCurrent(full);
      setCustomerId(full.customerId != null ? String(full.customerId) : '');
      setBranchId(full.branchId != null ? String(full.branchId) : '');
      setDeliveryAt(toLocalInput(full.deliveryAt));
      setNotes(full.notes ?? '');
      setLines(
        full.lines.map((l) => ({
          productId: String(l.productId),
          quantity: String(l.quantity),
          rate: String(l.rate),
        })),
      );
      setComment('');
      setDirty(false);
      setMode(full.status === 'DRAFT' && full.canEdit ? 'edit' : 'view');
    } catch {
      toast.error('Failed to open the order.');
    }
  };

  const backToList = () => {
    setMode('list');
    setCurrent(null);
    setDirty(false);
    refetch();
  };

  const requestBack = async () => {
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

  const setLine = (i: number, patch: Partial<DraftLine>) => {
    markDirty();
    setLines((ls) =>
      ls.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // Seed the price from the product's wholesale rate the first time one is
        // chosen — a starting point the branch can talk the customer out of, not
        // a price anybody has agreed.
        if (patch.productId && !l.rate) {
          const p = productById.get(Number(patch.productId));
          if (p?.wholesalePrice) next.rate = String(p.wholesalePrice);
        }
        return next;
      }),
    );
  };

  const buildLines = () =>
    lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: Number(l.productId),
        quantity: Number(l.quantity),
        unitId: productById.get(Number(l.productId))!.unitId,
        rate: Number(l.rate) || 0,
      }));

  const draftTotal = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
        0,
      ),
    [lines],
  );

  const persist = async () => {
    if (!customerId) {
      toast.error('Choose the customer.');
      return null;
    }
    if (!buildLines().length) {
      toast.error('Add at least one product with a quantity.');
      return null;
    }
    const payload = {
      customerId: Number(customerId),
      branchId: branchId ? Number(branchId) : null,
      deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
      notes: notes.trim() || undefined,
      lines: buildLines(),
    };
    return current
      ? api.patch<LocalSalesOrder>(`/local-sales-orders/${current.id}`, payload)
      : api.post<LocalSalesOrder>('/local-sales-orders', payload);
  };

  const save = async (close: boolean) => {
    setSaving(true);
    try {
      const saved = await persist();
      if (!saved) return;
      setCurrent(saved);
      setDirty(false);
      toast.success(`Order ${saved.orderNo} saved.`);
      if (close) backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await persist();
      if (!saved) return;
      await api.post(`/local-sales-orders/${saved.id}/submit`, {});
      toast.success(`Order ${saved.orderNo} submitted.`);
      setDirty(false);
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to submit.');
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: 'APPROVE' | 'REJECT' | 'CANCEL') => {
    if (!current) return;
    setSaving(true);
    try {
      await api.post(`/local-sales-orders/${current.id}/act`, {
        action,
        comment: comment.trim() || undefined,
      });
      toast.success(`Order ${action.toLowerCase()}d.`);
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to act.');
    } finally {
      setSaving(false);
    }
  };

  const del = async (row: LocalSalesOrder) => {
    const ok = await confirm({
      title: 'Delete draft',
      message: `Delete draft ${row.orderNo}? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/local-sales-orders/${row.id}`);
      toast.success('Draft deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<LocalSalesOrder>[] = [
    { key: 'orderNo', header: 'Order', accessor: (r) => r.orderNo },
    {
      key: 'customer',
      header: 'Customer',
      accessor: (r) => r.customerName ?? '',
    },
    {
      key: 'branch',
      header: 'Branch',
      accessor: (r) => r.branchName ?? '',
      render: (r) => r.branchName ?? '—',
    },
    {
      key: 'orderDate',
      header: 'Ordered',
      sortAccessor: (r) => r.orderDate,
      render: (r) => formatDayMonthYear(r.orderDate),
    },
    {
      key: 'deliveryAt',
      header: 'Wanted',
      sortAccessor: (r) => r.deliveryAt ?? '',
      render: (r) => (r.deliveryAt ? formatDateTime(r.deliveryAt) : '—'),
    },
    {
      key: 'lines',
      header: 'Products',
      sortAccessor: (r) => r.lines.length,
      render: (r) => `${r.lines.length}`,
      className: 'text-right',
    },
    {
      key: 'total',
      header: 'Value',
      sortAccessor: (r) => r.total,
      render: (r) => money(r.total),
      className: 'text-right tabular-nums',
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => r.workflowStatus ?? r.status,
      render: (r) => (
        <Badge color={statusColor(r.status)}>
          {r.workflowStatus ?? r.status}
        </Badge>
      ),
    },
  ];

  if (mode !== 'list') {
    const readOnly = mode === 'view';
    const task = current?.workflow?.myTask;
    return (
      <div className="p-6">
        <PageHeader
          title={
            current ? `Customer order ${current.orderNo}` : 'New customer order'
          }
          description="What an outside customer has ordered from this branch"
          icon={<ShoppingBag className="h-5 w-5" />}
          actions={
            <>
              <button className="btn-secondary" onClick={requestBack}>
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              {!readOnly && (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => save(true)}
                    disabled={saving}
                  >
                    Save draft
                  </button>
                  <button
                    className="btn-primary"
                    onClick={submit}
                    disabled={saving}
                  >
                    <Send className="h-4 w-4" />
                    {current?.submitButtonText ?? 'Submit'}
                  </button>
                </>
              )}
              {readOnly && task?.canApprove && (
                <button
                  className="btn-success"
                  onClick={() => act('APPROVE')}
                  disabled={saving}
                >
                  <Check className="h-4 w-4" /> Approve
                </button>
              )}
              {readOnly && task?.canReject && (
                <button
                  className="btn-danger"
                  onClick={() => act('REJECT')}
                  disabled={saving}
                >
                  <X className="h-4 w-4" /> Reject
                </button>
              )}
            </>
          }
        />

        <div className="card p-6">
          <FormSection>The order</FormSection>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Customer"
              required
              disabled={readOnly}
              value={customerId}
              onChange={(e) => {
                markDirty();
                setCustomerId(e.target.value);
              }}
              placeholder="Select a customer"
              options={(customers ?? []).map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`,
              }))}
            />
            <Select
              label="Branch"
              disabled={readOnly}
              value={branchId}
              onChange={(e) => {
                markDirty();
                setBranchId(e.target.value);
              }}
              placeholder="— None —"
              options={(branches ?? [])
                .filter((b) => b.companyId === activeCompanyId)
                .map((b) => ({ value: b.id, label: b.name }))}
            />
            <Input
              label="Wanted on"
              type="datetime-local"
              disabled={readOnly}
              value={deliveryAt}
              onChange={(e) => {
                markDirty();
                setDeliveryAt(e.target.value);
              }}
              title="The day the customer wants it. The Order Catalogue counts this order against a delivery on or after that date."
            />
          </div>

          <FormSection>Products</FormSection>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-2">Product</th>
                  <th className="w-24 px-1 text-right">Quantity</th>
                  <th className="w-12 px-1">Unit</th>
                  <th className="w-28 px-1 text-right">Rate</th>
                  <th className="w-28 px-1 text-right">Amount</th>
                  {!readOnly && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = l.productId
                    ? productById.get(Number(l.productId))
                    : undefined;
                  const amount =
                    (Number(l.quantity) || 0) * (Number(l.rate) || 0);
                  return (
                    <tr
                      key={i}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-1.5 pr-2">
                        <Select
                          disabled={readOnly}
                          value={l.productId}
                          onChange={(e) =>
                            setLine(i, { productId: e.target.value })
                          }
                          placeholder="Select product"
                          options={sellable}
                        />
                      </td>
                      <td className="px-1">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          disabled={readOnly}
                          value={l.quantity}
                          onChange={(e) =>
                            setLine(i, { quantity: e.target.value })
                          }
                          className="text-right tabular-nums"
                        />
                      </td>
                      <td className="px-1 text-xs text-slate-500">
                        {p ? (p.unit?.symbol ?? p.unit?.code ?? '') : ''}
                      </td>
                      <td className="px-1">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          disabled={readOnly}
                          value={l.rate}
                          onChange={(e) => setLine(i, { rate: e.target.value })}
                          className="text-right tabular-nums"
                        />
                      </td>
                      <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {money(amount)}
                      </td>
                      {!readOnly && (
                        <td className="text-center">
                          <button
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                            onClick={() => {
                              markDirty();
                              setLines((ls) => ls.filter((_, x) => x !== i));
                            }}
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-3 text-right text-sm font-medium">
                    Total
                  </td>
                  <td className="pt-3 text-right text-sm font-semibold tabular-nums">
                    {money(draftTotal)}
                  </td>
                  {!readOnly && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
          {!readOnly && (
            <button
              className="btn-secondary mt-3 text-xs"
              onClick={() => {
                markDirty();
                setLines((ls) => [...ls, emptyLine()]);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add product
            </button>
          )}

          <Textarea
            label="Notes"
            wrapClassName="mt-6"
            disabled={readOnly}
            value={notes}
            onChange={(e) => {
              markDirty();
              setNotes(e.target.value);
            }}
          />

          {readOnly && (task?.canApprove || task?.canReject) && (
            <Textarea
              label="Comment"
              wrapClassName="mt-4"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Local Sales Order (LSO)"
        description="Orders outside customers have placed on your branches"
        icon={<ShoppingBag className="h-5 w-5" />}
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New order
            </button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={rows ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Order, customer or branch…"
        onView={openRow}
        onEdit={openRow}
        onDelete={canDeletePriv ? del : undefined}
        canView
        canEdit
        canDelete={canDeletePriv}
        emptyMessage="No customer orders yet"
      />
    </div>
  );
}
