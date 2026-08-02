'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ListTree,
  Plus,
  Trash2,
  Pencil,
  ArrowLeft,
  Cog,
  Info,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Field';
import type {
  Product,
  Category,
  Item,
  Unit,
  Asset,
  HrDesignation,
  HsnCode,
  ProcessTimeUnit,
  Lookup,
  LookupValue,
} from '@/lib/types';

const ROUTE = '/production/packing-master';

// Lookup code the Process combo reads (kept in sync with the backend
// PRODUCTION_PROCESS_LOOKUP_CODE). Values are managed in Production → Lookups.
const PRODUCTION_PROCESS_LOOKUP_CODE = 'PRODUCTION_PROCESS';

type Line = { itemId: string; quantity: string; unitId: string };
/** The per-process working behind a computed cost, shown in its own popup. */
type CostDetail = {
  title: string;
  rows: { label: string; detail: string; amount: number }[];
  total: number;
  empty: string;
};
type ManpowerRow = { designationId: string; count: string };
type Proc = {
  name: string;
  timeValue: string;
  timeUnit: ProcessTimeUnit;
  machineId: string;
  manpower: ManpowerRow[];
};
type Src = { productId: string; quantity: string };

const toLines = (rows: Product['packing']): Line[] =>
  rows.map((l) => ({
    itemId: String(l.itemId),
    quantity: String(l.quantity),
    unitId: String(l.unitId),
  }));

const money = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Normalise an editable numeric string to a fixed 2-decimal display. Blank or
// non-numeric input passes through unchanged so typing stays natural.
const to2 = (s: string) => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? n.toFixed(2) : s;
};

// Normalise an editable numeric string to `d` decimal places (blank or
// non-numeric passes through). Used for the yield quantity, whose precision
// follows the yield unit's decimal places from the Unit master.
const toDecimals = (s: string, d: number) => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? n.toFixed(Math.max(0, d)) : s;
};

