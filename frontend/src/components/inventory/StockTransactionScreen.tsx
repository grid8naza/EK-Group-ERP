'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  Kbd,
  type SaveMode,
} from '@/components/ui/Drawer';
import { Input, Select, Textarea } from '@/components/ui/Field';
import type {
  StockTransaction,
  StockTransactionLineRow,
  StockTxnKind,
  Store,
  Item,
  Product,
  Supplier,
} from '@/lib/types';

type DraftLine = {
  key: string; // "item:<id>" | "product:<id>"
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

export function StockTransactionScreen({
  type,
  inbound,
  route,
  title,
  noun,
  showSupplier = false,
  showClassification = false,
  showRate = true,
}: {
  type: StockTxnKind;
  /** IN types (receipt/return) capture batches; OUT types (delivery/issue) decrement stock. */
  inbound: boolean;
  route: string;
  title: string;
  noun: string; // "goods receipt", "delivery", ...
  /** Show the supplier dropdown + purchase-order reference in the header (GRN). */
  showSupplier?: boolean;
  /** Show each line's category + parent group (derived from the item/product). */
  showClassification?: boolean;
  /** Show the per-line rate/price input + column. */
  showRate?: boolean;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: rows, loading, refetch } = useFetch<StockTransactionLineRow[]>(
    `/stock-transactions/lines?type=${type}`,
  );
  const { data: stores } = useFetch<Store[]>('/stores');
  const { data: items } = useFetch<Item[]>('/items');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: suppliers } = useFetch<Supplier[]>(
    showSupplier ? '/suppliers' : null,
  );

  const canAdd = can(route, 'add');
  const canEditPriv = can(route, 'edit');
  const canDeletePriv = can(route, 'delete');
  const canViewPriv = can(route, 'view');
  const canLock = can(route, 'lock');
  const canUnlock = can(route, 'unlock');

  // ---- pickable stockables: items AND products, keyed by kind ----
  const pickable = useMemo(() => {
    const its = (items ?? []).map((i) => ({
      key: `item:${i.id}`,
      name: i.name,
      unit: i.unit?.symbol ?? i.unit?.code ?? '',
      category: i.category?.name ?? '—',
      group: i.group?.name ?? '—',
    }));
    const prs = (products ?? []).map((p) => ({
      key: `product:${p.id}`,
      name: p.name,
      unit: p.unit?.symbol ?? p.unit?.code ?? '',
      category: p.category?.name ?? '—',
      group: p.group?.name ?? '—',
    }));
    return [...its, ...prs];
  }, [items, products]);
  const supplierOptions = useMemo(
    () =>
      (suppliers ?? [])
        .filter((s) => s.isActive)
        .map((s) => ({ value: String(s.id), label: s.name })),
    [suppliers],
  );
  const pickById = useMemo(
    () => new Map(pickable.map((p) => [p.key, p])),
    [pickable],
  );
  const pickOptions = useMemo(
    () => pickable.map((p) => ({ value: p.key, label: p.name })),
    [pickable],
  );

  const storeOptions = useMemo(
    () => (stores ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [stores],
  );
  // The active branch's default store (stores are already branch-scoped), used
  // to pre-select the store combo when a new document is started.
  const defaultStoreId = useMemo(
    () => (stores ?? []).find((s) => s.isDefault)?.id,
    [stores],
  );

  // ---- filters (category / primary group / parent group), cascading ----
  const [fCat, setFCat] = useState('');
  const [fPrimary, setFPrimary] = useState('');
  const [fParent, setFParent] = useState('');

  const opt = (
    list: StockTransactionLineRow[],
    id: (r: StockTransactionLineRow) => number | null | undefined,
    name: (r: StockTransactionLineRow) => string | null | undefined,
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
  const [editingDoc, setEditingDoc] = useState<StockTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [docDate, setDocDate] = useState(todayInput());
  const [supplierId, setSupplierId] = useState('');
  const [poRef, setPoRef] = useState('');
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
    setStoreId(defaultStoreId ? String(defaultStoreId) : '');
    setDocDate(todayInput());
    setSupplierId('');
    setPoRef('');
    setReference('');
    setNotes('');
    setLines([blankLine()]);
    setOpen(true);
  };

  const loadDoc = async (documentId: number) => {
    const full = await api.get<StockTransaction>(`/stock-transactions/${documentId}`);
    setEditingDoc(full);
    setStoreId(String(full.storeId));
    setDocDate(dateInput(full.docDate));
    setSupplierId(full.supplierId ? String(full.supplierId) : '');
    setPoRef(full.purchaseOrderRef ?? '');
    setReference(full.reference ?? '');
    setNotes(full.notes ?? '');
    setLines(
      (full.lines ?? []).map((l) => ({
        key: l.itemId ? `item:${l.itemId}` : `product:${l.productId}`,
        quantity: String(inbound ? l.qtyIn : l.qtyOut),
        unitPrice: String(l.unitPrice ?? 0),
        batchNo2: l.batchNo2 ?? '',
        expiry: dateInput(l.expiryDate),
      })),
    );
  };
  const openView = async (r: StockTransactionLineRow) => {
    try {
      await loadDoc(r.documentId);
      setViewMode(true);
      setOpen(true);
    } catch {
      toast.error('Failed to open the document.');
    }
  };
  const openEdit = async (r: StockTransactionLineRow) => {
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
      .map((l) => {
        const [kind, idStr] = l.key.split(':');
        const id = Number(idStr);
        return {
          itemId: kind === 'item' ? id : undefined,
          productId: kind === 'product' ? id : undefined,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice ? Number(l.unitPrice) : 0,
          batchNo2: inbound ? l.batchNo2.trim() || undefined : undefined,
          expiryDate:
            inbound && l.expiry ? new Date(l.expiry).toISOString() : undefined,
        };
      });

  const resetForm = () => {
    setEditingDoc(null);
    setStoreId('');
    setDocDate(todayInput());
    setSupplierId('');
    setPoRef('');
    setReference('');
    setNotes('');
    setLines([blankLine()]);
  };

  const doSave = async (mode: SaveMode = 'saveClose') => {
    if (saving) return;
    if (!storeId) return toast.error('Select a store.');
    if (!docDate) return toast.error('Select a document date.');
    if (buildLines().length === 0)
      return toast.error(`Add at least one ${noun} line with a quantity.`);
    setSaving(true);
    try {
      const payload = {
        storeId: Number(storeId),
        docDate: new Date(docDate).toISOString(),
        ...(showSupplier
          ? {
              supplierId: supplierId ? Number(supplierId) : null,
              purchaseOrderRef: poRef.trim() || null,
            }
          : {}),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: buildLines(),
      };
      let savedId: number;
      if (editingDoc) {
        await api.patch(`/stock-transactions/${editingDoc.id}`, payload);
        savedId = editingDoc.id;
        toast.success('Transaction updated.');
      } else {
        const created = await api.post<StockTransaction>(
          `/stock-transactions?type=${type}`,
          payload,
        );
        savedId = created.id;
        toast.success('Transaction posted.');
      }
      await refetch();
      if (mode === 'saveNew') {
        resetForm();
      } else if (mode === 'save') {
        await loadDoc(savedId); // keep open on the saved document
      } else {
        closeOverlay();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  // Alt+A adds a line while editing. Save shortcuts (Ctrl/⌘+S, Ctrl/⌘+Shift+S,
  // Ctrl/⌘+Enter) and Esc are handled by DrawerFooter / the Drawer.
  useEffect(() => {
    if (!open || viewMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        addLine();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewMode]);

  const remove = async (r: StockTransactionLineRow) => {
    if (r.isLocked) {
      toast.error('This document is locked. Unlock it first to delete.');
      return;
    }
    const ok = await confirm({
      title: 'Delete transaction',
      message: `Delete document ${r.docNo}? This removes all its lines${inbound ? ' and batches' : ''}.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/stock-transactions/${r.documentId}`);
      toast.success('Transaction deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const toggleLock = async (r: StockTransactionLineRow) => {
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
      await api.patch(`/stock-transactions/${r.documentId}/lock`, { locked: locking });
      toast.success(locking ? 'Document locked.' : 'Document unlocked.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };

  const columns: Column<StockTransactionLineRow>[] = [
    { key: 'docNo', header: 'Doc No', accessor: (r) => r.docNo },
    { key: 'category', header: 'Category', accessor: (r) => r.categoryName ?? '—' },
    { key: 'primaryGroup', header: 'Primary Group', accessor: (r) => r.primaryGroupName ?? '—' },
    { key: 'parentGroup', header: 'Parent Group', accessor: (r) => r.parentGroupName ?? '—' },
    {
      key: 'name',
      header: 'Item / Product',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    ...(inbound
      ? ([
          { key: 'batchNo1', header: 'Batch No', accessor: (r) => r.batchNo1 ?? '—' },
          { key: 'batchNo2', header: 'Supplier Batch', accessor: (r) => r.batchNo2 ?? '—' },
          {
            key: 'expiry',
            header: 'Expiry',
            accessor: (r) => (r.expiryDate ? fmtDate(r.expiryDate) : '—'),
            className: 'text-center',
            headerClassName: 'text-center',
          },
        ] as Column<StockTransactionLineRow>[])
      : []),
    {
      key: 'qty',
      header: 'Qty',
      accessor: (r) => r.qty.toLocaleString(),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    { key: 'unit', header: 'Unit', accessor: (r) => r.unitSymbol ?? '' },
    ...(showRate
      ? ([
          {
            key: 'rate',
            header: 'Rate',
            accessor: (r) => (r.unitPrice ?? 0).toLocaleString(),
            className: 'text-right tabular-nums',
            headerClassName: 'text-right',
          },
        ] as Column<StockTransactionLineRow>[])
      : []),
  ];

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col">
      <PageHeader
        title={title}
        description={
          inbound
            ? 'Goods in — each line generates a batch and a stock-in entry'
            : 'Goods out — each line decrements on-hand stock at the store'
        }
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
        emptyMessage="No entries yet"
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
            ? `${title} ${editingDoc?.docNo ?? ''}`
            : editingDoc
              ? `Edit ${editingDoc.docNo}`
              : `New ${title}`
        }
        subtitle={inbound ? 'Goods-in document' : 'Goods-out document'}
        icon={<ClipboardList className="h-5 w-5" />}
        width="xl"
        footer={
          viewMode ? (
            <CloseFooter onClose={closeOverlay} />
          ) : (
            <DrawerFooter
              onCancel={closeOverlay}
              onSave={doSave}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <div className="space-y-5">
          {showSupplier && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Supplier"
                disabled={viewMode}
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="Select a supplier"
                options={supplierOptions}
              />
              <Input
                label="Purchase Order"
                disabled={viewMode}
                value={poRef}
                onChange={(e) => setPoRef(e.target.value)}
                placeholder="PO reference"
              />
            </div>
          )}
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
              <span className="label !mb-0">Items / Products</span>
              {!viewMode && (
                <button className="btn-secondary text-xs" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5" /> Add line <Kbd>Alt+A</Kbd>
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-2">Item / Product</th>
                    {showClassification && <th className="py-2 px-1">Category</th>}
                    {showClassification && <th className="py-2 px-1">Parent Group</th>}
                    {inbound && viewMode && <th className="py-2 px-1">Batch No</th>}
                    {inbound && <th className="py-2 px-1">Supplier Batch</th>}
                    {inbound && <th className="w-32 py-2 px-1">Expiry</th>}
                    <th className="w-24 py-2 px-1 text-right">Qty</th>
                    <th className="w-12 py-2 px-1">Unit</th>
                    {showRate && <th className="w-28 py-2 px-1 text-right">Rate</th>}
                    {!viewMode && <th className="w-10 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-4 text-center text-xs text-slate-400">
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
                                placeholder="Select item / product"
                                options={pickOptions}
                              />
                            )}
                          </td>
                          {showClassification && (
                            <td className="px-1 text-slate-500">{p?.category ?? '—'}</td>
                          )}
                          {showClassification && (
                            <td className="px-1 text-slate-500">{p?.group ?? '—'}</td>
                          )}
                          {inbound && viewMode && (
                            <td className="px-1 font-mono text-xs text-slate-500">
                              {docLine?.batchNo1 ?? '—'}
                            </td>
                          )}
                          {inbound && (
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
                          )}
                          {inbound && (
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
                          )}
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
                          {showRate && (
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
                          )}
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
