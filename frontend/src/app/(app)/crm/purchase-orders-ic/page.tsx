'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Plus, Trash2, ArrowLeft, Send } from 'lucide-react';
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
import type {
  Company,
  Product,
  Unit,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@/lib/types';

const ROUTE = '/crm/purchase-orders-ic';

type DraftLine = { productId: string; quantity: string };
type Mode = 'list' | 'edit' | 'view';

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
// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function PurchaseOrderIcPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: placed, loading, refetch } = useFetch<PurchaseOrder[]>(
    '/purchase-orders?scope=placed',
  );
  // When a workflow governs the PO form, it supersedes the Add privilege: only
  // the workflow's designated creator may raise an order.
  const { data: createAccess } = useFetch<{
    workflowGoverned: boolean;
    canCreate: boolean;
  }>('/purchase-orders/create-access');

  const canAdd = can(ROUTE, 'add');
  const canDeletePriv = can(ROUTE, 'delete');
  // Show "New" only when the screen privilege allows AND the workflow (if any)
  // designates this user a creator.
  const canCreate = canAdd && (createAccess?.canCreate ?? false);

  const suppliers = useMemo(
    () => (companies ?? []).filter((c) => c.id !== activeCompanyId),
    [companies, activeCompanyId],
  );
  const companyName = (id: number) =>
    (companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`;
  const unitLabel = (id: number) => {
    const u = (units ?? []).find((x) => x.id === id);
    return u?.symbol ?? u?.code ?? '';
  };

  // ---- screen state ----
  const [mode, setMode] = useState<Mode>('list');
  const [current, setCurrent] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- editable draft form ----
  const [supplierId, setSupplierId] = useState('');
  const [deliveryAt, setDeliveryAt] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Product[]>([]);

  // Products belong to the SUPPLIER; fetch that company's catalogue.
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

  // ---- list columns ----
  const columns: Column<PurchaseOrder>[] = [
    { key: 'orderNo', header: 'Order No', accessor: (r) => r.orderNo },
    { key: 'supplier', header: 'Supplier', accessor: (r) => companyName(r.companyId) },
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
      render: (r) => <Badge color={statusColor(r.status)}>{r.status}</Badge>,
    },
  ];

  // ============================ DOCUMENT MODE ============================
  if (mode !== 'list') {
    const isEditing = mode === 'edit';
    const submitLabel = current?.viewer?.submitButtonText ?? 'Forward';
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-y-auto pb-6">
        {/* action bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={backToList}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </button>
          {isEditing && (
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
            <PurchaseOrderDoc
              order={current}
              companyName={companyName}
              productName={productName}
              unitLabel={unitLabel}
            />
          )
        )}
      </div>
    );
  }

  // ============================== LIST MODE ==============================
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Purchase Order - IC"
        description="Raise inter-company purchase orders on a supplier company"
        icon={<ShoppingCart className="h-5 w-5" />}
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New Purchase Order
            </button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={placed ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search orders..."
        onView={openView}
        canView
        emptyMessage="No purchase orders yet"
      />
    </div>
  );
}

// --- draft editor (extracted to keep the page readable) ---
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

  return (
    <div className="card border-[#e7ddcb] bg-[#fbf9f4] p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {orderNo ? `Draft ${orderNo}` : 'New Purchase Order'}
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
                <th className="w-32 py-2 px-1 text-right">Quantity</th>
                <th className="w-16 py-2 px-1">Unit</th>
                <th className="w-12 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
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
