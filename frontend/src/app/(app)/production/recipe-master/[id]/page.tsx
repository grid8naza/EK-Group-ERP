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
  Printer,
} from 'lucide-react';
import { printRecipe } from '@/lib/recipePrint';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Field';
import type {
  Product,
  Item,
  Category,
  Unit,
  Asset,
  HrDesignation,
  ProcessTimeUnit,
  Lookup,
  LookupValue,
} from '@/lib/types';

const ROUTE = '/production/recipe-master';

// Lookup code the Process combo reads (kept in sync with the backend
// PRODUCTION_PROCESS_LOOKUP_CODE). Values are managed in Production → Lookups.
const PRODUCTION_PROCESS_LOOKUP_CODE = 'PRODUCTION_PROCESS';

type Line = { itemId: string; quantity: string; unitId: string };
type ManpowerRow = { designationId: string; count: string };
type Proc = {
  name: string;
  timeValue: string;
  timeUnit: ProcessTimeUnit;
  machineId: string;
  manpower: ManpowerRow[];
};

const toLines = (rows: Product['recipe']): Line[] =>
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
const BLANK_MANPOWER: ManpowerRow = { designationId: '', count: '1' };
const BLANK_PROC: Proc = {
  name: '',
  timeValue: '0',
  timeUnit: 'MIN',
  machineId: '',
  manpower: [],
};

