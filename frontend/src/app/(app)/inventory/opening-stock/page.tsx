'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Plus,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { OpeningStock, Store, Item, Product } from '@/lib/types';

const ROUTE = '/inventory/opening-stock';
type Mode = 'list' | 'edit' | 'view';

type DraftLine = {
  key: string; // stockable key: item:<id> | product:<id>
  quantity: string;
  unitPrice: string;
  batchNo2: string;
  expiry: string;
};

const todayInput = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

export default function OpeningStockPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: docs, loading, refetch } = useFetch<OpeningStock[]>('/opening-stock');
  const { data: stores } = useFetch<Store[]>('/stores');
  const { data: items } = useFetch<Item[]>('/items');
  const { data: products } = useFetch<Product[]>('/products');

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<OpeningStock>({
      endpoint: '/opening-stock',
      route: ROUTE,
      noun: 'opening stock',
      nameOf: (d) => d.docNo,
      reload: refetch,
    });

  const canAdd = can(ROUTE, 'add');
  const canEditPriv = can(ROUTE, 'edit');
  const canDeletePriv = can(ROUTE, 'delete');
  const canViewPriv = can(ROUTE, 'view');

  // ---- stockable (item OR product) catalogue ----
  const stockables = useMemo(() => {
    const list: {
      key: string;
      kind: 'item' | 'product';
      id: number;
      name: string;
      unit: string;
    }[] = [];
    (items ?? []).forEach((i) =>
      list.push({
        key: `item:${i.id}`,
        kind: 'item',
        id: i.id,
        name: i.name,
        unit: i.unit?.symbol ?? i.unit?.code ?? '',
      }),
    );
    (products ?? []).forEach((p) =>
      list.push({
        key: `product:${p.id}`,
        kind: 'product',
        id: p.id,
        name: p.name,
        unit: p.unit?.symbol ?? p.unit?.code ?? '',
      }),
    );
    return list;
  }, [items, products]);
  const stockByKey = useMemo(
    () => new Map(stockables.map((s) => [s.key, s])),
    [stockables],
  );
  const stockOptions = useMemo(
    () =>
      stockables.map((s) => ({
        value: s.key,
        label: s.kind === 'product' ? `${s.name} · Product` : s.name,
      })),
    [stockables],
  );
  const keyOfLine = (l: { itemId?: number | null; productId?: number | null }) =>
    l.itemId ? `item:${l.itemId}` : l.productId ? `product:${l.productId}` : '';

  const storeName = (id?: number | null) =>
    id ? (stores ?? []).find((s) => s.id === id)?.name ?? `#${id}` : '—';
  const storeOptions = useMemo(
    () => (stores ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [stores],
  );

  // ---- screen state ----
  const [mode, setMode] = useState<Mode>('list');
  const [current, setCurrent] = useState<OpeningStock | null>(null);
  const [saving, setSaving] = useState(false);

  const [storeId, setStoreId] = useState('');
  const [docDate, setDocDate] = useState(todayInput());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { key: '', quantity: '', unitPrice: '', batchNo2: '', expiry: '' },
    ]);
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  const openNew = () => {
    setCurrent(null);
    setStoreId('');
    setDocDate(todayInput());
    setReference('');
    setNotes('');
    setLines([{ key: '', quantity: '', unitPrice: '', batchNo2: '', expiry: '' }]);
    setMode('edit');
  };

  const loadDoc = async (id: number) => {
    const full = await api.get<OpeningStock>(`/opening-stock/${id}`);
    setCurrent(full);
    setStoreId(String(full.storeId));
    setDocDate(dateInput(full.docDate));
    setReference(full.reference ?? '');
    setNotes(full.notes ?? '');
    setLines(
      (full.lines ?? []).map((l) => ({
        key: keyOfLine(l),
        quantity: String(l.qtyIn),
        unitPrice: String(l.unitPrice ?? 0),
        batchNo2: l.batchNo2 ?? '',
        expiry: dateInput(l.expiryDate),
      })),
    );
    return full;
  };

  const openView = async (row: OpeningStock) => {
    try {
      await loadDoc(row.id);
      setMode('view');
    } catch {
      toast.error('Failed to open the document.');
    }
  };
  const openEdit = async (row: OpeningStock) => {
    try {
      await loadDoc(row.id);
      setMode('edit');
    } catch {
      toast.error('Failed to open the document.');
    }
  };

  const backToList = () => {
    setMode('list');
    setCurrent(null);
    refetch();
  };

  const buildLines = () =>
    lines
      .filter((l) => l.key && Number(l.quantity) > 0)
      .map((l) => {
        const s = stockByKey.get(l.key)!;
        return {
          itemId: s.kind === 'item' ? s.id : undefined,
          productId: s.kind === 'product' ? s.id : undefined,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice ? Number(l.unitPrice) : 0,
          batchNo2: l.batchNo2.trim() || undefined,
          expiryDate: l.expiry ? new Date(l.expiry).toISOString() : undefined,
        };
      });

  const validate = (): string | null => {
    if (!storeId) return 'Select a store.';
    if (!docDate) return 'Select a document date.';
    if (buildLines().length === 0)
      return 'Add at least one line with an item/product and quantity.';
    return null;
  };

  const doSave = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        storeId: Number(storeId),
        docDate: new Date(docDate).toISOString(),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: buildLines(),
      };
      if (current) {
        await api.patch(`/opening-stock/${current.id}`, payload);
        toast.success('Opening stock updated.');
      } else {
        await api.post('/opening-stock', payload);
        toast.success('Opening stock posted.');
      }
      backToList();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: OpeningStock) => {
    const ok = await confirm({
      title: 'Delete opening stock',
      message: `Delete ${row.docNo}? This removes its stock entries and batches.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/opening-stock/${row.id}`);
      toast.success('Opening stock deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<OpeningStock>[] = [
    { key: 'docNo', header: 'Doc No', accessor: (r) => r.docNo },
    { key: 'store', header: 'Store', accessor: (r) => storeName(r.storeId) },
    {
      key: 'docDate',
      header: 'Date',
      accessor: (r) => fmtDate(r.docDate),
      className: 'text-center',
      headerClassName: 'text-center',
    },
    {
      key: 'lineCount',
      header: 'Items',
      accessor: (r) => r.lineCount ?? 0,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'totalQty',
      header: 'Total Qty',
      accessor: (r) => (r.totalQty ?? 0).toLocaleString(),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    { key: 'reference', header: 'Reference', accessor: (r) => r.reference ?? '—' },
  ];

  // ============================ DOCUMENT MODE ============================
  if (mode !== 'list') {
    const isEditing = mode === 'edit';
    return (
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-y-auto pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={backToList}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </button>
          {isEditing && (
            <button className="btn-primary" onClick={doSave} disabled={saving}>
              {saving ? 'Saving…' : current ? 'Update' : 'Post opening stock'}
            </button>
          )}
        </div>

        <div className="card border-[#e7ddcb] bg-[#fbf9f4] p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {current ? `Opening Stock ${current.docNo}` : 'New Opening Stock'}
            </h2>
            {current && <Badge color="green">{current.status}</Badge>}
          </div>

          {/* Header */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Store"
              required
              disabled={!isEditing}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="Select a store"
              options={storeOptions}
            />
            <Input
              label="Document date"
              type="date"
              disabled={!isEditing}
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
            />
            <Input
              label="Reference"
              disabled={!isEditing}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Lines */}
          <div className="mt-6 flex items-center justify-between">
            <span className="label !mb-0">Items</span>
            {isEditing && (
              <button className="btn-secondary text-xs" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            )}
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-2">Item / Product</th>
                  {!isEditing && <th className="py-2 px-1">Batch No</th>}
                  <th className="py-2 px-1">Supplier Batch</th>
                  <th className="w-32 py-2 px-1">Expiry</th>
                  <th className="w-24 py-2 px-1 text-right">Qty</th>
                  <th className="w-14 py-2 px-1">Unit</th>
                  <th className="w-28 py-2 px-1 text-right">Rate</th>
                  {isEditing && <th className="w-10 py-2" />}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-xs text-slate-400">
                      No lines.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => {
                    const s = l.key ? stockByKey.get(l.key) : undefined;
                    const docLine = current?.lines?.[i];
                    return (
                      <tr
                        key={i}
                        className="border-b border-slate-100 dark:border-slate-800/60"
                      >
                        <td className="py-1.5 pr-2 min-w-[12rem]">
                          {isEditing ? (
                            <Select
                              value={l.key}
                              onChange={(e) => setLine(i, { key: e.target.value })}
                              placeholder="Select item / product"
                              options={stockOptions}
                            />
                          ) : (
                            <span className="font-medium text-slate-800 dark:text-slate-100">
                              {s?.name ?? '—'}
                            </span>
                          )}
                        </td>
                        {!isEditing && (
                          <td className="px-1 font-mono text-xs text-slate-500">
                            {docLine?.batchNo1 ?? '—'}
                          </td>
                        )}
                        <td className="px-1">
                          {isEditing ? (
                            <Input
                              value={l.batchNo2}
                              onChange={(e) => setLine(i, { batchNo2: e.target.value })}
                              placeholder="Supplier batch"
                            />
                          ) : (
                            <span className="text-slate-600">{l.batchNo2 || '—'}</span>
                          )}
                        </td>
                        <td className="px-1">
                          {isEditing ? (
                            <Input
                              type="date"
                              value={l.expiry}
                              onChange={(e) => setLine(i, { expiry: e.target.value })}
                            />
                          ) : (
                            <span className="text-slate-600">
                              {l.expiry ? fmtDate(l.expiry) : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-1">
                          {isEditing ? (
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={l.quantity}
                              onChange={(e) => setLine(i, { quantity: e.target.value })}
                              className="text-right tabular-nums"
                            />
                          ) : (
                            <span className="block text-right tabular-nums">
                              {Number(l.quantity).toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="px-1 text-slate-500">{s?.unit ?? ''}</td>
                        <td className="px-1">
                          {isEditing ? (
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={l.unitPrice}
                              onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                              className="text-right tabular-nums"
                            />
                          ) : (
                            <span className="block text-right tabular-nums">
                              {Number(l.unitPrice || 0).toLocaleString()}
                            </span>
                          )}
                        </td>
                        {isEditing && (
                          <td className="text-center">
                            <button
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                              onClick={() => removeLine(i)}
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <Textarea
            label="Notes"
            wrapClassName="mt-4"
            disabled={!isEditing}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    );
  }

  // ============================== LIST MODE ==============================
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Opening Stock"
        description="Enter opening balances — each line generates a batch and a stock-in entry"
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New Opening Stock
            </button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={docs ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search documents..."
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canViewPriv}
        canEdit={canEditPriv}
        canDelete={canDeletePriv}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No opening stock entries yet"
      />
    </div>
  );
}
