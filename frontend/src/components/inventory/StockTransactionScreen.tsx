'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, Printer, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { money2, dec2 } from '@/lib/utils';
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
import {
  StockDocumentPrint,
  type PrintLine,
} from '@/components/inventory/StockDocumentPrint';
import type {
  StockTransaction,
  StockDocumentRow,
  StockTxnKind,
  Store,
  Item,
  Product,
  Supplier,
  Company,
  CostCenter,
  CostObject,
  IncomingDispatch,
} from '@/lib/types';

type DraftLine = {
  key: string; // "item:<id>" | "product:<id>"
  quantity: string;
  unitPrice: string;
  batchNo2: string;
  expiry: string;
  /** Set when the line came off a dispatch: what the seller shipped. */
  dispatchedQty?: number;
  /**
   * Which unit the typed quantity is in. Stock is always what gets posted —
   * 'box' just means the entry is multiplied by the stockable's box quantity on
   * the way out, so pickers can count boxes instead of doing the sum.
   */
  unitMode?: 'stock' | 'box';
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
  showIncomingDispatch = false,
  showCosting = false,
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
  /**
   * Offer the intercompany shipments waiting to be received (GRN). Picking one
   * fills the lines with what was dispatched; quantities stay editable so short
   * or damaged goods are received for what actually arrived.
   */
  showIncomingDispatch?: boolean;
  /**
   * Offer a cost centre / cost object on the header (Goods Issue Note). Raw
   * material ITEMS carry no costing of their own, so an issue raised outside a
   * Material Request has nothing to inherit — this is where the user says what
   * it is for. When set it overrides the per-line product costing.
   */
  showCosting?: boolean;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: rows, loading, refetch } = useFetch<StockDocumentRow[]>(
    `/stock-transactions/documents?type=${type}`,
  );
  const { data: stores } = useFetch<Store[]>('/stores');
  const { data: costCenters } = useFetch<CostCenter[]>(
    showCosting ? '/cost-centers' : null,
  );
  const { data: costObjects } = useFetch<CostObject[]>(
    showCosting ? '/cost-objects' : null,
  );
  const { data: items } = useFetch<Item[]>('/items');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: suppliers } = useFetch<Supplier[]>(
    showSupplier ? '/suppliers' : null,
  );
  const { data: incoming, refetch: refetchIncoming } = useFetch<IncomingDispatch[]>(
    showIncomingDispatch ? '/stock-transactions/incoming-dispatches' : null,
  );
  const { data: companies } = useFetch<Company[]>(
    showIncomingDispatch ? '/companies' : null,
  );

  const canAdd = can(route, 'add');
  const canEditPriv = can(route, 'edit');
  const canDeletePriv = can(route, 'delete');
  const canViewPriv = can(route, 'view');
  const canLock = can(route, 'lock');
  const canUnlock = can(route, 'unlock');

  // ---- pickable stockables: items AND products, keyed by kind ----
  const pickable = useMemo(() => {
    // Box packing rides along: a stockable that is boxed can be counted in
    // boxes on the line, and boxQty is what converts that to stock units.
    const boxOf = (x: Item | Product) =>
      x.boxUnitId && x.boxQty > 0
        ? {
            boxQty: x.boxQty,
            boxUnitId: x.boxUnitId,
            boxUnit: x.boxUnit?.symbol ?? x.boxUnit?.code ?? 'box',
          }
        : {};
    const its = (items ?? []).map((i) => ({
      key: `item:${i.id}`,
      name: i.name,
      unit: i.unit?.symbol ?? i.unit?.code ?? '',
      category: i.category?.name ?? '—',
      group: i.group?.name ?? '—',
      ...boxOf(i),
    }));
    const prs = (products ?? []).map((p) => ({
      key: `product:${p.id}`,
      name: p.name,
      unit: p.unit?.symbol ?? p.unit?.code ?? '',
      category: p.category?.name ?? '—',
      group: p.group?.name ?? '—',
      ...boxOf(p),
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
  const companyName = (id: number) =>
    (companies ?? []).find((c) => c.id === id)?.name ?? `#${id}`;
  const incomingOptions = useMemo(
    () =>
      (incoming ?? []).map((d) => ({
        value: String(d.id),
        label: `${d.dispatchNo} — ${companyName(d.sellerCompanyId)}${
          d.invoiceNo ? ` — ${d.invoiceNo}` : ''
        }`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incoming, companies],
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

  // ---- overlay entry form ----
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState(false);
  const [editingDoc, setEditingDoc] = useState<StockTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [docDate, setDocDate] = useState(todayInput());
  const [supplierId, setSupplierId] = useState('');
  const [dispatchId, setDispatchId] = useState('');
  const [poRef, setPoRef] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [costObjectId, setCostObjectId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  // The listing row the open document came from: the header stores ids, and
  // the printout wants the company / branch / store names it already resolved.
  const [docRow, setDocRow] = useState<StockDocumentRow | null>(null);

  // Costing pickers: the endpoints scope to the active company already, and the
  // objects cascade from the chosen centre.
  const costCenterOptions = useMemo(
    () =>
      (costCenters ?? [])
        .filter((c) => c.isActive)
        .map((c) => ({ value: String(c.id), label: c.name })),
    [costCenters],
  );
  const costObjectOptions = useMemo(
    () =>
      (costObjects ?? [])
        .filter(
          (o) =>
            o.isActive &&
            (!costCenterId || o.costCenterId === Number(costCenterId)),
        )
        .map((o) => ({ value: String(o.id), label: o.name })),
    [costObjects, costCenterId],
  );

  const blankLine = (): DraftLine => ({
    key: '',
    quantity: '',
    unitPrice: '',
    batchNo2: '',
    expiry: '',
  });
  // Keyboard-fast entry: focus a field by id; append a line and land the cursor
  // on its item picker for uninterrupted, mouse-free data entry.
  const focusId = (id: string) =>
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  const addLine = () => {
    const newIndex = lines.length;
    setLines((ls) => [...ls, blankLine()]);
    focusId(`stl-${newIndex}-item`);
  };
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  /**
   * Receive an intercompany shipment: the dispatch's own lines become the
   * receipt's, at the quantity and price that were shipped. The quantities stay
   * editable — what actually arrived is what gets banked, and anything accepted
   * short simply never enters stock.
   */
  const pickDispatch = (id: string) => {
    setDispatchId(id);
    const d = (incoming ?? []).find((x) => String(x.id) === id);
    if (!d) {
      setLines([blankLine()]);
      return;
    }
    setSupplierId(''); // the goods came from a group company, not a supplier
    setPoRef(d.soNumber ?? '');
    setReference(d.invoiceNo ?? d.dispatchNo);
    setLines(
      d.lines.map((l) => ({
        key: `product:${l.productId}`,
        quantity: String(l.quantity),
        unitPrice: dec2(String(l.rate)),
        batchNo2: l.batchNo ?? '',
        expiry: dateInput(l.expiryDate),
        dispatchedQty: l.quantity,
      })),
    );
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
    else focusId(`stl-${i + 1}-item`);
  };

  const openNew = () => {
    setEditingDoc(null);
    setDocRow(null);
    setViewMode(false);
    setStoreId(defaultStoreId ? String(defaultStoreId) : '');
    setDocDate(todayInput());
    setSupplierId('');
    setDispatchId('');
    setPoRef('');
    setCostCenterId('');
    setCostObjectId('');
    setReference('');
    setNotes('');
    setLines([blankLine()]);
    setOpen(true);
    focusId('stl-docdate'); // land the cursor in Document date on open
  };

  const loadDoc = async (documentId: number) => {
    const full = await api.get<StockTransaction>(`/stock-transactions/${documentId}`);
    setEditingDoc(full);
    setStoreId(String(full.storeId));
    setDocDate(dateInput(full.docDate));
    setSupplierId(full.supplierId ? String(full.supplierId) : '');
    setDispatchId(full.dispatchId ? String(full.dispatchId) : '');
    setPoRef(full.purchaseOrderRef ?? '');
    setCostCenterId(full.costCenterId ? String(full.costCenterId) : '');
    setCostObjectId(full.costObjectId ? String(full.costObjectId) : '');
    setReference(full.reference ?? '');
    setNotes(full.notes ?? '');
    setLines(
      (full.lines ?? []).map((l) => {
        // A line entered in the pack comes back in the pack: the document
        // should read as it was written, not as the stock it became.
        const stockQty = inbound ? l.qtyIn : l.qtyOut;
        const inPack = l.enteredQty != null && l.enteredUnitId != null;
        // Pack rate as invoiced. Rows saved before it was stored fall back
        // to deriving it from the stock rate and the pack size.
        const packQty = inPack && l.enteredQty ? stockQty / l.enteredQty : 1;
        const packRate =
          l.enteredUnitPrice ?? round6((l.unitPrice ?? 0) * packQty);
        return {
          key: l.itemId ? `item:${l.itemId}` : `product:${l.productId}`,
          quantity: String(inPack ? l.enteredQty : stockQty),
          unitPrice: dec2(String(inPack ? packRate : (l.unitPrice ?? 0))),
          unitMode: (inPack ? 'box' : 'stock') as 'box' | 'stock',
          batchNo2: l.batchNo2 ?? '',
          expiry: dateInput(l.expiryDate),
        };
      }),
    );
  };
  const openView = async (r: StockDocumentRow) => {
    try {
      await loadDoc(r.id);
      setDocRow(r);
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
      setDocRow(r);
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

  // Derived rates divide by the pack size, so they need a sane precision:
  // 6 dp keeps a 0.000001 rate honest without trailing float noise.
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

  // The pack unit's id for a line, stamped on the saved document.
  const boxUnitIdOf = (l: DraftLine) => {
    const pick = l.key ? pickById.get(l.key) : undefined;
    return pick && 'boxUnitId' in pick ? (pick.boxUnitId as number) ?? null : null;
  };

  // How many stock units one pack holds for a line (1 when it isn't packed).
  const boxQtyOf = (l: DraftLine) => {
    const pick = l.key ? pickById.get(l.key) : undefined;
    return pick && 'boxQty' in pick && pick.boxQty ? pick.boxQty : 1;
  };

  // True once any line is counted in packs: the stock column only earns its
  // width on a document that actually has one.
  const anyInPacks = lines.some((l) => {
    if (l.unitMode !== 'box' || !l.key) return false;
    const pick = pickById.get(l.key);
    return !!pick && 'boxQty' in pick && !!pick.boxQty;
  });

  const buildLines = () =>
    lines
      .filter((l) => l.key && Number(l.quantity) > 0)
      .map((l) => {
        const [kind, idStr] = l.key.split(':');
        const id = Number(idStr);
        return {
          itemId: kind === 'item' ? id : undefined,
          productId: kind === 'product' ? id : undefined,
          // Packs are an entry convenience; stock is always posted in stock
          // units, and the rate follows it — 1 bottle at 50 is 200 g at 0.25,
          // so the line total is the same either way.
          quantity: Number(l.quantity) * (l.unitMode === 'box' ? boxQtyOf(l) : 1),
          unitPrice: l.unitPrice
            ? l.unitMode === 'box'
              ? round6(Number(l.unitPrice) / boxQtyOf(l))
              : Number(l.unitPrice)
            : 0,
          // The document's own words, so reopening shows the delivery note
          // (1 Bottle at 50) rather than the stock it became (200 g at
          // 0.25). Both rates are stored — reports read them together and
          // dividing one back out would only reintroduce rounding.
          ...(l.unitMode === 'box'
            ? {
                enteredQty: Number(l.quantity),
                enteredUnitId: boxUnitIdOf(l),
                enteredUnitPrice: l.unitPrice ? Number(l.unitPrice) : 0,
              }
            : {
                enteredQty: null,
                enteredUnitId: null,
                enteredUnitPrice: null,
              }),
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
    setDispatchId('');
    setPoRef('');
    setCostCenterId('');
    setCostObjectId('');
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
        ...(showCosting
          ? {
              costCenterId: costCenterId ? Number(costCenterId) : null,
              costObjectId: costObjectId ? Number(costObjectId) : null,
            }
          : {}),
        // The dispatch link is set when the receipt is raised and never moves.
        ...(showIncomingDispatch && !editingDoc && dispatchId
          ? { dispatchId: Number(dispatchId) }
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
      // A received shipment drops off the incoming list.
      if (showIncomingDispatch) await refetchIncoming();
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

  const remove = async (r: StockDocumentRow) => {
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
      await api.delete(`/stock-transactions/${r.id}`);
      toast.success('Transaction deleted.');
      refetch();
      // Deleting a dispatch receipt hands the shipment back to the incoming list.
      if (showIncomingDispatch) refetchIncoming();
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
      await api.patch(`/stock-transactions/${r.id}/lock`, { locked: locking });
      toast.success(locking ? 'Document locked.' : 'Document unlocked.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };

  // Receiving a shipment shows what was sent beside what is being accepted, so
  // a shortage is visible while it is still being keyed.
  const showDispatched =
    showIncomingDispatch && lines.some((l) => l.dispatchedQty !== undefined);
  const shortLines = lines.filter(
    (l) => l.dispatchedQty !== undefined && Number(l.quantity) < l.dispatchedQty,
  );
  // The GRN hides rates normally, but a received shipment came priced — that is
  // what the goods cost this company, so it is shown (read-only: the seller set it).
  const showRateCol = showRate || showDispatched;

  // The open document's lines, resolved for the printout: what the document
  // says (1 Bottle at 50) beside what entered stock (200 Gram).
  const printLines: PrintLine[] = lines
    .filter((l) => l.key && Number(l.quantity) > 0)
    .map((l) => {
      const pick = pickById.get(l.key);
      const packQty = pick && 'boxQty' in pick ? (pick.boxQty as number) : 0;
      const inPacks = l.unitMode === 'box' && !!packQty;
      const qty = Number(l.quantity);
      return {
        name: pick?.name ?? '',
        qty,
        unit: inPacks ? (pick?.boxUnit as string) : (pick?.unit ?? ''),
        stockQty: inPacks ? qty * packQty : qty,
        stockUnit: pick?.unit ?? '',
        inPacks,
        rate: Number(l.unitPrice || 0),
        batchNo2: l.batchNo2,
        expiry: l.expiry,
      };
    });
  const supplierName = supplierId
    ? supplierOptions.find((o) => o.value === supplierId)?.label
    : undefined;

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
    { key: 'reference', header: 'Reference', accessor: (r) => r.reference ?? '—' },
    { key: 'company', header: 'Company', accessor: (r) => r.companyName },
    { key: 'branch', header: 'Branch', accessor: (r) => r.branchName ?? '—' },
    { key: 'store', header: 'Store', accessor: (r) => r.storeName },
    {
      key: 'amount',
      header: 'Amount',
      accessor: (r) =>
        r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortable: true,
      sortAccessor: (r) => r.amount,
    },
    { key: 'txnType', header: 'Transaction Type', accessor: (r) => r.transactionType ?? '—' },
    { key: 'txnSubtype', header: 'Transaction Subtype', accessor: (r) => r.transactionSubtype ?? '—' },
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
        emptyMessage="No entries yet"
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
        width="full"
        footer={
          viewMode ? (
            <div className="flex items-center justify-end gap-2">
              {/* No separate print privilege gate: canPrint is only grantable on
                  REPORT screens, and these are FORMs. Opening the document is
                  the permission — this prints what is already on the screen. */}
              <button className="btn-secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </button>
              <CloseFooter onClose={closeOverlay} />
            </div>
          ) : (
            <DrawerFooter
              onCancel={closeOverlay}
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
          <div className="flex-none space-y-4">
            {showIncomingDispatch &&
              (editingDoc ? (
                editingDoc.dispatchNo && (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    Received against intercompany dispatch{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {editingDoc.dispatchNo}
                    </span>
                  </p>
                )
              ) : (
                <div>
                  <Select
                    label="Incoming dispatch"
                    value={dispatchId}
                    onChange={(e) => pickDispatch(e.target.value)}
                    placeholder={
                      incomingOptions.length
                        ? 'Receive an intercompany shipment (optional)'
                        : 'No shipments awaiting receipt'
                    }
                    options={incomingOptions}
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Fills the lines with what was dispatched. Reduce a quantity
                    to receive short or damaged goods — only what you accept
                    enters stock.
                  </p>
                </div>
              ))}
            {showSupplier && !dispatchId && (
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
            {/* Costing — what this issue is FOR. Raw-material items carry none
                of their own, so without this an ad-hoc issue reports as
                Unassigned; setting it also overrides the per-line product
                costing, which is the point when issuing finished goods to,
                say, the staff mess. */}
            {showCosting && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label="Cost centre"
                  disabled={viewMode}
                  value={costCenterId}
                  onChange={(e) => {
                    // A different centre invalidates the object under it.
                    setCostCenterId(e.target.value);
                    setCostObjectId('');
                  }}
                  placeholder={
                    costCenterOptions.length
                      ? '— None —'
                      : 'No cost centres in this company'
                  }
                  options={costCenterOptions}
                />
                <Select
                  label="Cost object"
                  disabled={viewMode || !costCenterId}
                  value={costObjectId}
                  onChange={(e) => setCostObjectId(e.target.value)}
                  placeholder={
                    costCenterId ? '— None —' : 'Pick a cost centre first'
                  }
                  options={costObjectOptions}
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
              <DateInput
                id="stl-docdate"
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
          </div>

          {/* Scrollable lines — the column headings stick to the top. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                    <th className="w-10 py-2 pl-3 pr-1 text-right">#</th>
                    <th className="py-2 pr-2">Item / Product</th>
                    {showClassification && <th className="py-2 px-1">Category</th>}
                    {showClassification && <th className="py-2 px-1">Parent Group</th>}
                    {inbound && viewMode && <th className="py-2 px-1">Batch No</th>}
                    {inbound && <th className="py-2 px-1">Supplier Batch</th>}
                    {inbound && <th className="w-32 py-2 px-1">Expiry</th>}
                    {showDispatched && (
                      <th className="w-24 py-2 px-1 text-right">Dispatched</th>
                    )}
                    <th className="w-24 py-2 px-1 text-right">
                      {showDispatched ? 'Accepted' : 'Qty'}
                    </th>
                    <th className="w-12 py-2 px-1">Unit</th>
                    {anyInPacks && (
                      <th className="w-28 py-2 px-1 text-right">Stock Qty</th>
                    )}
                    {showRateCol && (
                      <th className="w-28 py-2 px-1 text-right">Rate</th>
                    )}
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
                      // Stock is always held in the stock unit (grams), but
                      // goods are handled in the pack: a bottle of coffee is
                      // bought as one bottle and consumed by the gram. The
                      // line can be typed either way and converts on save.
                      const boxed =
                        p && 'boxQty' in p && p.boxQty
                          ? {
                              boxQty: p.boxQty as number,
                              boxUnit: p.boxUnit as string,
                            }
                          : undefined;
                      const inBoxes = !!boxed && l.unitMode === 'box';
                      const docLine = editingDoc?.lines?.[i];
                      return (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-800/60">
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
                                id={`stl-${i}-item`}
                                openOnFocus
                                advanceToId={
                                  inbound ? `stl-${i}-batch` : `stl-${i}-qty`
                                }
                                value={l.key}
                                onChange={(e) => {
                                  // Receipts come in packs (a case of
                                  // bottles), issues go out in stock units
                                  // (20 g a cup), so each starts where it
                                  // is normally counted.
                                  const pick = pickById.get(e.target.value);
                                  const isBoxed =
                                    !!pick && 'boxQty' in pick && !!pick.boxQty;
                                  setLine(i, {
                                    key: e.target.value,
                                    unitMode: inbound && isBoxed ? 'box' : 'stock',
                                  });
                                }}
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
                                  id={`stl-${i}-batch`}
                                  value={l.batchNo2}
                                  onChange={(e) => setLine(i, { batchNo2: e.target.value })}
                                  onKeyDown={enterTo(`stl-${i}-expiry`)}
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
                                <DateInput
                                  id={`stl-${i}-expiry`}
                                  value={l.expiry}
                                  onChange={(iso) => setLine(i, { expiry: iso })}
                                  onKeyDown={enterTo(`stl-${i}-qty`)}
                                />
                              )}
                            </td>
                          )}
                          {showDispatched && (
                            <td className="px-1 text-right tabular-nums text-slate-500">
                              {l.dispatchedQty?.toLocaleString() ?? '—'}
                            </td>
                          )}
                          <td className="px-1">
                            {viewMode ? (
                              <span className="block text-right tabular-nums">
                                {Number(l.quantity).toLocaleString()}
                              </span>
                            ) : (
                              <Input
                                id={`stl-${i}-qty`}
                                type="number"
                                min={0}
                                step="any"
                                value={l.quantity}
                                onChange={(e) => setLine(i, { quantity: e.target.value })}
                                onKeyDown={
                                  showRateCol && l.dispatchedQty === undefined
                                    ? enterTo(`stl-${i}-rate`)
                                    : enterNextLine(i)
                                }
                                className="text-right tabular-nums"
                              />
                            )}
                          </td>
                          <td className="px-1 text-slate-500">
                            {boxed && !viewMode ? (
                              <Select
                                value={l.unitMode ?? 'stock'}
                                onChange={(e) =>
                                  setLine(i, {
                                    unitMode: e.target.value as 'stock' | 'box',
                                  })
                                }
                                sortOptions={false}
                                searchThreshold={9}
                                plainSelected
                                wrapClassName="w-24"
                                options={[
                                  { value: 'stock', label: p?.unit || 'Unit' },
                                  { value: 'box', label: boxed.boxUnit },
                                ]}
                              />
                            ) : (
                              <span>{inBoxes ? boxed?.boxUnit : (p?.unit ?? '')}</span>
                            )}
                          </td>
                          {anyInPacks && (
                            <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                              {Number(l.quantity) > 0
                                ? `${(
                                    Number(l.quantity) *
                                    (inBoxes ? boxed.boxQty : 1)
                                  ).toLocaleString()} ${p?.unit ?? ''}`
                                : '—'}
                            </td>
                          )}
                          {showRateCol && (
                            <td className="px-1">
                              {viewMode || l.dispatchedQty !== undefined ? (
                                <span className="block text-right tabular-nums">
                                  {money2(l.unitPrice)}
                                </span>
                              ) : (
                                <Input
                                  id={`stl-${i}-rate`}
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={l.unitPrice}
                                  onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                                  // The rate AS INVOICED is money, so it settles
                                  // to two decimals. The derived per-stock-unit
                                  // rate shown beneath keeps its 6 dp — that one
                                  // is a division, not a price anyone quoted.
                                  onBlur={() => setLine(i, { unitPrice: dec2(l.unitPrice) })}
                                  onKeyDown={enterNextLine(i)}
                                  className="text-right tabular-nums"
                                />
                              )}
                              {inBoxes && Number(l.unitPrice) > 0 && (
                                <span className="mt-0.5 block text-right text-[11px] tabular-nums text-slate-400">
                                  = {round6(Number(l.unitPrice) / boxed.boxQty).toLocaleString()}{' '}
                                  / {p?.unit}
                                </span>
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
            {showDispatched && shortLines.length > 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                {shortLines.length} line{shortLines.length > 1 ? 's' : ''} short
                of what was dispatched — only the accepted quantity enters stock.
              </p>
            )}
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

      {/* The printable face of the open document. It sits in the page flow
          rather than inside the drawer: the panel is a fixed overlay, and a
          fixed box prints as a single clipped page. `print-root` in
          globals.css hides everything else on the paper. */}
      {open && editingDoc && (
        <StockDocumentPrint
          title={title}
          doc={editingDoc}
          row={docRow}
          lines={printLines}
          supplierName={supplierName}
          showRate={showRateCol}
          inbound={inbound}
          notes={notes}
        />
      )}
    </div>
  );
}
