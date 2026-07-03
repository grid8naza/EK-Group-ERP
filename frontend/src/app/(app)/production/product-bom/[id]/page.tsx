'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ListTree,
  Plus,
  Trash2,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Cog,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
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

export default function ProductBomEditorPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();

  const id = String(params.id);
  const view = search.get('view') === '1' || !can(ROUTE, 'edit');

  const { data: product, loading } = useFetch<Product>(`/products/${id}`);
  const { data: items } = useFetch<Item[]>('/items');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: assets } = useFetch<Asset[]>('/assets');

  const itemList = items ?? [];
  const unitList = units ?? [];
  // Only production-line machines that are currently active can be assigned.
  const machineList = useMemo(
    () => (assets ?? []).filter((a) => a.isProductionLine && a.status === 'ACTIVE'),
    [assets],
  );
  const itemById = useMemo(
    () => new Map(itemList.map((i) => [i.id, i])),
    [itemList],
  );
  const unitById = useMemo(
    () => new Map(unitList.map((u) => [u.id, u])),
    [unitList],
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

  // --- ingredient helpers ---
  // A unit's base unit id and how many base units make one of it (SIMPLE units
  // are their own base with factor 1; COMPOUND/CHAINING carry the resolved
  // baseUnitId + conversionFactor, e.g. 1 KG = 1000 GM).
  const baseOf = (u?: Unit) => (u ? (u.baseUnitId ?? u.id) : undefined);
  const factorOf = (u?: Unit) => u?.conversionFactor ?? 1;

  // Rate = the item's last purchase price (which is per the item's stock unit)
  // converted into the BOM line's unit. e.g. price 210/KG, line in GM → 0.21/GM.
  // Falls back to the raw price when the units are the same or not convertible
  // (different base unit).
  const rateOf = (l: Line) => {
    const item = itemById.get(Number(l.itemId));
    if (!item) return 0;
    const price = item.lastPurchasePrice ?? 0;
    const itemUnit = unitById.get(item.unitId);
    const lineUnit = l.unitId ? unitById.get(Number(l.unitId)) : undefined;
    if (!itemUnit || !lineUnit || itemUnit.id === lineUnit.id) return price;
    if (baseOf(itemUnit) !== baseOf(lineUnit)) return price;
    return (price * factorOf(lineUnit)) / factorOf(itemUnit);
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
  const estCostPerUnit = costPrice / yQty; // BOM-estimated
  const estSalesPerUnit = salesPrice / yQty;

  const setLine = (
    lines: Line[],
    setLines: (l: Line[]) => void,
    i: number,
    patch: Partial<Line>,
  ) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const onPickItem = (
    lines: Line[],
    setLines: (l: Line[]) => void,
    i: number,
    itemId: string,
  ) => {
    const it = itemById.get(Number(itemId));
    setLine(lines, setLines, i, {
      itemId,
      ...(lines[i].unitId ? {} : { unitId: it ? String(it.unitId) : '' }),
    });
  };

  // --- process helpers ---
  const addProc = () =>
    setProcesses((p) => [
      ...p,
      { name: '', timeValue: '0', timeUnit: 'MIN', machineId: '' },
    ]);
  const setProc = (i: number, patch: Partial<Proc>) =>
    setProcesses((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeProc = (i: number) =>
    setProcesses((p) => p.filter((_, idx) => idx !== i));
  const moveProc = (i: number, dir: -1 | 1) =>
    setProcesses((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const validLines = (lines: Line[]) =>
    lines.filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitId);

  const save = async (close: boolean) => {
    if (!product) return;
    const badLine = (lines: Line[]) =>
      lines.some((l) => l.itemId && (!(Number(l.quantity) > 0) || !l.unitId));
    if (badLine(recipe)) {
      toast.error('Each ingredient line needs a positive quantity and a unit.');
      return;
    }
    if (processes.some((p) => !p.name.trim())) {
      toast.error('Each process needs a name.');
      return;
    }
    const payload = {
      yieldQty: num(yieldQty) || 1,
      yieldUnitId: product.boxUnitId ?? product.unitId,
      recipe: validLines(recipe).map((l) => ({
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

  const unitCode = (unitId?: number | null) =>
    unitList.find((u) => u.id === unitId)?.code ?? '';
  const yieldUnitCode = unitCode(product?.boxUnitId ?? product?.unitId);

  if (loading || !product) {
    return (
      <div className="mx-auto flex h-full max-w-[1400px] flex-col">
        <p className="py-16 text-center text-slate-400">Loading BOM…</p>
      </div>
    );
  }

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
                  Save
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

      <ReadOnlyFieldset readOnly={view}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
          {/* Header — identity + yield */}
          <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <ReadField label="Category" value={product.category?.name ?? '-'} />
            <ReadField label="Group" value={product.group?.name ?? '-'} />
            <ReadField label="Product" value={product.name} />
            <div className="flex items-end gap-2">
              <Input
                label="Yield"
                type="number"
                min={0}
                step="any"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
                wrapClassName="flex-1"
              />
              <span className="pb-2 text-sm text-slate-500 dark:text-slate-400">
                {yieldUnitCode}
              </span>
            </div>
          </div>

          {/* Ingredients — full width, process flow below it */}
          <div className="space-y-4">
            {/* Ingredients (recipe) */}
            <div className="card flex flex-col p-4">
              <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-[#5b544c] px-4 py-2.5 dark:bg-slate-800">
                <h2 className="text-sm font-semibold text-white">Ingredients</h2>
                {!view && (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() =>
                      setRecipe([...recipe, { itemId: '', quantity: '', unitId: '' }])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add item
                  </button>
                )}
              </div>

              <div>
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                      <th className="min-w-[10rem] py-2 pr-2">Item</th>
                      <th className="w-20 py-2 px-1 text-right">Qty</th>
                      <th className="w-24 py-2 px-1">Unit</th>
                      <th className="w-24 py-2 px-1 text-right">Rate</th>
                      <th className="w-28 py-2 pl-1 text-right">Amount</th>
                      {!view && <th className="w-8" />}
                    </tr>
                  </thead>
                  <tbody>
                    {recipe.length === 0 ? (
                      <tr>
                        <td
                          colSpan={view ? 5 : 6}
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
                          <td className="py-1.5 pr-2">
                            <Select
                              value={line.itemId}
                              onChange={(e) =>
                                onPickItem(recipe, setRecipe, i, e.target.value)
                              }
                              placeholder="Select item"
                              options={itemList.map((it) => ({
                                value: it.id,
                                label: it.name,
                              }))}
                            />
                          </td>
                          <td className="px-1">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={line.quantity}
                              onChange={(e) =>
                                setLine(recipe, setRecipe, i, {
                                  quantity: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="px-1">
                            <Select
                              value={line.unitId}
                              onChange={(e) =>
                                setLine(recipe, setRecipe, i, {
                                  unitId: e.target.value,
                                })
                              }
                              placeholder="Unit"
                              options={unitList.map((u) => ({
                                value: u.id,
                                label: u.code,
                              }))}
                            />
                          </td>
                          <td className="px-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {money(rateOf(line))}
                          </td>
                          <td className="pl-1 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                            {money(amountOf(line))}
                          </td>
                          {!view && (
                            <td className="text-right">
                              <button
                                type="button"
                                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                                onClick={() =>
                                  setRecipe(recipe.filter((_, idx) => idx !== i))
                                }
                                aria-label="Remove"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                      <td colSpan={4} className="py-2 text-right text-sm font-semibold">
                        Total Amount
                      </td>
                      <td className="py-2 pl-1 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                        {money(materialCost)}
                      </td>
                      {!view && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Process Flow */}
            <div className="card flex flex-col p-4">
              <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-2xl bg-[#5b544c] px-4 py-2.5 dark:bg-slate-800">
                <h2 className="text-sm font-semibold text-white">Process Flow</h2>
                {!view && (
                  <button className="btn-secondary text-xs" onClick={addProc}>
                    <Plus className="h-3.5 w-3.5" /> Add process
                  </button>
                )}
              </div>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Steps involved in production — processing time and the machine
                required for each stage.
              </p>

              {processes.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400 dark:border-slate-600">
                  No processes yet — add one to start the flow.
                </p>
              ) : (
                <div className="space-y-2">
                  {processes.map((p, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                          {i + 1}
                        </span>
                        <Input
                          value={p.name}
                          onChange={(e) => setProc(i, { name: e.target.value })}
                          placeholder="Process / step name"
                          wrapClassName="flex-1"
                        />
                        {!view && (
                          <div className="flex flex-none items-center">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                              onClick={() => moveProc(i, -1)}
                              disabled={i === 0}
                              aria-label="Move up"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                              onClick={() => moveProc(i, 1)}
                              disabled={i === processes.length - 1}
                              aria-label="Move down"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:text-red-600"
                              onClick={() => removeProc(i)}
                              aria-label="Remove process"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex items-end gap-2 pl-8">
                        <Input
                          label="Time"
                          type="number"
                          min={0}
                          step="any"
                          value={p.timeValue}
                          onChange={(e) => setProc(i, { timeValue: e.target.value })}
                          wrapClassName="w-24"
                        />
                        <Select
                          label="Unit"
                          value={p.timeUnit}
                          onChange={(e) =>
                            setProc(i, {
                              timeUnit: e.target.value as ProcessTimeUnit,
                            })
                          }
                          options={[
                            { value: 'MIN', label: 'Min' },
                            { value: 'HR', label: 'Hr' },
                          ]}
                          wrapClassName="w-24"
                        />
                        <Select
                          label="Machine"
                          value={p.machineId}
                          onChange={(e) => setProc(i, { machineId: e.target.value })}
                          placeholder="— Select machine —"
                          options={machineList.map((m) => ({
                            value: m.id,
                            label: `${m.name} (${m.code})`,
                          }))}
                          wrapClassName="flex-1"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {machineList.length === 0 && !view && (
                <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Cost inputs */}
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
              {/* Derived totals */}
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
              {/* Per-unit price comparison */}
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
          </div>
        </div>
      </ReadOnlyFieldset>
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
