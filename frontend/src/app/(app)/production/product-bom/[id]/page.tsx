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
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Field';
import type {
  Product,
  Item,
  Unit,
  Asset,
  ProcessTimeUnit,
} from '@/lib/types';

const ROUTE = '/production/product-bom';

type Line = { itemId: string; quantity: string; unitId: string };
type Proc = {
  name: string;
  timeValue: string;
  timeUnit: ProcessTimeUnit;
  machineId: string;
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

const BLANK_LINE: Line = { itemId: '', quantity: '', unitId: '' };
const BLANK_PROC: Proc = {
  name: '',
  timeValue: '0',
  timeUnit: 'MIN',
  machineId: '',
};

export default function ProductBomEditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();

  const id = String(params.id);
  const view = searchParams.get('view') === '1' || !can(ROUTE, 'edit');

  const { data: product, loading } = useFetch<Product>(`/products/${id}`);
  const { data: items } = useFetch<Item[]>('/items');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: assets } = useFetch<Asset[]>('/assets');

  const itemList = items ?? [];
  const unitList = units ?? [];
  // Only production-line machines that are currently active can be assigned;
  // any already-referenced machine still resolves for display.
  const machineList = useMemo(
    () => (assets ?? []).filter((a) => a.isProductionLine && a.status === 'ACTIVE'),
    [assets],
  );
  const itemById = useMemo(() => new Map(itemList.map((i) => [i.id, i])), [itemList]);
  const unitById = useMemo(() => new Map(unitList.map((u) => [u.id, u])), [unitList]);
  const assetById = useMemo(
    () => new Map((assets ?? []).map((a) => [a.id, a])),
    [assets],
  );

  // --- editable state ---
  const [yieldQty, setYieldQty] = useState('1');
  const [recipe, setRecipe] = useState<Line[]>([]);
  const [processes, setProcesses] = useState<Proc[]>([]);
  const [labourCost, setLabourCost] = useState('0');
  const [fuelCost, setFuelCost] = useState('0');
  const [overheadCost, setOverheadCost] = useState('0');
  const [bomMarginPct, setBomMarginPct] = useState('0');
  const [saving, setSaving] = useState(false);

  // Overlay data-entry forms. The `*Seq` counters bump after each add so the
  // form remounts and the first field re-focuses, ready for the next entry.
  const [ingForm, setIngForm] = useState<{ index: number | null; draft: Line } | null>(
    null,
  );
  const [procForm, setProcForm] = useState<{ index: number | null; draft: Proc } | null>(
    null,
  );
  const [ingSeq, setIngSeq] = useState(0);
  const [procSeq, setProcSeq] = useState(0);

  // Hydrate once the product loads.
  useEffect(() => {
    if (!product) return;
    setYieldQty(String(product.yieldQty ?? 1));
    setRecipe(toLines(product.recipe ?? []));
    setProcesses(
      (product.processes ?? []).map((p) => ({
        name: p.name,
        timeValue: String(p.timeValue ?? 0),
        timeUnit: p.timeUnit,
        machineId: p.machineId != null ? String(p.machineId) : '',
      })),
    );
    setLabourCost(String(product.labourCost ?? 0));
    setFuelCost(String(product.fuelCost ?? 0));
    setOverheadCost(String(product.overheadCost ?? 0));
    setBomMarginPct(String(product.bomMarginPct ?? 0));
  }, [product]);

  // --- rate / amount (with unit conversion) ---
  const baseOf = (u?: Unit) => (u ? (u.baseUnitId ?? u.id) : undefined);
  const factorOf = (u?: Unit) => u?.conversionFactor ?? 1;
  // The item's last purchase price is per its stock unit; convert it into the
  // BOM line's unit (e.g. 210/KG → 0.21/GM). Fallback: same unit or no shared base.
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

  // --- costing ---
  const num = (s: string) => Number(s) || 0;
  const costPrice =
    materialCost + num(labourCost) + num(fuelCost) + num(overheadCost);
  const salesPrice = costPrice * (1 + num(bomMarginPct) / 100);
  const grossProfit = salesPrice - costPrice;
  const yQty = num(yieldQty) || 1;
  const estCostPerUnit = costPrice / yQty;
  const estSalesPerUnit = salesPrice / yQty;

  // --- display resolvers ---
  const itemName = (idStr: string) => itemById.get(Number(idStr))?.name ?? '—';
  const unitCode = (unitId?: number | string | null) =>
    unitById.get(Number(unitId))?.code ?? '';
  const machineName = (idStr: string) =>
    idStr ? (assetById.get(Number(idStr))?.name ?? `#${idStr}`) : '—';
  const yieldUnitCode = unitCode(product?.boxUnitId ?? product?.unitId);

  // --- ingredient overlay ---
  const openAddIng = () => setIngForm({ index: null, draft: { ...BLANK_LINE } });
  const openEditIng = (i: number) =>
    setIngForm({ index: i, draft: { ...recipe[i] } });
  const onPickIngItem = (itemId: string) =>
    setIngForm((f) =>
      f
        ? {
            ...f,
            draft: {
              ...f.draft,
              itemId,
              unitId:
                f.draft.unitId ||
                String(itemById.get(Number(itemId))?.unitId ?? ''),
            },
          }
        : f,
    );
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
  const openAddProc = () => setProcForm({ index: null, draft: { ...BLANK_PROC } });
  const openEditProc = (i: number) =>
    setProcForm({ index: i, draft: { ...processes[i] } });
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
        })),
      labourCost: num(labourCost),
      fuelCost: num(fuelCost),
      overheadCost: num(overheadCost),
      bomMarginPct: num(bomMarginPct),
    };
    setSaving(true);
    try {
      await api.patch(`/products/${product.id}`, payload);
      toast.success('BOM saved.');
      if (close) router.push(ROUTE);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save BOM.');
    } finally {
      setSaving(false);
    }
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
        <p className="py-16 text-center text-slate-400">Loading BOM…</p>
      </div>
    );
  }

  const timeUnitLabel = (u: ProcessTimeUnit) => (u === 'HR' ? 'Hr' : 'Min');

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col">
      <PageHeader
        title={`${view ? 'BOM' : 'Edit BOM'} — ${product.name}`}
        description={`Product code ${product.code} · ingredients, process flow & costing`}
        icon={<ListTree className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => router.push(ROUTE)}>
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
        {/* Header — identity + yield */}
        <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <ReadField label="Category" value={product.category?.name ?? '-'} />
          <ReadField label="Group" value={product.group?.name ?? '-'} />
          <ReadField label="Product" value={product.name} />
          <div className="flex items-end gap-2">
            <ReadOnlyFieldset readOnly={view}>
              <Input
                label="Yield"
                type="number"
                min={0}
                step="any"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
                wrapClassName="flex-1"
              />
            </ReadOnlyFieldset>
            <span className="pb-2 text-sm text-slate-500 dark:text-slate-400">
              {yieldUnitCode}
            </span>
          </div>
        </div>

        {/* Ingredients + Process Flow side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Ingredients */}
          <div className="card flex flex-col p-4">
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
                        {Number(line.quantity) || 0}
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
          <div className="card flex flex-col p-4">
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
                  {!view && <th className="w-16 py-2 pl-1 text-center">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {processes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={view ? 4 : 5}
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
        <div className="card p-4">
          <div className="-mx-4 -mt-4 mb-4 rounded-t-2xl bg-[#5b544c] px-4 py-2.5 dark:bg-slate-800">
            <h2 className="text-sm font-semibold text-white">Costing</h2>
          </div>
          <ReadOnlyFieldset readOnly={view}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <ReadField label="Material Cost (from BOM)" value={money(materialCost)} numeric />
                <Input
                  label="Labour Cost"
                  type="number"
                  min={0}
                  step="any"
                  value={labourCost}
                  onChange={(e) => setLabourCost(e.target.value)}
                />
                <Input
                  label="Fuel Cost"
                  type="number"
                  min={0}
                  step="any"
                  value={fuelCost}
                  onChange={(e) => setFuelCost(e.target.value)}
                />
                <Input
                  label="Overheads"
                  type="number"
                  min={0}
                  step="any"
                  value={overheadCost}
                  onChange={(e) => setOverheadCost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Input
                  label="Profit Margin %"
                  type="number"
                  step="any"
                  value={bomMarginPct}
                  onChange={(e) => setBomMarginPct(e.target.value)}
                />
                <ReadField label="Cost Price" value={money(costPrice)} numeric />
                <ReadField label="Sales Price" value={money(salesPrice)} numeric />
                <ReadField label="Gross Profit" value={money(grossProfit)} numeric />
              </div>
              <div className="rounded-lg border border-[#e7ddcb] bg-[#faf6ee] p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-[#6d6258] dark:text-slate-400">
                  Price per {yieldUnitCode || 'unit'}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <PerUnit label="Est. Cost Price" value={estCostPerUnit} />
                  <PerUnit label="Est. Sales Price" value={estSalesPerUnit} />
                  <PerUnit label="Cost Price" value={product.costPrice ?? 0} />
                  <PerUnit label="Sales Price" value={product.retailPrice ?? 0} />
                </div>
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
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setIngForm(null)}>
              Cancel <Kbd>Esc</Kbd>
            </button>
            <button className="btn-primary" onClick={saveIng}>
              {ingForm?.index == null ? 'Add' : 'Update'} <Kbd>↵</Kbd>
            </button>
          </div>
        }
      >
        {ingForm && (
          <form
            key={ingSeq}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveIng();
            }}
          >
            <Select
              label="Item"
              required
              autoFocus={ingForm.index == null}
              openOnFocus
              value={ingForm.draft.itemId}
              onChange={(e) => onPickIngItem(e.target.value)}
              placeholder="Select item"
              options={itemList.map((it) => ({ value: it.id, label: it.name }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantity"
                required
                type="number"
                min={0}
                step="any"
                value={ingForm.draft.quantity}
                onChange={(e) =>
                  setIngForm((f) =>
                    f ? { ...f, draft: { ...f.draft, quantity: e.target.value } } : f,
                  )
                }
              />
              <Select
                label="Unit"
                required
                openOnFocus
                value={ingForm.draft.unitId}
                onChange={(e) =>
                  setIngForm((f) =>
                    f ? { ...f, draft: { ...f.draft, unitId: e.target.value } } : f,
                  )
                }
                placeholder="Unit"
                options={unitList.map((u) => ({ value: u.id, label: u.name }))}
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
                Press Enter to add and keep adding — Esc to close.
              </p>
            )}
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Drawer>

      {/* Process data-entry overlay */}
      <Drawer
        open={!!procForm}
        onClose={() => setProcForm(null)}
        title={procForm?.index == null ? 'Add Process' : 'Edit Process'}
        subtitle="Step, processing time and machine"
        icon={<Cog className="h-5 w-5" />}
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setProcForm(null)}>
              Cancel <Kbd>Esc</Kbd>
            </button>
            <button className="btn-primary" onClick={saveProc}>
              {procForm?.index == null ? 'Add' : 'Update'} <Kbd>↵</Kbd>
            </button>
          </div>
        }
      >
        {procForm && (
          <form
            key={procSeq}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveProc();
            }}
          >
            <Input
              label="Process / step name"
              required
              autoFocus={procForm.index == null}
              value={procForm.draft.name}
              onChange={(e) =>
                setProcForm((f) =>
                  f ? { ...f, draft: { ...f.draft, name: e.target.value } } : f,
                )
              }
              placeholder="e.g. Boiling"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Time"
                type="number"
                min={0}
                step="any"
                value={procForm.draft.timeValue}
                onChange={(e) =>
                  setProcForm((f) =>
                    f ? { ...f, draft: { ...f.draft, timeValue: e.target.value } } : f,
                  )
                }
              />
              <Select
                label="Unit"
                openOnFocus
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
            <Select
              label="Machine"
              openOnFocus
              value={procForm.draft.machineId}
              onChange={(e) =>
                setProcForm((f) =>
                  f ? { ...f, draft: { ...f.draft, machineId: e.target.value } } : f,
                )
              }
              placeholder="— Select machine —"
              options={machineList.map((m) => ({
                value: m.id,
                label: `${m.name} (${m.code})`,
              }))}
            />
            {procForm.index == null && (
              <p className="text-xs text-slate-400">
                Press Enter to add and keep adding — Esc to close.
              </p>
            )}
            <button type="submit" className="hidden" aria-hidden />
          </form>
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
        <button className="btn-secondary text-xs" onClick={onAdd}>
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
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <span className="label !mb-0.5 block">{label}</span>
      <div
        className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200 ${
          numeric ? 'text-right tabular-nums' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function PerUnit({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="block text-xs text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
        {money(value)}
      </span>
    </div>
  );
}