// Per-unit prices: values are rounded to 1 decimal but shown with 2 decimals
// (e.g. 12.6 → "12.60"). `toPrice` normalises an editable string the same way.
const round1 = (v: number) => Math.round(v * 10) / 10;
const toPrice = (s: string) => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? round1(n).toFixed(2) : s;
};
const money1 = (v: number) =>
  round1(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const BLANK_LINE: Line = { itemId: '', quantity: '', unitId: '' };
const BLANK_SRC: Src = { productId: '', quantity: '' };
const BLANK_MANPOWER: ManpowerRow = { designationId: '', count: '1' };
const BLANK_PROC: Proc = {
  name: '',
  timeValue: '0',
  timeUnit: 'MIN',
  machineId: '',
  manpower: [],
};

export default function PackingMasterEditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const id = String(params.id);
  const view = searchParams.get('view') === '1' || !can(ROUTE, 'edit');

  const { data: product, loading } = useFetch<Product>(`/products/${id}`);
  const { data: items } = useFetch<Item[]>('/items');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: assets } = useFetch<Asset[]>('/assets');
  const { data: designations } = useFetch<HrDesignation[]>('/hr-designations');
  const { data: lookups } = useFetch<Lookup[]>('/lookups');
  // All products — to pick the source (unpacked) products and read each one's
  // product-master cost price for the packing "Product Cost".
  const { data: allProducts } = useFetch<Product[]>('/products');
  // Categories — to list only packing-material items in the material picker.
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: hsnCodes } = useFetch<HsnCode[]>('/hsn-codes');

  // Production Process lookup values for the process-name combo: find the lookup
  // by code, then fetch its values (mirrors the Asset Brand pattern).
  const [processValues, setProcessValues] = useState<LookupValue[]>([]);
  useEffect(() => {
    const lookup = (lookups ?? []).find(
      (l) => l.code === PRODUCTION_PROCESS_LOOKUP_CODE,
    );
    if (!lookup) {
      setProcessValues([]);
      return;
    }
    let cancelled = false;
    api
      .get<LookupValue[]>(`/lookups/${lookup.id}/values`)
      .then((vals) => {
        if (!cancelled) setProcessValues(vals ?? []);
      })
      .catch(() => {
        if (!cancelled) setProcessValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lookups]);

  const itemList = items ?? [];
  const unitList = units ?? [];
  // Only production-line machines that are currently active can be assigned;
  // any already-referenced machine still resolves for display.
  const machineList = useMemo(
    () => (assets ?? []).filter((a) => a.isProductionLine && a.status === 'ACTIVE'),
    [assets],
  );
  // Manpower comes from the HR Designation master; only active designations can
  // be assigned. Any already-referenced designation still resolves for display.
  const designationList = useMemo(
    () => (designations ?? []).filter((d) => d.isActive),
    [designations],
  );
  // Process step names come from the Production Process lookup; the process
  // stores the chosen name (label) as free text. Active values only.
  const processChoices = processValues
    .filter((v) => v.isActive)
    .map((v) => ({ value: v.label, label: v.label }));

  const itemById = useMemo(() => new Map(itemList.map((i) => [i.id, i])), [itemList]);
  const unitById = useMemo(() => new Map(unitList.map((u) => [u.id, u])), [unitList]);
  // Yield precision follows the product's own unit (from Product Master).
  const yieldDecimals =
    unitById.get(Number(product?.unitId))?.decimalPlaces ?? 2;
  const assetById = useMemo(
    () => new Map((assets ?? []).map((a) => [a.id, a])),
    [assets],
  );
  const designationById = useMemo(
    () => new Map((designations ?? []).map((d) => [d.id, d])),
    [designations],
  );
  const productById = useMemo(
    () => new Map((allProducts ?? []).map((p) => [p.id, p])),
    [allProducts],
  );
  // Source products a pack is made from. Not narrowed by form factor (the old
  // `unpacked` flag): what a product can do is declared by its capabilities, and
  // Has Packing alone decides what Packing Master handles. Any product but the
  // one being packed may be a source.
  const sourceProducts = useMemo(
    () => (allProducts ?? []).filter((p) => String(p.id) !== id),
    [allProducts, id],
  );
  // The material picker lists only items in PACKING_MATERIAL categories. Falls
  // back to all items while no such category exists yet.
  const packingCatIds = useMemo(
    () =>
      new Set(
        (categories ?? [])
          .filter((c) => c.kind === 'PACKING_MATERIAL')
          .map((c) => c.id),
      ),
    [categories],
  );
  const packingItems = useMemo(
    () =>
      packingCatIds.size === 0
        ? itemList
        : itemList.filter(
            (it) => it.categoryId != null && packingCatIds.has(it.categoryId),
          ),
    [itemList, packingCatIds],
  );

  // --- editable state ---
  const [yieldQty, setYieldQty] = useState('1');
  const [packing, setPacking] = useState<Line[]>([]);
  const [processes, setProcesses] = useState<Proc[]>([]);
  const [fuelCost, setFuelCost] = useState('0');
  const [overheadCost, setOverheadCost] = useState('0');
  const [bomMarginPct, setBomMarginPct] = useState('0');
  // The three selling prices per yield unit (per box) and their profit % — both
  // user-entered and kept in sync (enter a price to set its %, or a % to set the
  // price). Saved onto the product, so the Product Master reflects them.
  const [intercompanyPrice, setIntercompanyPrice] = useState('0');
  const [intercompanyPct, setIntercompanyPct] = useState('0');
  const [wholesalePrice, setWholesalePrice] = useState('0');
  const [wholesalePct, setWholesalePct] = useState('0');
  const [retailPrice, setRetailPrice] = useState('0');
  const [retailPct, setRetailPct] = useState('0');
  // Maximum Retail Price — entered against RETAIL only, because it is the one
  // figure printed on the pack label alongside the dates, not a per-customer
  // price. Free of the computed Total Price above it, which is retail + taxes.
  const [mrp, setMrp] = useState('0');
  // Source (unpacked) products this pack is made from, each with a quantity.
  const [packSources, setPackSources] = useState<Src[]>([]);
  const [saving, setSaving] = useState(false);
  // Baseline snapshot of the loaded values, to warn on leaving with edits.
  const baselineRef = useRef('');

  // Overlay data-entry forms. The `*Seq` counters bump after each add so the
  // form remounts and the first field re-focuses, ready for the next entry.
  const [ingForm, setIngForm] = useState<{ index: number | null; draft: Line } | null>(
    null,
  );
  const [procForm, setProcForm] = useState<{ index: number | null; draft: Proc } | null>(
    null,
  );
  // Manpower is entered inline in the process drawer via a small entry line
  // (designation + count) that flows on Enter. `mpEditIndex` is the existing
  // manpower row being edited (null when the entry line adds a new one).
  const [mpDraft, setMpDraft] = useState<ManpowerRow>({ ...BLANK_MANPOWER });
  const [mpEditIndex, setMpEditIndex] = useState<number | null>(null);
  const [ingSeq, setIngSeq] = useState(0);
  const [procSeq, setProcSeq] = useState(0);
  const [srcForm, setSrcForm] = useState<{
    index: number | null;
    draft: Src;
  } | null>(null);
  const [srcSeq, setSrcSeq] = useState(0);
  // The costing breakdown popup, opened from the ⓘ beside a computed cost.
  const [costInfo, setCostInfo] = useState<CostDetail | null>(null);

  // Hydrate once the product loads.
  useEffect(() => {
    if (!product) return;
    setYieldQty(toDecimals(String(product.yieldQty ?? 1), yieldDecimals));
    setPacking(toLines(product.packing ?? []));
    setProcesses(
      (product.processes ?? []).map((p) => ({
        name: p.name,
        timeValue: String(p.timeValue ?? 0),
        timeUnit: p.timeUnit,
        machineId: p.machineId != null ? String(p.machineId) : '',
        manpower: (p.manpower ?? []).map((m) => ({
          designationId: String(m.designationId),
          count: String(m.workerCount ?? 1),
        })),
      })),
    );
    setFuelCost(to2(String(product.fuelCost ?? 0)));
    setOverheadCost(to2(String(product.overheadCost ?? 0)));
    setBomMarginPct(to2(String(product.bomMarginPct ?? 0)));
    setIntercompanyPrice(toPrice(String(product.intercompanyPrice ?? 0)));
    setIntercompanyPct(toPrice(String(product.intercompanyProfitPct ?? 0)));
    setWholesalePrice(toPrice(String(product.wholesalePrice ?? 0)));
    setWholesalePct(toPrice(String(product.wholesaleProfitPct ?? 0)));
    setRetailPrice(toPrice(String(product.retailPrice ?? 0)));
    setRetailPct(toPrice(String(product.retailProfitPct ?? 0)));
    setMrp(toPrice(String(product.mrp ?? 0)));
    setPackSources(
      (product.packSources ?? []).map((s) => ({
        productId: String(s.sourceProductId),
        quantity: String(s.quantity),
      })),
    );
    baselineRef.current = JSON.stringify({
      yieldQty: Number(product.yieldQty ?? 1) || 0,
      fuelCost: Number(product.fuelCost ?? 0) || 0,
      overheadCost: Number(product.overheadCost ?? 0) || 0,
      bomMarginPct: Number(product.bomMarginPct ?? 0) || 0,
      intercompanyPrice: Number(product.intercompanyPrice ?? 0) || 0,
      wholesalePrice: Number(product.wholesalePrice ?? 0) || 0,
      retailPrice: Number(product.retailPrice ?? 0) || 0,
      mrp: Number(product.mrp ?? 0) || 0,
      packSources: (product.packSources ?? []).map((s) => ({
        p: s.sourceProductId,
        q: s.quantity,
      })),
      packing: (product.packing ?? []).map((l) => ({
        i: l.itemId,
        q: l.quantity,
        u: l.unitId,
      })),
      processes: (product.processes ?? []).map((p) => ({
        n: p.name.trim(),
        t: Number(p.timeValue) || 0,
        tu: p.timeUnit,
        m: Number(p.machineId) || 0,
        mp: (p.manpower ?? []).map((m) => ({
          d: m.designationId,
          c: m.workerCount,
        })),
      })),
    });
  }, [product]);

  // Re-format the yield to the unit's decimal places once the Unit master loads
  // (or the yield unit changes), without disturbing the entered value.
  useEffect(() => {
    setYieldQty((v) => toDecimals(v, yieldDecimals));
  }, [yieldDecimals]);

  // --- rate / amount (with unit conversion) ---
  const baseOf = (u?: Unit) => (u ? (u.baseUnitId ?? u.id) : undefined);
  const factorOf = (u?: Unit) => u?.conversionFactor ?? 1;
  // The item's last purchase price is per its stock unit; convert it into the
  // packing line's unit (e.g. 210/KG → 0.21/GM). Fallback: same unit or no shared base.
  const rateOf = (l: Line) => {
    const item = itemById.get(Number(l.itemId));
    if (!item) return 0;
    const price = item.lastPurchasePrice ?? 0;
    const iu = unitById.get(item.unitId);
    const lu = l.unitId ? unitById.get(Number(l.unitId)) : undefined;
    if (!iu || !lu || iu.id === lu.id) return price;
    if (baseOf(iu) !== baseOf(lu)) return price;
    return (price * factorOf(lu)) / factorOf(iu);
  };
  const amountOf = (l: Line) => (Number(l.quantity) || 0) * rateOf(l);
  const materialCost = packing.reduce((s, l) => s + amountOf(l), 0);

  // Units an ingredient may be entered in: every unit in the SAME measurement
  // family as the item's stock unit (e.g. an item stocked in Kg → Tonne, Kg and
  // Gram — never an unrelated family). This guarantees rateOf() has a shared
  // base to convert through. Sorted largest → smallest.
  const unitsForItem = (itemId: string): Unit[] => {
    const item = itemById.get(Number(itemId));
    const u = item ? unitById.get(item.unitId) : undefined;
    if (!u) return [];
    const baseId = baseOf(u);
    return unitList
      .filter((x) => baseOf(x) === baseId)
      .sort((a, b) => factorOf(b) - factorOf(a));
  };

  // Enter in a plain field moves focus to the next field (by element id); the
  // last field points at the Add button, so a final Enter adds the row.
  const enterTo = (nextId: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById(nextId)?.focus();
    }
  };

  // --- costing ---
  const num = (s: string) => Number(s) || 0;
  // Equipment cost: for each process step, the machine's running cost/hour × the
  // step's time in hours (time may be entered in minutes, so normalise to hours).
  const hoursOf = (p: Proc) =>
    p.timeUnit === 'HR' ? num(p.timeValue) : num(p.timeValue) / 60;
  const equipmentCost = processes.reduce(
    (s, p) => s + (assetById.get(Number(p.machineId))?.costPerHour ?? 0) * hoursOf(p),
    0,
  );
  // Manpower cost: for each process step, sum over its manpower rows the
  // designation's rate/hour × the step's time in hours × the worker count.
  const manpowerOf = (p: Proc) =>
    p.manpower.reduce(
      (s, m) =>
        s +
        (designationById.get(Number(m.designationId))?.ratePerHour ?? 0) *
          hoursOf(p) *
          (Number(m.count) || 0),
      0,
    );
  const manpowerCost = processes.reduce((s, p) => s + manpowerOf(p), 0);
  // Product cost: for each source (unpacked) product, its product-master cost
  // price × the quantity consumed per pack, summed across all sources.
  const srcRate = (s: Src) =>
    productById.get(Number(s.productId))?.costPrice ?? 0;
  const srcAmount = (s: Src) => (Number(s.quantity) || 0) * srcRate(s);
  const productCost = packSources.reduce((sum, s) => sum + srcAmount(s), 0);
  const costPrice =
    productCost +
    materialCost +
    equipmentCost +
    manpowerCost +
    num(fuelCost) +
    num(overheadCost);
  const yQty = num(yieldQty) || 1;
  // Cost per yield unit (per box), rounded — the basis for profit and the same
  // across every selling price.
  const estCostPerUnit = costPrice / yQty;
  const actualCostPerUnit = round1(estCostPerUnit);
  // Two-way price/percent binding over the unit cost: profit % of a price, and
  // the price implied by a profit %.
  const profitOf = (price: string) => num(price) - actualCostPerUnit;
  const profitPctOf = (price: string) =>
    actualCostPerUnit ? (profitOf(price) / actualCostPerUnit) * 100 : 0;
  const priceFromPct = (pct: string) => actualCostPerUnit * (1 + num(pct) / 100);
  // GST / Cess rates come from this product's HSN code (set in Product Master).
  // Each tax amount is the rate applied to the entered sales price; the total
  // price adds them on top of it. (Not the MRP — that is the figure printed on
  // the label, entered by hand below, and it need not equal retail + tax.)
  const hsn = (hsnCodes ?? []).find((h) => h.id === product?.hsnCodeId);
  const cgstPct = hsn?.cgst ?? 0;
  const sgstPct = hsn?.sgst ?? 0;
  const cessPct = hsn?.cess ?? 0;
  const taxOf = (price: string, ratePct: number) => (num(price) * ratePct) / 100;
  const totalPriceOf = (price: string) =>
    num(price) + taxOf(price, cgstPct) + taxOf(price, sgstPct) + taxOf(price, cessPct);
  // The three selling-price columns of the "Price per box" table. Editing a price
  // recomputes its %, and editing a % recomputes its price (both over unit cost).
  const priceCols = [
    {
      key: 'ic',
      price: intercompanyPrice,
      setPrice: setIntercompanyPrice,
      pct: intercompanyPct,
      setPct: setIntercompanyPct,
    },
    {
      key: 'ws',
      price: wholesalePrice,
      setPrice: setWholesalePrice,
      pct: wholesalePct,
      setPct: setWholesalePct,
    },
    {
      key: 'rt',
      price: retailPrice,
      setPrice: setRetailPrice,
      pct: retailPct,
      setPct: setRetailPct,
    },
  ];
  const onPriceBlur = (col: (typeof priceCols)[number]) => {
    col.setPrice(toPrice(col.price));
    col.setPct(toPrice(String(profitPctOf(col.price))));
  };
  const onPctBlur = (col: (typeof priceCols)[number]) => {
    col.setPct(toPrice(col.pct));
    col.setPrice(toPrice(String(priceFromPct(col.pct))));
  };

  // --- display resolvers ---
  const itemName = (idStr: string) => itemById.get(Number(idStr))?.name ?? '—';
  const unitCode = (unitId?: number | string | null) => {
    const u = unitById.get(Number(unitId));
    return u?.symbol ?? u?.code ?? '';
  };
  const machineName = (idStr: string) =>
    idStr ? (assetById.get(Number(idStr))?.name ?? `#${idStr}`) : '—';
  const designationName = (idStr: string) =>
    idStr ? (designationById.get(Number(idStr))?.name ?? `#${idStr}`) : '';
  // Short "2 workers · 2 types" style summary for a process's manpower rows.
  const manpowerSummary = (p: Proc) => {
    const rows = p.manpower.filter((m) => m.designationId);
    if (rows.length === 0) return '—';
    const workers = rows.reduce((s, m) => s + (Number(m.count) || 0), 0);
    return rows
      .map(
        (m) =>
          `${designationName(m.designationId)}${
            Number(m.count) > 1 ? ` ×${Number(m.count)}` : ''
          }`,
      )
      .join(', ') || `${workers}`;
  };

  // Total processing time across all steps, normalised to minutes and shown as
  // a human-friendly "Xh Ym" (or "Y min" under an hour).
  const totalProcMinutes = processes.reduce(
    (s, p) => s + (p.timeUnit === 'HR' ? num(p.timeValue) * 60 : num(p.timeValue)),
    0,
  );
  const fmtDuration = (mins: number) => {
    const m = Math.round(mins);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  };

  // Per-process breakdown rows powering the popup behind the ⓘ on the two
  // computed cost fields, so the detail is visible without opening a process
  // for edit.
  const fmtHours = (h: number) => `${Math.round(h * 100) / 100}h`;
  const equipmentBreakdown = processes
    .filter((p) => p.machineId)
    .map((p) => {
      const rate = assetById.get(Number(p.machineId))?.costPerHour ?? 0;
      const hrs = hoursOf(p);
      return {
        label: p.name || 'Process',
        detail: `${machineName(p.machineId)} · ${money(rate)}/hr × ${fmtHours(hrs)}`,
        amount: rate * hrs,
      };
    });
  const manpowerBreakdown = processes.flatMap((p) => {
    const hrs = hoursOf(p);
    return p.manpower
      .filter((m) => m.designationId)
      .map((m) => {
        const rate =
          designationById.get(Number(m.designationId))?.ratePerHour ?? 0;
        const count = Number(m.count) || 0;
        return {
          label: `${p.name || 'Process'} · ${designationName(m.designationId)}`,
          detail: `${money(rate)}/hr × ${fmtHours(hrs)} × ${count}`,
          amount: rate * hrs * count,
        };
      });
  });
  const yieldUnitCode = unitCode(product?.unitId);

  // Removing a row writes through immediately (see autoSave), so unlike an
  // aborted edit there is nothing to walk away from — ask before it goes.
  const confirmRemove = (message: string) =>
    confirm({
      title: 'Remove row',
      message: `${message} It is saved as soon as you confirm.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      danger: true,
      defaultCancel: true,
    });

  // --- ingredient overlay ---
  const openAddIng = () => setIngForm({ index: null, draft: { ...BLANK_LINE } });
  const openEditIng = (i: number) =>
    setIngForm({ index: i, draft: { ...packing[i] } });
  const onPickIngItem = (itemId: string) =>
    setIngForm((f) => {
      if (!f) return f;
      // Default to the item's own stock unit; keep the current pick only if it's
      // still a valid unit for the new item (same family), so switching items
      // never leaves an out-of-family unit selected in the filtered combo.
      const valid = unitsForItem(itemId).map((u) => String(u.id));
      const unitId =
        f.draft.unitId && valid.includes(f.draft.unitId)
          ? f.draft.unitId
          : String(itemById.get(Number(itemId))?.unitId ?? '');
      return { ...f, draft: { ...f.draft, itemId, unitId } };
    });
  const saveIng = () => {
    if (!ingForm) return;
    const d = ingForm.draft;
    if (!d.itemId || !(Number(d.quantity) > 0) || !d.unitId) {
      toast.error('Pick an item, a positive quantity and a unit.');
      return;
    }
    if (ingForm.index == null) {
      // Adding: keep the drawer open with a fresh row so more can be added;
      // the user closes with Cancel when done. The packing is saved right away.
      const rows = [...packing, d];
      setPacking(rows);
      setIngForm({ index: null, draft: { ...BLANK_LINE } });
      setIngSeq((s) => s + 1); // remount → item combo re-opens for the next entry
      void autoSave(
        { packSources, packing: rows, processes },
        `${itemName(d.itemId)} added`,
      );
    } else {
      const rows = packing.map((r, i) => (i === ingForm.index ? d : r));
      setPacking(rows);
      setIngForm(null);
      void autoSave(
        { packSources, packing: rows, processes },
        `${itemName(d.itemId)} updated`,
      );
    }
  };
  const removeIng = async (i: number) => {
    const gone = itemName(packing[i].itemId);
    if (!(await confirmRemove(`Remove ${gone} from this packing?`))) return;
    const rows = packing.filter((_, idx) => idx !== i);
    setPacking(rows);
    void autoSave({ packSources, packing: rows, processes }, `${gone} removed`);
  };

  // --- source-product overlay ---
  const openAddSrc = () => setSrcForm({ index: null, draft: { ...BLANK_SRC } });
  const openEditSrc = (i: number) =>
    setSrcForm({ index: i, draft: { ...packSources[i] } });
  const saveSrc = () => {
    if (!srcForm) return;
    const d = srcForm.draft;
    if (!d.productId || !(Number(d.quantity) > 0)) {
      toast.error('Pick a product and a positive quantity.');
      return;
    }
    const srcName = productById.get(Number(d.productId))?.name ?? 'Source product';
    if (srcForm.index == null) {
      const rows = [...packSources, d];
      setPackSources(rows);
      setSrcForm({ index: null, draft: { ...BLANK_SRC } });
      setSrcSeq((s) => s + 1);
      void autoSave({ packSources: rows, packing, processes }, `${srcName} added`);
    } else {
      const rows = packSources.map((r, i) => (i === srcForm.index ? d : r));
      setPackSources(rows);
      setSrcForm(null);
      void autoSave({ packSources: rows, packing, processes }, `${srcName} updated`);
    }
  };
  const removeSrc = async (i: number) => {
    const gone =
      productById.get(Number(packSources[i].productId))?.name ?? 'Source product';
    if (!(await confirmRemove(`Remove ${gone} as a source product?`))) return;
    const rows = packSources.filter((_, idx) => idx !== i);
    setPackSources(rows);
    void autoSave({ packSources: rows, packing, processes }, `${gone} removed`);
  };

  // --- process overlay ---
  const resetMpEntry = () => {
    setMpDraft({ ...BLANK_MANPOWER });
    setMpEditIndex(null);
  };
  const openAddProc = () => {
    resetMpEntry();
    setProcForm({ index: null, draft: { ...BLANK_PROC } });
  };
  const openEditProc = (i: number) => {
    resetMpEntry();
    setProcForm({ index: i, draft: { ...processes[i] } });
  };
  const saveProc = () => {
    if (!procForm) return;
    const d = procForm.draft;
    if (!d.name.trim()) {
      toast.error('Enter a process name.');
      return;
    }
    const clean = { ...d, name: d.name.trim() };
    if (procForm.index == null) {
      // Adding: keep the drawer open for the next process; Cancel closes it.
      // The packing is saved right away.
      const rows = [...processes, clean];
      setProcesses(rows);
      setProcForm({ index: null, draft: { ...BLANK_PROC } });
      setProcSeq((s) => s + 1); // remount → name field re-focuses for the next entry
      void autoSave({ packSources, packing, processes: rows }, `${clean.name} added`);
    } else {
      const rows = processes.map((r, i) => (i === procForm.index ? clean : r));
      setProcesses(rows);
      setProcForm(null);
      void autoSave(
        { packSources, packing, processes: rows },
        `${clean.name} updated`,
      );
    }
  };
  const removeProc = async (i: number) => {
    const gone = processes[i].name;
    if (!(await confirmRemove(`Remove the ${gone} step from this process flow?`)))
      return;
    const rows = processes.filter((_, idx) => idx !== i);
    setProcesses(rows);
    void autoSave({ packSources, packing, processes: rows }, `${gone} removed`);
  };

  // --- manpower rows within the process draft ---
  const setDraftManpower = (fn: (rows: ManpowerRow[]) => ManpowerRow[]) =>
    setProcForm((f) =>
      f ? { ...f, draft: { ...f.draft, manpower: fn(f.draft.manpower) } } : f,
    );
  // Commit the inline entry line into the process draft (add a new row, or update
  // the one being edited). Returns false when the entry is empty/invalid so the
  // Enter-flow can fall through to the Add button instead.
  const commitManpower = (): boolean => {
    if (!mpDraft.designationId || !(Number(mpDraft.count) > 0)) return false;
    if (mpEditIndex == null) {
      setDraftManpower((rows) => [...rows, mpDraft]);
    } else {
      const at = mpEditIndex;
      setDraftManpower((rows) => rows.map((m, i) => (i === at ? mpDraft : m)));
    }
    resetMpEntry();
    return true;
  };
  const editManpower = (idx: number) => {
    setMpDraft({ ...(procForm?.draft.manpower[idx] ?? BLANK_MANPOWER) });
    setMpEditIndex(idx);
    setTimeout(() => document.getElementById('mp-designation')?.focus(), 0);
  };
  const removeManpower = (idx: number) => {
    setDraftManpower((rows) => rows.filter((_, i) => i !== idx));
    if (mpEditIndex === idx) resetMpEntry();
    else if (mpEditIndex != null && idx < mpEditIndex) setMpEditIndex(mpEditIndex - 1);
  };
  // Rate/hr × step-hours × count for a single draft manpower row.
  const manpowerRowCost = (draft: Proc, m: ManpowerRow) => {
    const hours =
      draft.timeUnit === 'HR' ? num(draft.timeValue) : num(draft.timeValue) / 60;
    return (
      (designationById.get(Number(m.designationId))?.ratePerHour ?? 0) *
      hours *
      (Number(m.count) || 0)
    );
  };

  // Format-independent snapshot of the editable state; compared to the baseline
  // to detect unsaved changes. The rows can be overridden so a just-added line
  // can be snapshotted before React has re-rendered with it (auto-save).
  const snapshot = (
    src: Src[] = packSources,
    pack: Line[] = packing,
    procs: Proc[] = processes,
  ) =>
    JSON.stringify({
      yieldQty: num(yieldQty),
      fuelCost: num(fuelCost),
      overheadCost: num(overheadCost),
      bomMarginPct: num(bomMarginPct),
      intercompanyPrice: num(intercompanyPrice),
      wholesalePrice: num(wholesalePrice),
      retailPrice: num(retailPrice),
      mrp: num(mrp),
      packSources: src.map((s) => ({
        p: Number(s.productId) || 0,
        q: Number(s.quantity) || 0,
      })),
      packing: pack.map((l) => ({
        i: Number(l.itemId) || 0,
        q: Number(l.quantity) || 0,
        u: Number(l.unitId) || 0,
      })),
      processes: procs.map((p) => ({
        n: p.name.trim(),
        t: num(p.timeValue),
        tu: p.timeUnit,
        m: Number(p.machineId) || 0,
        mp: p.manpower.map((m) => ({
          d: Number(m.designationId) || 0,
          c: Number(m.count) || 0,
        })),
      })),
    });

  // Warn before leaving with unsaved edits — the Back button below, and equally
  // the sidebar menu, any other in-app link and a browser refresh.
  const { leave } = useUnsavedChangesGuard(
    () => snapshot() !== baselineRef.current,
  );
  const onBack = () => leave(ROUTE);

  // `rows` overrides the state arrays (auto-save passes the just-added row, which
  // React has not re-rendered yet); `silent` suppresses the success toast so the
  // auto-save can report through the "… added" toast instead. Returns true on save.
  const save = async (
    close: boolean,
    opts?: {
      rows?: { packSources: Src[]; packing: Line[]; processes: Proc[] };
      silent?: boolean;
    },
  ) => {
    if (!product) return false;
    const src = opts?.rows?.packSources ?? packSources;
    const pack = opts?.rows?.packing ?? packing;
    const procs = opts?.rows?.processes ?? processes;
    const payload = {
      yieldQty: num(yieldQty) || 1,
      yieldUnitId: product.unitId,
      packSources: src
        .filter((s) => s.productId && Number(s.quantity) > 0)
        .map((s) => ({
          sourceProductId: Number(s.productId),
          quantity: Number(s.quantity),
        })),
      packing: pack
        .filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitId)
        .map((l) => ({
          itemId: Number(l.itemId),
          quantity: Number(l.quantity),
          unitId: Number(l.unitId),
        })),
      processes: procs
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          timeValue: num(p.timeValue),
          timeUnit: p.timeUnit,
          machineId: p.machineId ? Number(p.machineId) : null,
          manpower: p.manpower
            .filter((m) => m.designationId && Number(m.count) >= 1)
            .map((m) => ({
              designationId: Number(m.designationId),
              workerCount: Number(m.count),
            })),
        })),
      fuelCost: num(fuelCost),
      overheadCost: num(overheadCost),
      bomMarginPct: num(bomMarginPct),
      // Per-unit cost (1 decimal) and the three entered selling prices, each with
      // its profit % over cost. These write straight onto the product, so the
      // Product Master reflects them.
      //
      // costPrice is the product's canonical per-unit cost: it is what the
      // Product Master labels Cost Price, what every profit % there is worked
      // out against, and what this screen itself reads off a source product for
      // "Product Cost (from source)". Packing is what establishes that figure,
      // so it writes it rather than leaving it to be typed in by hand.
      costPrice: actualCostPerUnit,
      actualCostPrice: actualCostPerUnit,
      intercompanyPrice: round1(num(intercompanyPrice)),
      intercompanyProfitPct: round1(profitPctOf(intercompanyPrice)),
      wholesalePrice: round1(num(wholesalePrice)),
      wholesaleProfitPct: round1(profitPctOf(wholesalePrice)),
      retailPrice: round1(num(retailPrice)),
      retailProfitPct: round1(profitPctOf(retailPrice)),
      // The label price. Entered, never derived — it is a decision, not a sum.
      mrp: round1(num(mrp)),
    };
    setSaving(true);
    try {
      await api.patch(`/products/${product.id}`, payload);
      baselineRef.current = snapshot(src, pack, procs);
      if (!opts?.silent) toast.success('Packing saved.');
      if (close) router.push(ROUTE);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save packing.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Every source product / material / process added or edited is persisted
  // straight away, so a row is never lost by leaving the page without pressing
  // Save.
  const autoSave = async (
    rows: { packSources: Src[]; packing: Line[]; processes: Proc[] },
    what: string,
  ) => {
    const ok = await save(false, { rows, silent: true });
    if (ok) toast.success(`${what} · packing saved.`);
  };

  // Keep the latest save closure for the keyboard shortcut (avoids stale state).
  const saveRef = useRef(save);
  saveRef.current = save;

  // Page shortcuts (only when editing and no overlay is open):
  //   Alt+I → add ingredient · Alt+P → add process · Alt+S → save
  useEffect(() => {
    if (view) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || ingForm || procForm) return;
      const k = e.key.toLowerCase();
      if (k === 'i') {
        e.preventDefault();
        setIngForm({ index: null, draft: { ...BLANK_LINE } });
      } else if (k === 'p') {
        e.preventDefault();
        setProcForm({ index: null, draft: { ...BLANK_PROC } });
      } else if (k === 's') {
        e.preventDefault();
        saveRef.current(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, ingForm, procForm]);

  if (loading || !product) {
    return (
      <div className="mx-auto flex h-full max-w-[1400px] flex-col">
        <p className="py-16 text-center text-slate-400">Loading packing…</p>
      </div>
    );
  }

  const timeUnitLabel = (u: ProcessTimeUnit) => (u === 'HR' ? 'Hr' : 'Min');

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col">
      <PageHeader
        title={`${view ? 'Packing' : 'Edit Packing'} — ${product.name}`}
        description={`Product code ${product.code} · packing materials, process flow & costing`}
        icon={<ListTree className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {!view && (
              <>
                <button
                  className="btn-secondary"
                  onClick={() => save(false)}
                  disabled={saving}
                >
                  Save <Kbd>Alt+S</Kbd>
                </button>
                <button
                  className="btn-primary"
                  onClick={() => save(true)}
                  disabled={saving}
                >
                  Save & Close
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {/* Header — identity + yield. Frozen at the top of the scroll area with a
            distinct tan tint + shadow so it stays recognisable while scrolling. */}
        <div className="card sticky top-0 z-20 grid grid-cols-2 gap-4 border-brand-200 bg-brand-50 p-4 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-4">
          <ReadField
            label="Category"
            value={product.category?.name ?? '-'}
            bold
            valueClassName="!text-red-800 dark:!text-red-400"
          />
          <ReadField
            label="Group"
            value={product.group?.name ?? '-'}
            bold
            valueClassName="!text-red-800 dark:!text-red-400"
          />
          <ReadField
            label="Product"
            value={product.name}
            bold
            valueClassName="!text-red-800 dark:!text-red-400"
          />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <ReadOnlyFieldset readOnly={view}>
                <Input
                  label="Yield"
                  type="number"
                  min={0}
                  step="any"
                  value={yieldQty}
                  onChange={(e) => setYieldQty(e.target.value)}
                  onBlur={() => setYieldQty((v) => toDecimals(v, yieldDecimals))}
                  wrapClassName="w-full"
                  className="text-right font-semibold tabular-nums text-red-800 dark:text-red-400"
                />
              </ReadOnlyFieldset>
            </div>
            <span className="pb-2 text-sm font-semibold text-red-800 dark:text-red-400">
              {yieldUnitCode}
            </span>
          </div>
        </div>

        {/* Packed From — the source products this pack is made from. */}
        <div className="card flex flex-col border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader
            title="Packed From (Source Products)"
            onAdd={!view ? openAddSrc : undefined}
            addLabel="Add product"
          />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="w-8 py-2 pr-1 text-center">#</th>
                <th className="py-2 pr-2">Source Product</th>
                <th className="w-24 py-2 px-1 text-right">Qty</th>
                <th className="w-14 py-2 px-1">Unit</th>
                <th className="w-28 py-2 px-1 text-right">Cost Price</th>
                <th className="w-28 py-2 px-1 text-right">Amount</th>
                {!view && <th className="w-16 py-2 pl-1 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {packSources.length === 0 ? (
                <tr>
                  <td
                    colSpan={view ? 6 : 7}
                    className="py-6 text-center text-xs text-slate-400"
                  >
                    No source products yet.
                  </td>
                </tr>
              ) : (
                packSources.map((s, i) => {
                  const sp = productById.get(Number(s.productId));
                  return (
                    <tr
                      key={i}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-2 pr-1 text-center tabular-nums text-slate-500">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {sp?.name ?? '—'}
                      </td>
                      <td className="px-1 text-right tabular-nums">
                        {money(Number(s.quantity) || 0)}
                      </td>
                      <td className="px-1">
                        {sp ? unitCode(sp.unitId) : ''}
                      </td>
                      <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {money(srcRate(s))}
                      </td>
                      <td className="px-1 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                        {money(srcAmount(s))}
                      </td>
                      {!view && (
                        <td className="pl-1">
                          <RowActions
                            onEdit={() => openEditSrc(i)}
                            onDelete={() => void removeSrc(i)}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                <td colSpan={5} className="py-2 text-right text-sm font-semibold">
                  Product Cost
                </td>
                <td className="py-2 px-1 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                  {money(productCost)}
                </td>
                {!view && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Packing materials + Process Flow side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Ingredients */}
          <div className="card flex flex-col border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Packing Materials"
              onAdd={!view ? openAddIng : undefined}
              addLabel="Add material"
              shortcut="Alt+I"
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="w-8 py-2 pr-1 text-center">#</th>
                  <th className="py-2 pr-2">Item</th>
                  <th className="w-16 py-2 px-1 text-right">Qty</th>
                  <th className="w-14 py-2 px-1">Unit</th>
                  <th className="w-20 py-2 px-1 text-right">Rate</th>
                  <th className="w-24 py-2 px-1 text-right">Amount</th>
                  {!view && <th className="w-16 py-2 pl-1 text-center">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {packing.length === 0 ? (
                  <tr>
                    <td
                      colSpan={view ? 6 : 7}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No packing materials yet.
                    </td>
                  </tr>
                ) : (
                  packing.map((line, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-2 pr-1 text-center tabular-nums text-slate-500">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {itemName(line.itemId)}
                      </td>
                      <td className="px-1 text-right tabular-nums">
                        {money(Number(line.quantity) || 0)}
                      </td>
                      <td className="px-1">{unitCode(line.unitId)}</td>
                      <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {money(rateOf(line))}
                      </td>
                      <td className="px-1 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                        {money(amountOf(line))}
                      </td>
                      {!view && (
                        <td className="pl-1">
                          <RowActions
                            onEdit={() => openEditIng(i)}
                            onDelete={() => void removeIng(i)}
                          />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                  <td colSpan={5} className="py-2 text-right text-sm font-semibold">
                    Total Amount
                  </td>
                  <td className="py-2 px-1 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                    {money(materialCost)}
                  </td>
                  {!view && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Process Flow */}
          <div className="card flex flex-col border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Process Flow"
              onAdd={!view ? openAddProc : undefined}
              addLabel="Add process"
              shortcut="Alt+P"
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="w-8 py-2 pr-1 text-center">#</th>
                  <th className="py-2 pr-2">Process</th>
                  <th className="w-24 py-2 px-1">Time</th>
                  <th className="py-2 px-1">Machine</th>
                  <th className="py-2 px-1">Manpower</th>
                  {!view && <th className="w-16 py-2 pl-1 text-center">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {processes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={view ? 5 : 6}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No processes yet.
                    </td>
                  </tr>
                ) : (
                  processes.map((p, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <td className="py-2 pr-1 text-center tabular-nums text-slate-500">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {p.name}
                      </td>
                      <td className="px-1 tabular-nums">
                        {Number(p.timeValue) || 0} {timeUnitLabel(p.timeUnit)}
                      </td>
                      <td className="px-1 text-slate-600 dark:text-slate-300">
                        {machineName(p.machineId)}
                      </td>
                      <td className="px-1 text-slate-600 dark:text-slate-300">
                        {manpowerSummary(p)}
                      </td>
                      {!view && (
                        <td className="pl-1">
                          <RowActions
                            onEdit={() => openEditProc(i)}
                            onDelete={() => void removeProc(i)}
                          />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {processes.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={view ? 5 : 6} className="py-2 px-1">
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-sm font-semibold">
                          Total Processing Time
                        </span>
                        <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                          {fmtDuration(totalProcMinutes)}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
            {machineList.length === 0 && !view && (
              <p className="mt-3 flex items-center gap-1 text-xs text-amber-600">
                <Cog className="h-3.5 w-3.5" /> No production-line machines yet —
                mark assets as “production line” in the Asset module.
              </p>
            )}
          </div>
        </div>

        {/* Costing */}
        <div className="card rounded-3xl border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="-mx-4 -mt-4 mb-4 rounded-t-3xl bg-slate-600 px-4 py-2.5 dark:bg-slate-700">
            <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-white">
              Costing
            </h2>
          </div>
          <ReadOnlyFieldset readOnly={view}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="lg:w-[460px] lg:flex-none">
                <table className="w-full border-collapse border border-slate-300 text-sm dark:border-slate-600">
                  <colgroup>
                    <col />
                    <col className="w-44" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        colSpan={2}
                        className="border border-slate-300 bg-slate-700 px-3 py-2 text-center text-sm font-semibold text-white dark:border-slate-600 dark:bg-slate-800"
                      >
                        Price per {Number(yieldQty) || 1} {yieldUnitCode || 'unit'}
                      </th>
                    </tr>
                    <tr className="bg-slate-100 dark:bg-slate-800/60">
                      <th className="border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Description
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-right font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <CostLabelRow label="Product Cost (from source)">
                      {money(productCost)}
                    </CostLabelRow>
                    <CostLabelRow label="Material Cost (from packing)">
                      {money(materialCost)}
                    </CostLabelRow>
                    <CostLabelRow
                      label="Equipment Cost (from process)"
                      onInfo={() =>
                        setCostInfo({
                          title: 'Equipment cost by process',
                          rows: equipmentBreakdown,
                          total: equipmentCost,
                          empty: 'No machine assigned to any process.',
                        })
                      }
                    >
                      {money(equipmentCost)}
                    </CostLabelRow>
                    <CostLabelRow
                      label="Manpower Cost (from process)"
                      onInfo={() =>
                        setCostInfo({
                          title: 'Manpower cost by process',
                          rows: manpowerBreakdown,
                          total: manpowerCost,
                          empty: 'No manpower added to any process.',
                        })
                      }
                    >
                      {money(manpowerCost)}
                    </CostLabelRow>
                    <CostInputRow label="Fuel Cost">
                      <input
                        className="cell-input no-spinner text-right tabular-nums"
                        type="number"
                        min={0}
                        step="any"
                        value={fuelCost}
                        onChange={(e) => setFuelCost(e.target.value)}
                        onBlur={() => setFuelCost((v) => to2(v))}
                      />
                    </CostInputRow>
                    <CostInputRow label="Overheads">
                      <input
                        className="cell-input no-spinner text-right tabular-nums"
                        type="number"
                        min={0}
                        step="any"
                        value={overheadCost}
                        onChange={(e) => setOverheadCost(e.target.value)}
                        onBlur={() => setOverheadCost((v) => to2(v))}
                      />
                    </CostInputRow>
                    <CostLabelRow label="Cost Price" strong>
                      {money(costPrice)}
                    </CostLabelRow>
                    <CostLabelRow
                      label={`Cost Price / ${yieldUnitCode || 'unit'}`}
                      stronger
                    >
                      {money(estCostPerUnit)}
                    </CostLabelRow>
                  </tbody>
                </table>
              </div>
              <div className="min-w-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse border border-slate-300 text-sm dark:border-slate-600">
                  <colgroup>
                    <col />
                    <col className="w-32" />
                    <col className="w-32" />
                    <col className="w-32" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        colSpan={4}
                        className="border border-slate-300 bg-slate-700 px-3 py-2 text-center text-sm font-semibold text-white dark:border-slate-600 dark:bg-slate-800"
                      >
                        Price per 1 {yieldUnitCode || 'unit'}
                      </th>
                    </tr>
                    <tr className="bg-slate-100 dark:bg-slate-800/60">
                      <th className="border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Description
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-center font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Intercompany
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-center font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Wholesale
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-center font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Retail
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Profit Percentage
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 p-0 dark:border-slate-700"
                        >
                          <input
                            className="cell-input no-spinner text-right tabular-nums"
                            type="number"
                            min={0}
                            step="any"
                            value={c.pct}
                            disabled={view}
                            onChange={(e) => c.setPct(e.target.value)}
                            onBlur={() => onPctBlur(c)}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Sales Price
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 p-0 dark:border-slate-700"
                        >
                          <input
                            className="cell-input no-spinner text-right tabular-nums"
                            type="number"
                            min={0}
                            step="any"
                            value={c.price}
                            disabled={view}
                            onChange={(e) => c.setPrice(e.target.value)}
                            onBlur={() => onPriceBlur(c)}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        CGST ({cgstPct}%)
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100"
                        >
                          {money1(taxOf(c.price, cgstPct))}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        SGST ({sgstPct}%)
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100"
                        >
                          {money1(taxOf(c.price, sgstPct))}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Cess ({cessPct}%)
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100"
                        >
                          {money1(taxOf(c.price, cessPct))}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-slate-100 dark:bg-slate-800/60">
                      <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        Total Price
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-900 dark:border-slate-700 dark:text-white"
                        >
                          {money1(totalPriceOf(c.price))}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        Profit Amount
                      </td>
                      {priceCols.map((c) => (
                        <td
                          key={c.key}
                          className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-900 dark:border-slate-700 dark:text-white"
                        >
                          {money1(profitOf(c.price))}
                        </td>
                      ))}
                    </tr>
                    {/* MRP sits under Retail alone: one figure goes on the pack
                        label, so there is nothing to enter for the other two. */}
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        MRP
                        <span className="ml-1 font-normal text-xs text-slate-400">
                          (printed on the label)
                        </span>
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right text-slate-300 dark:border-slate-700 dark:text-slate-600">
                        —
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right text-slate-300 dark:border-slate-700 dark:text-slate-600">
                        —
                      </td>
                      <td className="border border-slate-200 p-0 dark:border-slate-700">
                        <input
                          className="cell-input no-spinner text-right font-bold tabular-nums"
                          type="number"
                          min={0}
                          step="any"
                          value={mrp}
                          onChange={(e) => setMrp(e.target.value)}
                          onBlur={() => setMrp((v) => toPrice(v))}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </ReadOnlyFieldset>
        </div>
      </div>

      {/* Ingredient data-entry overlay */}
      <Drawer
        open={!!ingForm}
        onClose={() => setIngForm(null)}
        title={ingForm?.index == null ? 'Add Material' : 'Edit Material'}
        subtitle="Item, quantity and unit"
        icon={<ListTree className="h-5 w-5" />}
        width="sm"
        aside={
          <div className="card overflow-hidden border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-slate-700 px-4 py-2.5 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-white">Materials so far</h3>
              <span className="text-xs text-white/70">
                {packing.length} item{packing.length === 1 ? '' : 's'}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="w-6 py-1.5 pr-1 text-center">#</th>
                  <th className="py-1.5 pr-2">Item</th>
                  <th className="w-20 py-1.5 px-1 text-right">Qty</th>
                  <th className="w-24 py-1.5 pl-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {packing.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No materials yet.
                    </td>
                  </tr>
                ) : (
                  packing.map((line, i) => (
                    <tr
                      key={i}
                      className={cn(
                        'border-b border-slate-100 dark:border-slate-800/60',
                        ingForm?.index === i && 'bg-amber-100/60 dark:bg-amber-500/10',
                      )}
                    >
                      <td className="py-1.5 pr-1 text-center tabular-nums text-slate-500">
                        {i + 1}
                      </td>
                      <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {itemName(line.itemId)}
                      </td>
                      <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {money(Number(line.quantity) || 0)} {unitCode(line.unitId)}
                      </td>
                      <td className="px-1 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                        {money(amountOf(line))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {packing.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={3} className="py-1.5 text-right text-sm font-semibold">
                      Total
                    </td>
                    <td className="py-1.5 px-1 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                      {money(materialCost)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setIngForm(null)}>
              Cancel <Kbd>Esc</Kbd>
            </button>
            <button id="ing-add" className="btn-primary" onClick={saveIng}>
              {ingForm?.index == null ? 'Add' : 'Update'} <Kbd>↵</Kbd>
            </button>
          </div>
        }
      >
        {ingForm && (
          <div key={ingSeq} className="space-y-4">
            <Select
              label="Item"
              required
              id="ing-item"
              autoFocus={ingForm.index == null}
              openOnFocus
              advanceToId="ing-qty"
              value={ingForm.draft.itemId}
              onChange={(e) => onPickIngItem(e.target.value)}
              placeholder="Select item"
              searchThreshold={0}
              options={packingItems
                .filter(
                  (it) =>
                    !packing.some((l) => Number(l.itemId) === it.id) ||
                    String(it.id) === ingForm.draft.itemId,
                )
                .map((it) => ({ value: it.id, label: it.name }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantity"
                required
                id="ing-qty"
                type="number"
                min={0}
                step="any"
                value={ingForm.draft.quantity}
                onKeyDown={enterTo('ing-unit')}
                onChange={(e) =>
                  setIngForm((f) =>
                    f ? { ...f, draft: { ...f.draft, quantity: e.target.value } } : f,
                  )
                }
              />
              <Select
                label="Unit"
                required
                id="ing-unit"
                openOnFocus
                advanceToId="ing-add"
                plainSelected
                disabled={!ingForm.draft.itemId}
                value={ingForm.draft.unitId}
                onChange={(e) =>
                  setIngForm((f) =>
                    f ? { ...f, draft: { ...f.draft, unitId: e.target.value } } : f,
                  )
                }
                placeholder={ingForm.draft.itemId ? 'Unit' : 'Pick an item first'}
                options={unitsForItem(ingForm.draft.itemId).map((u) => ({
                  value: u.id,
                  label: u.name,
                }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
              <span className="text-slate-500 dark:text-slate-400">
                Rate {money(rateOf(ingForm.draft))} × {Number(ingForm.draft.quantity) || 0}
              </span>
              <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {money(amountOf(ingForm.draft))}
              </span>
            </div>
            {ingForm.index == null && (
              <p className="text-xs text-slate-400">
                Enter moves to the next field; from the last field it lands on
                Add. Esc closes.
              </p>
            )}
          </div>
        )}
      </Drawer>

      {/* Process data-entry overlay */}
      <Drawer
        open={!!procForm}
        onClose={() => setProcForm(null)}
        title={procForm?.index == null ? 'Add Process' : 'Edit Process'}
        subtitle="Step, machine, time and manpower"
        icon={<Cog className="h-5 w-5" />}
        width="sm"
        aside={
          <div className="card overflow-hidden border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-slate-700 px-4 py-2.5 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-white">Process flow so far</h3>
              <span className="text-xs text-white/70">
                {processes.length} step{processes.length === 1 ? '' : 's'}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="w-6 py-1.5 pr-1 text-center">#</th>
                  <th className="py-1.5 pr-2">Process</th>
                  <th className="w-24 py-1.5 pl-1 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {processes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No processes yet.
                    </td>
                  </tr>
                ) : (
                  processes.map((p, i) => (
                    <tr
                      key={i}
                      className={cn(
                        'border-b border-slate-100 dark:border-slate-800/60',
                        procForm?.index === i && 'bg-amber-100/60 dark:bg-amber-500/10',
                      )}
                    >
                      <td className="py-1.5 pr-1 text-center tabular-nums text-slate-500">
                        {i + 1}
                      </td>
                      <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                        {p.name}
                      </td>
                      <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {Number(p.timeValue) || 0} {timeUnitLabel(p.timeUnit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {processes.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={2} className="py-1.5 text-right text-sm font-semibold">
                      Total time
                    </td>
                    <td className="py-1.5 px-1 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                      {fmtDuration(totalProcMinutes)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setProcForm(null)}>
              Cancel <Kbd>Esc</Kbd>
            </button>
            <button id="proc-add" className="btn-primary" onClick={saveProc}>
              {procForm?.index == null ? 'Add' : 'Update'} <Kbd>↵</Kbd>
            </button>
          </div>
        }
      >
        {procForm && (
          <div key={procSeq} className="space-y-4">
            <Select
              label="Process / step name"
              required
              id="proc-name"
              autoFocus={procForm.index == null}
              openOnFocus
              advanceToId="proc-machine"
              value={procForm.draft.name}
              onChange={(e) =>
                setProcForm((f) =>
                  f ? { ...f, draft: { ...f.draft, name: e.target.value } } : f,
                )
              }
              placeholder="Select a process"
              options={
                procForm.draft.name &&
                !processChoices.some((o) => o.value === procForm.draft.name)
                  ? [
                      ...processChoices,
                      {
                        value: procForm.draft.name,
                        label: `${procForm.draft.name} (not in list)`,
                      },
                    ]
                  : processChoices
              }
            />
            <Select
              label="Machine"
              id="proc-machine"
              openOnFocus
              advanceToId="proc-time"
              value={procForm.draft.machineId}
              onChange={(e) =>
                setProcForm((f) =>
                  f ? { ...f, draft: { ...f.draft, machineId: e.target.value } } : f,
                )
              }
              placeholder="— Select machine —"
              options={machineList.map((m) => ({
                value: m.id,
                label: m.name,
              }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Time"
                id="proc-time"
                type="number"
                min={0}
                step="any"
                value={procForm.draft.timeValue}
                onKeyDown={enterTo('proc-tunit')}
                onChange={(e) =>
                  setProcForm((f) =>
                    f ? { ...f, draft: { ...f.draft, timeValue: e.target.value } } : f,
                  )
                }
              />
              <Select
                label="Unit"
                id="proc-tunit"
                openOnFocus
                advanceToId="mp-designation"
                plainSelected
                value={procForm.draft.timeUnit}
                onChange={(e) =>
                  setProcForm((f) =>
                    f
                      ? {
                          ...f,
                          draft: {
                            ...f.draft,
                            timeUnit: e.target.value as ProcessTimeUnit,
                          },
                        }
                      : f,
                  )
                }
                options={[
                  { value: 'MIN', label: 'Min' },
                  { value: 'HR', label: 'Hr' },
                ]}
              />
            </div>

            {/* Manpower — entered inline via the entry line below (designation +
                count), which flows on Enter: the Unit field lands on the
                designation, then the count, and Enter on the count adds the row
                and returns to the designation for the next worker. Rate/hour is
                read-only (from the HR Designation master); the cost per row =
                rate × step-time × count. */}
            <div className="space-y-2">
              <span className="label !mb-0">Manpower</span>
              {designationList.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:bg-slate-800/50">
                  No designations yet — add them in HR → Designation Master.
                </p>
              ) : (
                <>
                  {procForm.draft.manpower.map((m, idx) => {
                    const rate =
                      designationById.get(Number(m.designationId))?.ratePerHour ?? 0;
                    const name =
                      designationById.get(Number(m.designationId))?.name ?? '—';
                    return (
                      <div
                        key={idx}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700',
                          mpEditIndex === idx &&
                            'border-brand-400 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Rate {money(rate)}/hr × {Number(m.count) || 0}
                          </p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                          {money(manpowerRowCost(procForm.draft, m))}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                          onClick={() => editManpower(idx)}
                          aria-label="Edit manpower"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                          onClick={() => removeManpower(idx)}
                          aria-label="Remove manpower"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}

                  {/* Entry line — flows on Enter and adds/updates a row. */}
                  <div className="flex items-end gap-2 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-600">
                    <div className="flex-1">
                      <Select
                        label="Designation"
                        id="mp-designation"
                        openOnFocus
                        advanceToId="mp-count"
                        value={mpDraft.designationId}
                        onChange={(e) =>
                          setMpDraft((d) => ({ ...d, designationId: e.target.value }))
                        }
                        placeholder="— Select designation —"
                        options={designationList
                          .filter(
                            (d) =>
                              !procForm.draft.manpower.some(
                                (mm, j) =>
                                  j !== mpEditIndex && Number(mm.designationId) === d.id,
                              ),
                          )
                          .map((d) => ({ value: d.id, label: d.name }))}
                      />
                    </div>
                    <div className="w-20">
                      <Input
                        label="Count"
                        id="mp-count"
                        type="number"
                        min={1}
                        step={1}
                        value={mpDraft.count}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (commitManpower()) {
                            setTimeout(
                              () => document.getElementById('mp-designation')?.focus(),
                              0,
                            );
                          } else {
                            document.getElementById('proc-add')?.focus();
                          }
                        }}
                        onChange={(e) =>
                          setMpDraft((d) => ({ ...d, count: e.target.value }))
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary mb-1 whitespace-nowrap text-xs"
                      onClick={() => {
                        if (commitManpower())
                          document.getElementById('mp-designation')?.focus();
                      }}
                    >
                      {mpEditIndex == null ? (
                        <>
                          <Plus className="h-3.5 w-3.5" /> Add
                        </>
                      ) : (
                        'Update'
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
            {procForm.index == null && (
              <p className="text-xs text-slate-400">
                Enter moves to the next field; from the last field it lands on
                Add. Esc closes.
              </p>
            )}
          </div>
        )}
      </Drawer>

      {/* Source-product data-entry overlay */}
      <Drawer
        open={!!srcForm}
        onClose={() => setSrcForm(null)}
        title={srcForm?.index == null ? 'Add Source Product' : 'Edit Source Product'}
        subtitle="Unpacked product and quantity"
        icon={<ListTree className="h-5 w-5" />}
        width="sm"
        aside={
          <div className="card overflow-hidden border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-slate-700 px-4 py-2.5 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-white">Source products so far</h3>
              <span className="text-xs text-white/70">
                {packSources.length} item{packSources.length === 1 ? '' : 's'}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="w-6 py-1.5 pr-1 text-center">#</th>
                  <th className="py-1.5 pr-2">Product</th>
                  <th className="w-20 py-1.5 px-1 text-right">Qty</th>
                  <th className="w-24 py-1.5 pl-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {packSources.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No source products yet.
                    </td>
                  </tr>
                ) : (
                  packSources.map((s, i) => {
                    const sp = productById.get(Number(s.productId));
                    return (
                      <tr
                        key={i}
                        className={cn(
                          'border-b border-slate-100 dark:border-slate-800/60',
                          srcForm?.index === i && 'bg-amber-100/60 dark:bg-amber-500/10',
                        )}
                      >
                        <td className="py-1.5 pr-1 text-center tabular-nums text-slate-500">
                          {i + 1}
                        </td>
                        <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                          {sp?.name ?? '—'}
                        </td>
                        <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {money(Number(s.quantity) || 0)}{' '}
                          {sp ? unitCode(sp.unitId) : ''}
                        </td>
                        <td className="px-1 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                          {money(srcAmount(s))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {packSources.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={3} className="py-1.5 text-right text-sm font-semibold">
                      Total
                    </td>
                    <td className="py-1.5 px-1 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                      {money(productCost)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setSrcForm(null)}>
              Cancel <Kbd>Esc</Kbd>
            </button>
            <button id="src-add" className="btn-primary" onClick={saveSrc}>
              {srcForm?.index == null ? 'Add' : 'Update'} <Kbd>↵</Kbd>
            </button>
          </div>
        }
      >
        {srcForm && (
          <div key={srcSeq} className="space-y-4">
            <Select
              label="Source Product"
              required
              id="src-product"
              autoFocus={srcForm.index == null}
              openOnFocus
              advanceToId="src-qty"
              value={srcForm.draft.productId}
              onChange={(e) =>
                setSrcForm((f) =>
                  f ? { ...f, draft: { ...f.draft, productId: e.target.value } } : f,
                )
              }
              placeholder="Select source product"
              options={sourceProducts
                .filter(
                  (p) =>
                    !packSources.some((s) => Number(s.productId) === p.id) ||
                    String(p.id) === srcForm.draft.productId,
                )
                .map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.code})`,
                }))}
            />
            <Input
              label="Quantity"
              required
              id="src-qty"
              type="number"
              min={0}
              step="any"
              value={srcForm.draft.quantity}
              onKeyDown={enterTo('src-add')}
              onChange={(e) =>
                setSrcForm((f) =>
                  f ? { ...f, draft: { ...f.draft, quantity: e.target.value } } : f,
                )
              }
            />
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
              <span className="text-slate-500 dark:text-slate-400">
                Cost {money(srcRate(srcForm.draft))} ×{' '}
                {Number(srcForm.draft.quantity) || 0}
              </span>
              <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {money(srcAmount(srcForm.draft))}
              </span>
            </div>
          </div>
        )}
      </Drawer>

      {/* Costing breakdown popup (the ⓘ beside a computed cost) */}
      {costInfo && (
        <CostDetailDialog detail={costInfo} onClose={() => setCostInfo(null)} />
      )}
    </div>
  );
}

