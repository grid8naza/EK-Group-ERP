'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select, Textarea } from '@/components/ui/Field';
import type {
  OpeningStock,
  OpeningStockLineRow,
  OpeningStockType,
  Store,
  Item,
  Product,
  Category,
} from '@/lib/types';

type DraftLine = {
  key: string; // stockable id (item or product, by screen type)
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

export function OpeningStockScreen({
  type,
  route,
  title,
  noun,
}: {
  type: OpeningStockType;
  route: string;
  title: string;
  noun: string; // "item" | "packed product" | "unpacked product"
}) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  // Both ITEM variants draw from Item Master; products from Product Master.
  const isItem = type === 'ITEM_RAW' || type === 'ITEM_PACKING';

  const { data: rows, loading, refetch } = useFetch<OpeningStockLineRow[]>(
    `/opening-stock/lines?type=${type}`,
  );
  const { data: stores } = useFetch<Store[]>('/stores');
  const { data: items } = useFetch<Item[]>('/items');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: categories } = useFetch<Category[]>('/categories');

  const canAdd = can(route, 'add');
  const canEditPriv = can(route, 'edit');
  const canDeletePriv = can(route, 'delete');
  const canViewPriv = can(route, 'view');
  const canLock = can(route, 'lock');
  const canUnlock = can(route, 'unlock');

  // ---- pickable stockables for this screen's type ----
  const pickable = useMemo(() => {
    if (isItem) {
      // Packing-material categories carry `forPacking`; everything else (incl.
      // uncategorised items) is raw material.
      const packingCatIds = new Set(
        (categories ?? []).filter((c) => c.forPacking).map((c) => c.id),
      );
      const wantPacking = type === 'ITEM_PACKING';
      return (items ?? [])
        .filter((i) => {
          const isPacking = i.categoryId != null && packingCatIds.has(i.categoryId);
          return wantPacking ? isPacking : !isPacking;
        })
        .map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit?.symbol ?? i.unit?.code ?? '',
        }));
    }
    const wantPacked = type === 'PRODUCT_PACKED';
    return (products ?? [])
      .filter((p) => (wantPacked ? p.packed : p.unpacked))
      .map((p) => ({
        id: p.id,
        name: p.name,
        unit: p.unit?.symbol ?? p.unit?.code ?? '',
      }));
  }, [type, isItem, items, products, categories]);
  const pickById = useMemo(
    () => new Map(pickable.map((p) => [String(p.id), p])),
    [pickable],
  );
  const pickOptions = useMemo(
    () => pickable.map((p) => ({ value: String(p.id), label: p.name })),
    [pickable],
  );

  const storeOptions = useMemo(
    () => (stores ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [stores],
  );

  // ---- filters (category / primary group / parent group), cascading ----
  const [fCat, setFCat] = useState('');
  const [fPrimary, setFPrimary] = useState('');
  const [fParent, setFParent] = useState('');

  const opt = (
    list: OpeningStockLineRow[],
    id: (r: OpeningStockLineRow) => number | null | undefined,
    name: (r: OpeningStockLineRow) => string | null | undefined,
  ) => {
    const m = new Map<number, string>();
    list.forEach((r) => {
      const i = id(r);
      if (i != null) m.set(i, name(r) ?? `#${i}`);
    });
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  };
  const catOptions = useMemo(
    () => opt(rows ?? [], (r) => r.categoryId, (r) => r.categoryName),
    [rows],
  );
  const primaryOptions = useMemo(
    () =>
      opt(
        (rows ?? []).filter((r) => !fCat || String(r.categoryId) === fCat),
        (r) => r.primaryGroupId,
        (r) => r.primaryGroupName,
      ),
    [rows, fCat],
  );
  const parentOptions = useMemo(
    () =>
      opt(
        (rows ?? []).filter(
          (r) =>
            (!fCat || String(r.categoryId) === fCat) &&
            (!fPrimary || String(r.primaryGroupId) === fPrimary),
        ),
        (r) => r.parentGroupId,
        (r) => r.parentGroupName,
      ),
    [rows, fCat, fPrimary],
  );
  const filteredRows = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!fCat || String(r.categoryId) === fCat) &&
          (!fPrimary || String(r.primaryGroupId) === fPrimary) &&
          (!fParent || String(r.parentGroupId) === fParent),
      ),
    [rows, fCat, fPrimary, fParent],
  );
  const hasFilters = !!(fCat || fPrimary || fParent);
  const clearFilters = () => {
    setFCat('');
    setFPrimary('');
    setFParent('');
  };

  // ---- overlay entry form ----
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState(false);
  const [editingDoc, setEditingDoc] = useState<OpeningStock | null>(null);
  const [saving, setSaving] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [docDate, setDocDate] = useState(todayInput());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  const blankLine = (): DraftLine => ({
    key: '',
    quantity: '',
    unitPrice: '',
    batchNo2: '',
    expiry: '',
  });
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  const openNew = () => {
    setEditingDoc(null);
    setViewMode(false);
    setStoreId('');
    setDocDate(todayInput());
    setReference('');
    setNotes('');
    setLines([blankLine()]);
    setOpen(true);
  };

  const loadDoc = async (documentId: number) => {
    const full = await api.get<OpeningStock>(`/opening-stock/${documentId}`);
    setEditingDoc(full);
    setStoreId(String(full.storeId));
    setDocDate(dateInput(full.docDate));
    setReference(full.reference ?? '');
    setNotes(full.notes ?? '');
    setLines(
      (full.lines ?? []).map((l) => ({
        key: String(l.itemId ?? l.productId ?? ''),
        quantity: String(l.qtyIn),
        unitPrice: String(l.unitPrice ?? 0),
        batchNo2: l.batchNo2 ?? '',
        expiry: dateInput(l.expiryDate),
      })),
    );
  };
  const openView = async (r: OpeningStockLineRow) => {
    try {
      await loadDoc(r.documentId);
      setViewMode(true);
      setOpen(true);
    } catch {
      toast.error('Failed to open the document.');
    }
  };
  const openEdit = async (r: OpeningStockLineRow) => {
    if (r.isLocked) {
      toast.error('This document is locked. Unlock it first to edit.');
      return;
    }
    try {
      await loadDoc(r.documentId);
      setViewMode(false);
      setOpen(true);
    } catch {
      toast.error('Failed to open the document.');
    }
  };
  const closeOverlay = () => {
    setOpen(false);
    setViewMode(false);
    setEditingDoc(null);
  };

  const buildLines = () =>
    lines
      .filter((l) => l.key && Number(l.quantity) > 0)
      .map((l) => ({
        itemId: isItem ? Number(l.key) : undefined,
        productId: !isItem ? Number(l.key) : undefined,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice ? Number(l.unitPrice) : 0,
        batchNo2: l.batchNo2.trim() || undefined,
        expiryDate: l.expiry ? new Date(l.expiry).toISOString() : undefined,
      }));

  const doSave = async () => {
    if (!storeId) return toast.error('Select a store.');
    if (!docDate) return toast.error('Select a document date.');
    if (buildLines().length === 0)
      return toast.error(`Add at least one ${noun} with a quantity.`);
    setSaving(true);
    try {
      const payload = {
        storeId: Number(storeId),
        docDate: new Date(docDate).toISOString(),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: buildLines(),
      };
      if (editingDoc) {
        await api.patch(`/opening-stock/${editingDoc.id}`, payload);
        toast.success('Opening stock updated.');
      } else {
        await api.post('/opening-stock', payload);
        toast.success('Opening stock posted.');
      }
      closeOverlay();
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: OpeningStockLineRow) => {
    if (r.isLocked) {
      toast.error('This document is locked. Unlock it first to delete.');
      return;
    }
    const ok = await confirm({
      title: 'Delete opening stock',
      message: `Delete document ${r.docNo}? This removes all its lines and batches.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/opening-stock/${r.documentId}`);
      toast.success('Opening stock deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const toggleLock = async (r: OpeningStockLineRow) => {
    const locking = !r.isLocked;
    if (locking) {
      const ok = await confirm({
        title: 'Lock document',
        message: `Lock ${r.docNo}? It can't be edited or deleted until unlocked.`,
        confirmText: 'Lock',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/opening-stock/${r.documentId}/lock`, { locked: locking });
      toast.success(locking ? 'Document locked.' : 'Document unlocked.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };

  const columns: Column<OpeningStockLineRow>[] = [
    { key: 'docNo', header: 'Doc No', accessor: (r) => r.docNo },
    { key: 'category', header: 'Category', accessor: (r) => r.categoryName ?? '—' },
    { key: 'primaryGroup', header: 'Primary Group', accessor: (r) => r.primaryGroupName ?? '—' },
    { key: 'parentGroup', header: 'Parent Group', accessor: (r) => r.parentGroupName ?? '—' },
    {
      key: 'name',
      header: isItem ? 'Item' : 'Product',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'batchNo1', header: 'Batch No', accessor: (r) => r.batchNo1 ?? '—' },
    { key: 'batchNo2', header: 'Supplier Batch', accessor: (r) => r.batchNo2 ?? '—' },
    {
      key: 'expiry',
      header: 'Expiry',
      accessor: (r) => (r.expiryDate ? fmtDate(r.expiryDate) : '—'),
      className: 'text-center',
      headerClassName: 'text-center',
    },
    {
      key: 'qty',
      header: 'Qty',
      accessor: (r) => r.qtyIn.toLocaleString(),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    { key: 'unit', header: 'Unit', accessor: (r) => r.unitSymbol ?? '' },
    {
      key: 'rate',
      header: 'Rate',
      accessor: (r) => (r.unitPrice ?? 0).toLocaleString(),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col">
      <PageHeader
        title={title}
        description="Opening balances — each line generates a batch and a stock-in entry"
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New Entry
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        bordered
        onRefresh={refetch}
        searchPlaceholder="Search…"
        onView={openView}
        onEdit={openEdit}
        onDelete={remove}
        canView={canViewPriv}
        canEdit={canEditPriv}
        canDelete={canDeletePriv}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No opening stock entries yet"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={fCat}
              onChange={(e) => {
                setFCat(e.target.value);
                setFPrimary('');
                setFParent('');
              }}
              placeholder="All categories"
              options={catOptions}
              wrapClassName="w-44"
            />
            <Select
              value={fPrimary}
              onChange={(e) => {
                setFPrimary(e.target.value);
                setFParent('');
              }}
              placeholder="All primary groups"
              options={primaryOptions}
              wrapClassName="w-44"
            />
            <Select
              value={fParent}
              onChange={(e) => setFParent(e.target.value)}
              placeholder="All parent groups"
              options={parentOptions}
              wrapClassName="w-44"
            />
            {hasFilters && (
              <button className="btn-ghost text-xs text-slate-500" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        }
      />

      {/* Overlay data-entry form */}
      <Drawer
        open={open}
        onClose={closeOverlay}
        title={
          viewMode
            ? `Opening Stock ${editingDoc?.docNo ?? ''}`
            : editingDoc
              ? `Edit ${editingDoc.docNo}`
              : `New ${title}`
        }
        subtitle="Opening balance document"
        icon={<ClipboardList className="h-5 w-5" />}
        width="xl"
        footer={
          viewMode ? (
            <div className="flex justify-end">
              <button className="btn-secondary" onClick={closeOverlay}>
                Close
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={closeOverlay} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={doSave} disabled={saving}>
                {saving ? 'Saving…' : editingDoc ? 'Update' : 'Post'}
              </button>
            </div>
          )
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Store"
              required
              disabled={viewMode}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="Select a store"
              options={storeOptions}
            />
            <Input
              label="Document date"
              type="date"
              disabled={viewMode}
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
            />
            <Input
              label="Reference"
              disabled={viewMode}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label !mb-0">
                {isItem ? 'Items' : 'Products'}
              </span>
              {!viewMode && (
                <button className="btn-secondary text-xs" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-2">{isItem ? 'Item' : 'Product'}</th>
                    {viewMode && <th className="py-2 px-1">Batch No</th>}
                    <th className="py-2 px-1">Supplier Batch</th>
                    <th className="w-32 py-2 px-1">Expiry</th>
                    <th className="w-24 py-2 px-1 text-right">Qty</th>
                    <th className="w-12 py-2 px-1">Unit</th>
                    <th className="w-28 py-2 px-1 text-right">Rate</th>
                    {!viewMode && <th className="w-10 py-2" />}
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
                      const p = l.key ? pickById.get(l.key) : undefined;
                      const docLine = editingDoc?.lines?.[i];
                      return (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-800/60">
                          <td className="py-1.5 pr-2 min-w-[12rem]">
                            {viewMode ? (
                              <span className="font-medium text-slate-800 dark:text-slate-100">
                                {p?.name ?? '—'}
                              </span>
                            ) : (
                              <Select
                                value={l.key}
                                onChange={(e) => setLine(i, { key: e.target.value })}
                                placeholder={`Select ${isItem ? 'item' : 'product'}`}
                                options={pickOptions}
                              />
                            )}
                          </td>
                          {viewMode && (
                            <td className="px-1 font-mono text-xs text-slate-500">
                              {docLine?.batchNo1 ?? '—'}
                            </td>
                          )}
                          <td className="px-1">
                            {viewMode ? (
                              <span className="text-slate-600">{l.batchNo2 || '—'}</span>
                            ) : (
                              <Input
                                value={l.batchNo2}
                                onChange={(e) => setLine(i, { batchNo2: e.target.value })}
                                placeholder="Supplier batch"
                              />
                            )}
                          </td>
                          <td className="px-1">
                            {viewMode ? (
                              <span className="text-slate-600">
                                {l.expiry ? fmtDate(l.expiry) : '—'}
                              </span>
                            ) : (
                              <Input
                                type="date"
                                value={l.expiry}
                                onChange={(e) => setLine(i, { expiry: e.target.value })}
                              />
                            )}
                          </td>
                          <td className="px-1">
                            {viewMode ? (
                              <span className="block text-right tabular-nums">
                                {Number(l.quantity).toLocaleString()}
                              </span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={l.quantity}
                                onChange={(e) => setLine(i, { quantity: e.target.value })}
                                className="text-right tabular-nums"
                              />
                            )}
                          </td>
                          <td className="px-1 text-slate-500">{p?.unit ?? ''}</td>
                          <td className="px-1">
                            {viewMode ? (
                              <span className="block text-right tabular-nums">
                                {Number(l.unitPrice || 0).toLocaleString()}
                              </span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={l.unitPrice}
                                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                                className="text-right tabular-nums"
                              />
                            )}
                          </td>
                          {!viewMode && (
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
          </div>

          <Textarea
            label="Notes"
            disabled={viewMode}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Drawer>
    </div>
  );
}