export default function RecipeMasterEditorPage() {
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
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: assets } = useFetch<Asset[]>('/assets');
  const { data: designations } = useFetch<HrDesignation[]>('/hr-designations');
  const { data: lookups } = useFetch<Lookup[]>('/lookups');

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
  // Recipe ingredients are raw materials only — exclude items in packing-material
  // categories (those flagged forPacking), which belong to the Packing master.
  const packingCatIds = useMemo(
    () => new Set((categories ?? []).filter((c) => c.forPacking).map((c) => c.id)),
    [categories],
  );
  const rawMaterialItems = useMemo(
    () =>
      itemList.filter(
        (it) => it.categoryId == null || !packingCatIds.has(it.categoryId),
      ),
    [itemList, packingCatIds],
  );
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
  // Yield precision follows the yield unit's decimal places (Unit master). The
  // yield unit is the box unit when set, else the product's stock unit.
  const yieldDecimals =
    unitById.get(Number(product?.boxUnitId ?? product?.unitId))?.decimalPlaces ??
    2;
  const assetById = useMemo(
    () => new Map((assets ?? []).map((a) => [a.id, a])),
    [assets],
  );
  const designationById = useMemo(
    () => new Map((designations ?? []).map((d) => [d.id, d])),
    [designations],
  );

  // --- editable state ---
  const [yieldQty, setYieldQty] = useState('1');
  const [recipe, setRecipe] = useState<Line[]>([]);
  const [processes, setProcesses] = useState<Proc[]>([]);
  const [fuelCost, setFuelCost] = useState('0');
  const [overheadCost, setOverheadCost] = useState('0');
  const [bomMarginPct, setBomMarginPct] = useState('0');
  // Actual sales price per yield unit — user-entered (feeds the sales invoice).
  const [actualSalesPrice, setActualSalesPrice] = useState('0');
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

  // Hydrate once the product loads.
  useEffect(() => {
    if (!product) return;
    setYieldQty(toDecimals(String(product.yieldQty ?? 1), yieldDecimals));
    setRecipe(toLines(product.recipe ?? []));
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
    setActualSalesPrice(toPrice(String(product.actualSalesPrice ?? 0)));
    baselineRef.current = JSON.stringify({
      yieldQty: Number(product.yieldQty ?? 1) || 0,
      fuelCost: Number(product.fuelCost ?? 0) || 0,
      overheadCost: Number(product.overheadCost ?? 0) || 0,
      bomMarginPct: Number(product.bomMarginPct ?? 0) || 0,
      actualSalesPrice: Number(product.actualSalesPrice ?? 0) || 0,
      recipe: (product.recipe ?? []).map((l) => ({
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
  // recipe line's unit (e.g. 210/KG → 0.21/GM). Fallback: same unit or no shared base.
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
  const materialCost = recipe.reduce((s, l) => s + amountOf(l), 0);

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
  const costPrice =
    materialCost +
    equipmentCost +
    manpowerCost +
    num(fuelCost) +
    num(overheadCost);
  const salesPrice = costPrice * (1 + num(bomMarginPct) / 100);
  const grossProfit = salesPrice - costPrice;
  const yQty = num(yieldQty) || 1;
  // --- price per yield unit: Estimated vs Actual (all rounded to 1 decimal) ---
  const estCostPerUnit = costPrice / yQty;
  const estSalesPerUnit = salesPrice / yQty;
  const estProfitPerUnit = estSalesPerUnit - estCostPerUnit;
  // Actual cost/unit is populated from the estimated cost/unit (used in Packing).
  const actualCostPerUnit = round1(estCostPerUnit);
  // Actual profit = actual (entered) sales price − actual cost price.
  const actualProfitPerUnit = num(actualSalesPrice) - actualCostPerUnit;
  // Profit % = profit ÷ cost × 100 (estimated equals the applied margin).
  const estProfitPct = estCostPerUnit ? (estProfitPerUnit / estCostPerUnit) * 100 : 0;
  const actualProfitPct = actualCostPerUnit
    ? (actualProfitPerUnit / actualCostPerUnit) * 100
    : 0;

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

  // Per-process breakdown rows powering the hover tooltips on the two computed
  // cost fields, so the detail is visible without opening a process for edit.
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
  const yieldUnitCode = unitCode(product?.boxUnitId ?? product?.unitId);

  // --- ingredient overlay ---
  const openAddIng = () => setIngForm({ index: null, draft: { ...BLANK_LINE } });
  const openEditIng = (i: number) =>
    setIngForm({ index: i, draft: { ...recipe[i] } });
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
      // the user closes with Cancel when done.
      setRecipe((rows) => [...rows, d]);
      toast.success(`${itemName(d.itemId)} added.`);
      setIngForm({ index: null, draft: { ...BLANK_LINE } });
      setIngSeq((s) => s + 1); // remount → item combo re-opens for the next entry
    } else {
      setRecipe((rows) => rows.map((r, i) => (i === ingForm.index ? d : r)));
      setIngForm(null);
    }
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
      setProcesses((rows) => [...rows, clean]);
      toast.success(`${clean.name} added.`);
      setProcForm({ index: null, draft: { ...BLANK_PROC } });
      setProcSeq((s) => s + 1); // remount → name field re-focuses for the next entry
    } else {
      setProcesses((rows) => rows.map((r, i) => (i === procForm.index ? clean : r)));
      setProcForm(null);
    }
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
  // to detect unsaved changes.
  const snapshot = () =>
    JSON.stringify({
      yieldQty: num(yieldQty),
      fuelCost: num(fuelCost),
      overheadCost: num(overheadCost),
      bomMarginPct: num(bomMarginPct),
      actualSalesPrice: num(actualSalesPrice),
      recipe: recipe.map((l) => ({
        i: Number(l.itemId) || 0,
        q: Number(l.quantity) || 0,
        u: Number(l.unitId) || 0,
      })),
      processes: processes.map((p) => ({
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

  // Warn before leaving with unsaved edits (the Back button).
  const onBack = async () => {
    if (snapshot() !== baselineRef.current) {
      const ok = await confirm({
        title: 'Unsaved changes',
        message:
          'There are unsaved changes. If you leave this page, they will be lost. Continue?',
        danger: true,
        confirmText: 'Yes',
        cancelText: 'No',
        defaultCancel: true,
      });
      if (!ok) return;
    }
    router.push(ROUTE);
  };

  const save = async (close: boolean) => {
    if (!product) return;
    const payload = {
      yieldQty: num(yieldQty) || 1,
      yieldUnitId: product.boxUnitId ?? product.unitId,
      recipe: recipe
        .filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitId)
        .map((l) => ({
          itemId: Number(l.itemId),
          quantity: Number(l.quantity),
          unitId: Number(l.unitId),
        })),
      processes: processes
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
      // Per-unit actual prices (1 decimal). Cost is the estimated cost/unit;
      // sales is the user-entered value.
      actualCostPrice: actualCostPerUnit,
      actualSalesPrice: round1(num(actualSalesPrice)),
    };
    setSaving(true);
    try {
      await api.patch(`/products/${product.id}`, payload);
      baselineRef.current = snapshot();
      toast.success('Recipe saved.');
      if (close) router.push(ROUTE);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save recipe.');
    } finally {
      setSaving(false);
    }
  };

  // Print the recipe from the CURRENT on-screen state (so unsaved edits show).
  const doPrint = () => {
    if (!product) return;
    printRecipe(
      {
        code: product.code,
        name: product.name,
        category: product.category ?? null,
        group: product.group ?? null,
        yieldQty: num(yieldQty) || 1,
        unitId: product.unitId,
        boxUnitId: product.boxUnitId,
        recipe: recipe
          .filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitId)
          .map((l) => ({
            itemId: Number(l.itemId),
            quantity: Number(l.quantity),
            unitId: Number(l.unitId),
          })),
        processes: processes
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
        actualSalesPrice: round1(num(actualSalesPrice)),
      },
      {
        items: items ?? [],
        units: units ?? [],
        assets: assets ?? [],
        designations: designations ?? [],
      },
    );
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
        <p className="py-16 text-center text-slate-400">Loading recipe…</p>
      </div>
    );
  }

  const timeUnitLabel = (u: ProcessTimeUnit) => (u === 'HR' ? 'Hr' : 'Min');

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col">
      <PageHeader
        title={`${view ? 'Recipe' : 'Edit Recipe'} — ${product.name}`}
        description={`Product code ${product.code} · ingredients, process flow & costing`}
        icon={<ListTree className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button className="btn-secondary" onClick={doPrint}>
              <Printer className="h-4 w-4" /> Print
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
        <div className="card sticky top-0 z-20 grid grid-cols-2 gap-4 border-[#d8c6a3] bg-[#f3e8d3] p-4 shadow-md dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-4">
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

        {/* Ingredients + Process Flow side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Ingredients */}
          <div className="card flex flex-col border-[#e7ddcb] bg-[#fbf9f4] p-4 dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Ingredients"
              onAdd={!view ? openAddIng : undefined}
              addLabel="Add item"
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
                {recipe.length === 0 ? (
                  <tr>
                    <td
                      colSpan={view ? 6 : 7}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No ingredients yet.
                    </td>
                  </tr>
                ) : (
                  recipe.map((line, i) => (
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
                            onDelete={() =>
                              setRecipe(recipe.filter((_, idx) => idx !== i))
                            }
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
          <div className="card flex flex-col border-[#e7ddcb] bg-[#fbf9f4] p-4 dark:border-slate-800 dark:bg-slate-900">
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
                            onDelete={() =>
                              setProcesses(processes.filter((_, idx) => idx !== i))
                            }
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
        <div className="card rounded-3xl border-[#e7ddcb] bg-[#fbf9f4] p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="-mx-4 -mt-4 mb-4 rounded-t-3xl bg-[#8a7d6c] px-4 py-2.5 dark:bg-slate-700">
            <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-white">
              Costing
            </h2>
          </div>
          <ReadOnlyFieldset readOnly={view}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <table className="w-full border-collapse border border-slate-300 text-sm dark:border-slate-600">
                  <colgroup>
                    <col />
                    <col className="w-44" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        colSpan={2}
                        className="border border-slate-300 bg-[#5b544c] px-3 py-2 text-center text-sm font-semibold text-white dark:border-slate-600 dark:bg-slate-800"
                      >
                        Price per {Number(yieldQty) || 1} {yieldUnitCode || 'unit'}
                      </th>
                    </tr>
                    <tr className="bg-[#f3ece0] dark:bg-slate-800/60">
                      <th className="border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Description
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-right font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <CostLabelRow label="Material Cost (from recipe)">
                      {money(materialCost)}
                    </CostLabelRow>
                    <CostLabelRow
                      label="Equipment Cost (from process)"
                      tip={
                        <CostBreakdown
                          title="Equipment cost by process"
                          rows={equipmentBreakdown}
                          total={equipmentCost}
                          empty="No machine assigned to any process."
                        />
                      }
                    >
                      {money(equipmentCost)}
                    </CostLabelRow>
                    <CostLabelRow
                      label="Manpower Cost (from process)"
                      tip={
                        <CostBreakdown
                          title="Manpower cost by process"
                          rows={manpowerBreakdown}
                          total={manpowerCost}
                          empty="No manpower added to any process."
                        />
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
                    <CostInputRow label="Profit Margin %">
                      <input
                        className="cell-input no-spinner text-right tabular-nums"
                        type="number"
                        step="any"
                        value={bomMarginPct}
                        onChange={(e) => setBomMarginPct(e.target.value)}
                        onBlur={() => setBomMarginPct((v) => to2(v))}
                      />
                    </CostInputRow>
                    <CostLabelRow label="Sales Price" strong>
                      {money(salesPrice)}
                    </CostLabelRow>
                    <CostLabelRow label="Gross Profit" stronger>
                      {money(grossProfit)}
                    </CostLabelRow>
                  </tbody>
                </table>
              </div>
              <div className="self-start">
                <table className="w-full border-collapse border border-slate-300 text-sm dark:border-slate-600">
                  <colgroup>
                    <col />
                    <col className="w-28" />
                    <col className="w-28" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        colSpan={3}
                        className="border border-slate-300 bg-[#5b544c] px-3 py-2 text-center text-sm font-semibold text-white dark:border-slate-600 dark:bg-slate-800"
                      >
                        Price per 1 {yieldUnitCode || 'unit'}
                      </th>
                    </tr>
                    <tr className="bg-[#f3ece0] dark:bg-slate-800/60">
                      <th className="border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Description
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-center font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Estimated
                      </th>
                      <th className="border border-slate-200 px-3 py-1.5 text-center font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100">
                        Actual
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Sales Price
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        {money1(estSalesPerUnit)}
                      </td>
                      <td className="border border-slate-200 p-0 dark:border-slate-700">
                        <input
                          className="cell-input no-spinner text-right tabular-nums"
                          type="number"
                          min={0}
                          step="any"
                          value={actualSalesPrice}
                          onChange={(e) => setActualSalesPrice(e.target.value)}
                          onBlur={() => setActualSalesPrice((v) => toPrice(v))}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Cost Price
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        {money1(estCostPerUnit)}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        {money1(actualCostPerUnit)}
                      </td>
                    </tr>
                    <tr className="bg-[#f3ece0] dark:bg-slate-800/60">
                      <td className="border border-slate-200 px-3 py-2 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        Profit
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-900 dark:border-slate-700 dark:text-white">
                        {money1(estProfitPerUnit)}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-900 dark:border-slate-700 dark:text-white">
                        {money1(actualProfitPerUnit)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Profit Percentage
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        {money1(estProfitPct)}%
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right tabular-nums text-slate-800 dark:border-slate-700 dark:text-slate-100">
                        {money1(actualProfitPct)}%
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
        title={ingForm?.index == null ? 'Add Ingredient' : 'Edit Ingredient'}
        subtitle="Item, quantity and unit"
        icon={<ListTree className="h-5 w-5" />}
        width="sm"
        aside={
          <div className="card overflow-hidden border-[#e7ddcb] bg-[#fbf9f4] p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-[#5b544c] px-4 py-2.5 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-white">Ingredients so far</h3>
              <span className="text-xs text-white/70">
                {recipe.length} item{recipe.length === 1 ? '' : 's'}
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
                {recipe.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      No ingredients yet.
                    </td>
                  </tr>
                ) : (
                  recipe.map((line, i) => (
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
              {recipe.length > 0 && (
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
              options={rawMaterialItems
                .filter(
                  (it) =>
                    !recipe.some((l) => Number(l.itemId) === it.id) ||
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
          <div className="card overflow-hidden border-[#e7ddcb] bg-[#fbf9f4] p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-[#5b544c] px-4 py-2.5 dark:bg-slate-800">
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
    <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-[#5b544c] px-4 py-2.5 dark:bg-slate-800">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {onAdd && (
        <button
          className="btn-secondary border-[#8a7d6c] bg-[#8a7d6c] text-xs text-white hover:bg-[#7c6f5e]"
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
  tooltip,
  valueClassName,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  bold?: boolean;
  /** Optional hover popover (e.g. a cost breakdown) shown below the field. */
  tooltip?: React.ReactNode;
  /** Extra classes for the value box (e.g. a custom text colour). */
  valueClassName?: string;
}) {
  return (
    <div className="group relative">
      <span className="label !mb-0.5 block">{label}</span>
      <div
        className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200 ${
          numeric ? 'text-right tabular-nums' : ''
        } ${bold ? 'font-semibold text-slate-900 dark:text-white' : ''} ${
          tooltip ? 'cursor-help' : ''
        } ${valueClassName ?? ''}`}
      >
        {value}
      </div>
      {tooltip && (
        <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-max max-w-md rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl group-hover:block dark:border-slate-700 dark:bg-slate-800">
          {tooltip}
        </div>
      )}
    </div>
  );
}

/** A costing table row: a label (optionally with a hover breakdown) and a value.
 * `strong` styles it as a subtotal/total (top rule + bold). */
function CostLabelRow({
  label,
  tip,
  strong,
  stronger,
  children,
}: {
  label: string;
  tip?: React.ReactNode;
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
          ? 'bg-[#e2d0ad] dark:bg-slate-700/70'
          : strong
            ? 'bg-[#f3ece0] dark:bg-slate-800/60'
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
        {tip ? (
          <div className="group relative inline-flex cursor-help items-center gap-1">
            <span>{label}</span>
            <Info className="h-3.5 w-3.5 text-slate-400" />
            <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-max max-w-md rounded-lg border border-slate-200 bg-white p-3 text-left font-normal shadow-xl group-hover:block dark:border-slate-700 dark:bg-slate-800">
              {tip}
            </div>
          </div>
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

/** A small "process → amount" table used inside a ReadField hover tooltip. */
function CostBreakdown({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: { label: string; detail: string; amount: number }[];
  total: number;
  empty: string;
}) {
  if (rows.length === 0) {
    return <span className="text-slate-400">{empty}</span>;
  }
  return (
    <div className="min-w-[15rem]">
      <div className="mb-1.5 font-semibold text-slate-700 dark:text-slate-200">
        {title}
      </div>
      <table className="w-full">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="py-0.5 pr-4">
                <div className="text-slate-700 dark:text-slate-200">{r.label}</div>
                <div className="text-slate-400">{r.detail}</div>
              </td>
              <td className="whitespace-nowrap py-0.5 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {money(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 dark:border-slate-700">
            <td className="pt-1 font-semibold text-slate-700 dark:text-slate-200">
              Total
            </td>
            <td className="pt-1 text-right font-bold tabular-nums text-slate-900 dark:text-white">
              {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