function SectionHeader({
  title,
  onAdd,
  addLabel,
  shortcut,
}: {
  title: string;
  onAdd?: () => void;
  addLabel: string;
  shortcut?: string;
}) {
  return (
    <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-slate-700 px-4 py-2.5 dark:bg-slate-800">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {onAdd && (
        <button
          className="btn-secondary border-slate-600 bg-slate-600 text-xs text-white hover:bg-slate-600"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" /> {addLabel}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </button>
      )}
    </div>
  );
}

/** A subtle keyboard-shortcut hint next to a button label. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 hidden rounded border border-current px-1 text-[10px] font-normal leading-tight opacity-50 sm:inline">
      {children}
    </span>
  );
}

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        type="button"
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
        onClick={onEdit}
        aria-label="Edit"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
        onClick={onDelete}
        aria-label="Delete"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ReadField({
  label,
  value,
  numeric,
  bold,
  valueClassName,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  bold?: boolean;
  /** Extra classes for the value box (e.g. a custom text colour). */
  valueClassName?: string;
}) {
  return (
    <div>
      <span className="label !mb-0.5 block">{label}</span>
      <div
        className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200 ${
          numeric ? 'text-right tabular-nums' : ''
        } ${bold ? 'font-semibold text-slate-900 dark:text-white' : ''} ${
          valueClassName ?? ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** A costing table row: a label (optionally with a hover breakdown) and a value.
 * `strong` styles it as a subtotal/total (top rule + bold). */
function CostLabelRow({
  label,
  onInfo,
  strong,
  stronger,
  children,
}: {
  label: string;
  /** Given for a computed cost: shows an ⓘ that opens the breakdown popup. */
  onInfo?: () => void;
  strong?: boolean;
  /** A deeper fill than `strong`, to make a headline total (e.g. Gross Profit)
   * stand out from the subtotal rows. Implies `strong`. */
  stronger?: boolean;
  children: React.ReactNode;
}) {
  strong = strong || stronger;
  return (
    <tr
      className={
        stronger
          ? 'bg-slate-200 dark:bg-slate-700/70'
          : strong
            ? 'bg-slate-100 dark:bg-slate-800/60'
            : ''
      }
    >
      <td
        className={`border border-slate-200 px-3 py-2 dark:border-slate-700 ${
          strong
            ? 'font-semibold text-slate-800 dark:text-slate-100'
            : 'text-slate-600 dark:text-slate-300'
        }`}
      >
        {onInfo ? (
          <span className="inline-flex items-center gap-1.5">
            <span>{label}</span>
            {/* A span rather than a button: this table sits inside the
                ReadOnlyFieldset, which disables every control in it in view
                mode — and the breakdown is worth reading there too. */}
            <span
              role="button"
              tabIndex={0}
              title="Show the breakdown"
              aria-label={`${label} — show the breakdown`}
              onClick={onInfo}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onInfo();
                }
              }}
              className="cursor-pointer rounded-full p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </span>
        ) : (
          label
        )}
      </td>
      <td
        className={`border border-slate-200 px-3 py-2 text-right tabular-nums dark:border-slate-700 ${
          strong
            ? 'font-bold text-slate-900 dark:text-white'
            : 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {children}
      </td>
    </tr>
  );
}

/** A costing table row whose value cell holds an editable input. */
function CostInputRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
        {label}
      </td>
      <td className="border border-slate-200 p-0 dark:border-slate-700">
        {children}
      </td>
    </tr>
  );
}

/** The "process → amount" table shown in the cost breakdown popup. */
function CostBreakdown({ rows, total, empty }: Omit<CostDetail, 'title'>) {
  if (rows.length === 0) {
    return <p className="py-2 text-center text-slate-400">{empty}</p>;
  }
  return (
    <div className="min-w-[15rem] text-sm">
      <table className="w-full">
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="align-top border-b border-slate-100 dark:border-slate-800/60"
            >
              <td className="py-1.5 pr-4">
                <div className="text-slate-700 dark:text-slate-200">{r.label}</div>
                <div className="text-xs text-slate-400">{r.detail}</div>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {money(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 dark:border-slate-700">
            <td className="pt-2 font-semibold text-slate-700 dark:text-slate-200">
              Total
            </td>
            <td className="pt-2 text-right font-bold tabular-nums text-slate-900 dark:text-white">
              {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * The cost breakdown as its own popup, opened from the ⓘ beside a computed
 * cost. It replaced a hover tooltip, which on a long process flow ran off the
 * bottom of the page and could not be read.
 */
function CostDetailDialog({
  detail,
  onClose,
}: {
  detail: CostDetail;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <Info className="h-5 w-5 flex-none text-brand-600" />
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 dark:text-white">
            {detail.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <CostBreakdown
            rows={detail.rows}
            total={detail.total}
            empty={detail.empty}
          />
        </div>
        <div className="flex justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close <Kbd>Esc</Kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

