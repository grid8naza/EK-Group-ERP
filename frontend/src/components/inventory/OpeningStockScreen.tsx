'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { money2, dec2, formatDayMonthYear } from '@/lib/utils';
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
import { Input, Select, Textarea, DateInput } from '@/components/ui/Field';
import type {
  OpeningStock,
  StockDocumentRow,
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
  // Selling-price snapshots (products only; defaulted from the product master).
  intercompanyPrice: string;
  wholesalePrice: string;
  retailPrice: string;
  batchNo2: string;
  expiry: string;
};

/** A line's value at cost — the same maths the listing's Amount column reports. */
const lineTotal = (l: DraftLine) =>
  (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const todayInput = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
const fmtDate = (iso?: string | null) => (iso ? formatDayMonthYear(iso) : '—');

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

  const {
    data: rows,
    loading,
    refetch,
  } = useFetch<StockDocumentRow[]>(`/opening-stock/documents?type=${type}`);
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
  // Products carry the master prices (cost + the three selling prices) so a
  // freshly picked product can default them onto the opening-stock line.
  type Pickable = {
    id: number;
    name: string;
    unit: string;
    costPrice?: number;
    intercompanyPrice?: number;
    wholesalePrice?: number;
    retailPrice?: number;
  };
  const pickable = useMemo<Pickable[]>(() => {
    if (isItem) {
      // PACKING_MATERIAL categories hold packing items; the other item kind
      // (Ingredients) is raw material.
      const packingCatIds = new Set(
        (categories ?? [])
          .filter((c) => c.kind === 'PACKING_MATERIAL')
          .map((c) => c.id),
      );
      const wantPacking = type === 'ITEM_PACKING';
      return (items ?? [])
        .filter((i) => {
          const isPacking =
            i.categoryId != null && packingCatIds.has(i.categoryId);
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
        costPrice: p.costPrice,
        intercompanyPrice: p.intercompanyPrice,
        wholesalePrice: p.wholesalePrice,
        retailPrice: p.retailPrice,
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
    () =>
      (stores ?? []).map((s) => ({
        value: s.id,
        label: `${s.name} (${s.code})`,
      })),
    [stores],
  );
  // The active branch's default store (stores are already branch-scoped), used
  // to pre-select the store combo when a new document is started.
  const defaultStoreId = useMemo(
    () => (stores ?? []).find((s) => s.isDefault)?.id,
    [stores],
  );

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
    intercompanyPrice: '',
    wholesalePrice: '',
    retailPrice: '',
    batchNo2: '',
    expiry: '',
  });
  // Keyboard-fast entry: focus a field by id; append a line and land the cursor
  // on its item picker for uninterrupted, mouse-free data entry.
  const focusId = (id: string) =>
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  const addLine = () => {
    const newIndex = lines.length;
    setLines((ls) => [...ls, blankLine()]);
    focusId(`os-${newIndex}-item`);
  };
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  // Picking a product defaults its cost price + the three selling prices from
  // the product master — same values as the Products - Packed screen. Editable
  // afterwards. Items have no such prices, so only the key is set.
  const s0 = (n?: number) => (n ? dec2(String(n)) : '');
  const selectStockable = (i: number, id: string) => {
    const pk = id ? pickById.get(id) : undefined;
    setLine(i, {
      key: id,
      ...(pk && !isItem
        ? {
            unitPrice: s0(pk.costPrice),
            intercompanyPrice: s0(pk.intercompanyPrice),
            wholesalePrice: s0(pk.wholesalePrice),
            retailPrice: s0(pk.retailPrice),
          }
        : {}),
    });
  };

  // Enter in a line field moves to the next; Enter on a line's LAST field jumps
  // to the next line's item (adding a line when on the last row).
  const enterTo = (nextId: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById(nextId)?.focus();
    }
  };
  const enterNextLine = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (i >= lines.length - 1) addLine();
    else focusId(`os-${i + 1}-item`);
  };

  const openNew = () => {
    setEditingDoc(null);
    setViewMode(false);
    const initStore = defaultStoreId ? String(defaultStoreId) : '';
    const initDate = todayInput();
    const initLines = [blankLine()];
    setStoreId(initStore);
    setDocDate(initDate);
    setReference('');
    setNotes('');
    setLines(initLines);
    initialSnapshot.current = makeSnap(initStore, initDate, '', '', initLines);
    setOpen(true);
    focusId('os-docdate'); // land the cursor in Document date on open
  };

  const loadDoc = async (documentId: number) => {
    const full = await api.get<OpeningStock>(`/opening-stock/${documentId}`);
    setEditingDoc(full);
    setStoreId(String(full.storeId));
    setDocDate(dateInput(full.docDate));
    setReference(full.reference ?? '');
    setNotes(full.notes ?? '');
    const loadedLines: DraftLine[] = (full.lines ?? []).map((l) => ({
      key: String(l.itemId ?? l.productId ?? ''),
      quantity: String(l.qtyIn),
      unitPrice: dec2(String(l.unitPrice ?? 0)),
      intercompanyPrice: s0(l.intercompanyPrice),
      wholesalePrice: s0(l.wholesalePrice),
      retailPrice: s0(l.retailPrice),
      batchNo2: l.batchNo2 ?? '',
      expiry: dateInput(l.expiryDate),
    }));
    setLines(loadedLines);
    initialSnapshot.current = makeSnap(
      String(full.storeId),
      dateInput(full.docDate),
      full.reference ?? '',
      full.notes ?? '',
      loadedLines,
    );
  };
  const openView = async (r: StockDocumentRow) => {
    try {
      await loadDoc(r.id);
      setViewMode(true);
      setOpen(true);
    } catch {
      toast.error('Failed to open the document.');
    }
  };
  const openEdit = async (r: StockDocumentRow) => {
    if (r.isLocked) {
      toast.error('This document is locked. Unlock it first to edit.');
      return;
    }
    try {
      await loadDoc(r.id);
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

  // Snapshot of the form as it was opened/last saved, to detect unsaved edits.
  const initialSnapshot = useRef('');
  const makeSnap = (
    sStore: string,
    sDate: string,
    sRef: string,
    sNotes: string,
    sLines: DraftLine[],
  ) => JSON.stringify({ sStore, sDate, sRef, sNotes, sLines });
  const isDirty = () =>
    makeSnap(storeId, docDate, reference, notes, lines) !==
    initialSnapshot.current;

  // Close guarded by an unsaved-changes prompt (X, Cancel, Esc). View mode and a
  // pristine form close straight away.
  const requestClose = async () => {
    if (!viewMode && isDirty()) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'This document has unsaved changes. Close without saving?',
        danger: true,
        confirmText: 'Discard',
      });
      if (!ok) return;
    }
    closeOverlay();
  };

  const buildLines = () =>
    lines
      .filter((l) => l.key && Number(l.quantity) > 0)
      .map((l) => ({
        itemId: isItem ? Number(l.key) : undefined,
        productId: !isItem ? Number(l.key) : undefined,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice ? Number(l.unitPrice) : 0,
        // Selling prices apply to products only.
        intercompanyPrice:
          !isItem && l.intercompanyPrice ? Number(l.intercompanyPrice) : 0,
        wholesalePrice:
          !isItem && l.wholesalePrice ? Number(l.wholesalePrice) : 0,
        retailPrice: !isItem && l.retailPrice ? Number(l.retailPrice) : 0,
        batchNo2: l.batchNo2.trim() || undefined,
        expiryDate: l.expiry ? new Date(l.expiry).toISOString() : undefined,
      }));

  const resetForm = () => {
    setEditingDoc(null);
    const initDate = todayInput();
    const initLines = [blankLine()];
    setStoreId('');
    setDocDate(initDate);
    setReference('');
    setNotes('');
    setLines(initLines);
    initialSnapshot.current = makeSnap('', initDate, '', '', initLines);
  };

  const doSave = async (mode: SaveMode = 'saveClose') => {
    if (saving) return;
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
      let savedId: number;
      if (editingDoc) {
        await api.patch(`/opening-stock/${editingDoc.id}`, payload);
        savedId = editingDoc.id;
        toast.success('Opening stock updated.');
      } else {
        const created = await api.post<OpeningStock>('/opening-stock', payload);
        savedId = created.id;
        toast.success('Opening stock posted.');
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

  // Alt+A adds a line while editing. Save shortcuts + Esc are handled by
  // DrawerFooter / the Drawer.
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

  const remove = async (r: StockDocumentRow) => {
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
      await api.delete(`/opening-stock/${r.id}`);
      toast.success('Opening stock deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const toggleLock = async (r: StockDocumentRow) => {
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
      await api.patch(`/opening-stock/${r.id}/lock`, { locked: locking });
      toast.success(locking ? 'Document locked.' : 'Document unlocked.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };

  const columns: Column<StockDocumentRow>[] = [
    {
      key: 'docDate',
      header: 'Date',
      accessor: (r) => fmtDate(r.docDate),
      sortable: true,
      sortAccessor: (r) => r.docDate,
    },
    {
      key: 'docNo',
      header: 'Doc Number',
      sortable: true,
      sortAccessor: (r) => r.docNo,
      render: (r) => (
        <span className="text-slate-800 dark:text-slate-100">{r.docNo}</span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      accessor: (r) => r.reference ?? '—',
    },
    { key: 'company', header: 'Company', accessor: (r) => r.companyName },
    { key: 'branch', header: 'Branch', accessor: (r) => r.branchName ?? '—' },
    { key: 'store', header: 'Store', accessor: (r) => r.storeName },
    {
      key: 'amount',
      header: 'Amount',
      accessor: (r) =>
        r.amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortable: true,
      sortAccessor: (r) => r.amount,
    },
    {
      key: 'txnType',
      header: 'Transaction Type',
      accessor: (r) => r.transactionType ?? '—',
    },
    {
      key: 'txnSubtype',
      header: 'Transaction Subtype',
      accessor: (r) => r.transactionSubtype ?? '—',
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
        rows={rows ?? []}
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
      />

      {/* Overlay data-entry form */}
      <Drawer
        open={open}
        onClose={requestClose}
        title={
          viewMode
            ? `Opening Stock ${editingDoc?.docNo ?? ''}`
            : editingDoc
              ? `Edit ${editingDoc.docNo}`
              : `New ${title}`
        }
        subtitle="Opening balance document"
        icon={<ClipboardList className="h-5 w-5" />}
        width="full"
        footer={
          viewMode ? (
            <CloseFooter onClose={closeOverlay} />
          ) : (
            <DrawerFooter
              onCancel={requestClose}
              onSave={doSave}
              saving={saving}
              dataEntry
              leading={
                <button className="btn-secondary" onClick={addLine}>
                  <Plus className="h-4 w-4" /> Add line <Kbd>Alt+A</Kbd>
                </button>
              }
            />
          )
        }
      >
        <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-4">
          {/* Frozen header pane — stays put while the lines scroll. */}
          <div className="flex-none grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Store"
              required
              disabled={viewMode}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="Select a store"
              options={storeOptions}
            />
            <DateInput
              id="os-docdate"
              label="Document date"
              disabled={viewMode}
              value={docDate}
              onChange={(iso) => setDocDate(iso)}
            />
            <Input
              label="Reference"
              disabled={viewMode}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Scrollable lines — the column headings stick to the top. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm [&_td]:border [&_td]:border-slate-200 [&_th]:border [&_th]:border-slate-200 dark:[&_td]:border-slate-700 dark:[&_th]:border-slate-700">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                    <th className="w-10 py-2 pl-3 pr-1 text-center">#</th>
                    <th className="py-2 pr-2">{isItem ? 'Item' : 'Product'}</th>
                    {viewMode && <th className="py-2 px-1">Batch No</th>}
                    <th className="py-2 px-1">Supplier Batch</th>
                    <th className="w-32 py-2 px-1">Expiry</th>
                    <th className="w-24 py-2 px-1">Qty</th>
                    <th className="w-12 py-2 px-1">Unit</th>
                    <th className="w-28 py-2 px-1">Cost Price</th>
                    <th className="w-28 py-2 px-1">Total</th>
                    {!isItem && (
                      <>
                        <th className="w-28 py-2 px-1">Inter-Co</th>
                        <th className="w-28 py-2 px-1">Wholesale</th>
                        <th className="w-28 py-2 px-1">Retail</th>
                      </>
                    )}
                    {!viewMode && <th className="w-10 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={13}
                        className="py-4 text-center text-xs text-slate-400"
                      >
                        No lines.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l, i) => {
                      const p = l.key ? pickById.get(l.key) : undefined;
                      const docLine = editingDoc?.lines?.[i];
                      return (
                        <tr
                          key={i}
                          className="border-b border-slate-100 dark:border-slate-800/60"
                        >
                          <td className="py-1.5 pl-3 pr-1 text-right text-xs tabular-nums text-slate-400">
                            {i + 1}
                          </td>
                          <td className="py-1.5 pr-2 min-w-[12rem]">
                            {viewMode ? (
                              <span className="text-slate-800 dark:text-slate-100">
                                {p?.name ?? '—'}
                              </span>
                            ) : (
                              <Select
                                id={`os-${i}-item`}
                                openOnFocus
                                // Always show the search box (even with few
                                // options) so the picker is type-to-search the
                                // moment it gets focus.
                                searchThreshold={0}
                                advanceToId={`os-${i}-batch`}
                                value={l.key}
                                onChange={(e) =>
                                  selectStockable(i, e.target.value)
                                }
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
                              <span className="text-slate-600">
                                {l.batchNo2 || '—'}
                              </span>
                            ) : (
                              <Input
                                id={`os-${i}-batch`}
                                value={l.batchNo2}
                                onChange={(e) =>
                                  setLine(i, { batchNo2: e.target.value })
                                }
                                onKeyDown={enterTo(`os-${i}-expiry`)}
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
                              <DateInput
                                id={`os-${i}-expiry`}
                                value={l.expiry}
                                onChange={(iso) => setLine(i, { expiry: iso })}
                                onKeyDown={enterTo(`os-${i}-qty`)}
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
                                id={`os-${i}-qty`}
                                type="number"
                                min={0}
                                step="any"
                                value={l.quantity}
                                onChange={(e) =>
                                  setLine(i, { quantity: e.target.value })
                                }
                                onKeyDown={enterTo(`os-${i}-rate`)}
                                className="text-right tabular-nums"
                              />
                            )}
                          </td>
                          <td className="px-1 text-slate-500">
                            {p?.unit ?? ''}
                          </td>
                          <td className="px-1">
                            {viewMode ? (
                              <span className="block text-right tabular-nums">
                                {money2(l.unitPrice)}
                              </span>
                            ) : (
                              <Input
                                id={`os-${i}-rate`}
                                type="number"
                                min={0}
                                step="any"
                                value={l.unitPrice}
                                onChange={(e) =>
                                  setLine(i, { unitPrice: e.target.value })
                                }
                                onBlur={() =>
                                  setLine(i, { unitPrice: dec2(l.unitPrice) })
                                }
                                onKeyDown={
                                  isItem
                                    ? enterNextLine(i)
                                    : enterTo(`os-${i}-interco`)
                                }
                                className="text-right tabular-nums"
                              />
                            )}
                          </td>
                          {/* Line value at cost — derived, never entered, and the
                              same maths the listing's Amount column reports. */}
                          <td className="px-1">
                            <span className="block text-right tabular-nums text-slate-600 dark:text-slate-300">
                              {money(lineTotal(l))}
                            </span>
                          </td>
                          {!isItem && (
                            <>
                              <td className="px-1">
                                {viewMode ? (
                                  <span className="block text-right tabular-nums">
                                    {money2(l.intercompanyPrice)}
                                  </span>
                                ) : (
                                  <Input
                                    id={`os-${i}-interco`}
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={l.intercompanyPrice}
                                    onChange={(e) =>
                                      setLine(i, {
                                        intercompanyPrice: e.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      setLine(i, {
                                        intercompanyPrice: dec2(
                                          l.intercompanyPrice,
                                        ),
                                      })
                                    }
                                    onKeyDown={enterTo(`os-${i}-wholesale`)}
                                    className="text-right tabular-nums"
                                  />
                                )}
                              </td>
                              <td className="px-1">
                                {viewMode ? (
                                  <span className="block text-right tabular-nums">
                                    {money2(l.wholesalePrice)}
                                  </span>
                                ) : (
                                  <Input
                                    id={`os-${i}-wholesale`}
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={l.wholesalePrice}
                                    onChange={(e) =>
                                      setLine(i, {
                                        wholesalePrice: e.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      setLine(i, {
                                        wholesalePrice: dec2(l.wholesalePrice),
                                      })
                                    }
                                    onKeyDown={enterTo(`os-${i}-retail`)}
                                    className="text-right tabular-nums"
                                  />
                                )}
                              </td>
                              <td className="px-1">
                                {viewMode ? (
                                  <span className="block text-right tabular-nums">
                                    {money2(l.retailPrice)}
                                  </span>
                                ) : (
                                  <Input
                                    id={`os-${i}-retail`}
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={l.retailPrice}
                                    onChange={(e) =>
                                      setLine(i, {
                                        retailPrice: e.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      setLine(i, {
                                        retailPrice: dec2(l.retailPrice),
                                      })
                                    }
                                    onKeyDown={enterNextLine(i)}
                                    className="text-right tabular-nums"
                                  />
                                )}
                              </td>
                            </>
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
                {lines.length > 0 && (
                  // Sticks to the bottom like the headings stick to the top, so
                  // the grand total stays in view while long vouchers scroll.
                  <tfoot className="sticky bottom-0 z-10 bg-slate-50 dark:bg-slate-900">
                    <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-600">
                      {/* Spans everything up to and including Cost Price:
                          #, Product, [Batch No — view only], Supplier Batch,
                          Expiry, Qty, Unit, Cost Price. */}
                      <td
                        colSpan={viewMode ? 8 : 7}
                        className="py-2 pr-2 text-right text-xs uppercase tracking-wide text-slate-500"
                      >
                        Grand total
                      </td>
                      <td className="px-1 py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {money(grandTotal)}
                      </td>
                      {!isItem && <td colSpan={3} />}
                      {!viewMode && <td />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {!viewMode && (
              <p className="mt-2 text-xs text-slate-400">
                Enter moves to the next field; from the last field it starts a
                new line. Alt+A adds a line. Ctrl+S posts.
              </p>
            )}
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
