import type {
  Item,
  Unit,
  Asset,
  HrDesignation,
  ProcessTimeUnit,
} from '@/lib/types';

/**
 * Self-contained recipe printout. Both the recipe editor and the listing build a
 * `RecipePrintInput` (the editor from its current on-screen state, the listing
 * from a fetched product) and call `printRecipe`, which opens a print-ready
 * window. The costing math mirrors the recipe editor exactly.
 */

export type RecipePrintRefs = {
  items: Item[];
  units: Unit[];
  assets: Asset[];
  designations: HrDesignation[];
};

export interface RecipePrintInput {
  code: string;
  name: string;
  category?: { name: string } | null;
  group?: { name: string } | null;
  yieldQty: number;
  unitId: number;
  boxUnitId?: number | null;
  recipe: { itemId: number; quantity: number; unitId: number }[];
  processes: {
    name: string;
    timeValue: number;
    timeUnit: ProcessTimeUnit;
    machineId?: number | null;
    manpower?: { designationId: number; workerCount: number }[];
  }[];
  fuelCost: number;
  overheadCost: number;
  bomMarginPct: number;
  actualSalesPrice: number;
}

const money = (v: number) =>
  (v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const round1 = (v: number) => Math.round(v * 10) / 10;
const money1 = (v: number) =>
  round1(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Build the standalone print document HTML for a recipe (no window side effects). */
export function buildRecipeHtml(
  p: RecipePrintInput,
  refs: RecipePrintRefs,
): string {
  const itemById = new Map(refs.items.map((i) => [i.id, i]));
  const unitById = new Map(refs.units.map((u) => [u.id, u]));
  const assetById = new Map(refs.assets.map((a) => [a.id, a]));
  const desigById = new Map(refs.designations.map((d) => [d.id, d]));

  const baseOf = (u?: Unit) => (u ? (u.baseUnitId ?? u.id) : undefined);
  const factorOf = (u?: Unit) => u?.conversionFactor ?? 1;
  // Item's last purchase price is per its stock unit; convert into the line unit.
  const rateOf = (line: { itemId: number; unitId: number }) => {
    const item = itemById.get(line.itemId);
    if (!item) return 0;
    const price = item.lastPurchasePrice ?? 0;
    const iu = unitById.get(item.unitId);
    const lu = line.unitId ? unitById.get(line.unitId) : undefined;
    if (!iu || !lu || iu.id === lu.id) return price;
    if (baseOf(iu) !== baseOf(lu)) return price;
    return (price * factorOf(lu)) / factorOf(iu);
  };
  const amountOf = (l: { itemId: number; quantity: number; unitId: number }) =>
    (l.quantity || 0) * rateOf(l);
  const hoursOf = (proc: { timeValue: number; timeUnit: ProcessTimeUnit }) =>
    proc.timeUnit === 'HR' ? proc.timeValue : proc.timeValue / 60;

  const itemName = (id: number) => itemById.get(id)?.name ?? `#${id}`;
  const unitCode = (id?: number | null) => {
    const u = unitById.get(Number(id));
    return u?.symbol ?? u?.code ?? '';
  };
  const machineName = (id?: number | null) =>
    id ? (assetById.get(id)?.name ?? `#${id}`) : '—';
  const designationName = (id: number) => desigById.get(id)?.name ?? `#${id}`;

  // --- costing (mirrors the editor) ---
  const materialCost = p.recipe.reduce((s, l) => s + amountOf(l), 0);
  const equipmentCost = p.processes.reduce(
    (s, proc) => s + (assetById.get(Number(proc.machineId))?.costPerHour ?? 0) * hoursOf(proc),
    0,
  );
  const manpowerCost = p.processes.reduce(
    (s, proc) =>
      s +
      (proc.manpower ?? []).reduce(
        (ss, m) =>
          ss +
          (desigById.get(m.designationId)?.ratePerHour ?? 0) *
            hoursOf(proc) *
            (m.workerCount || 0),
        0,
      ),
    0,
  );
  const costPrice =
    materialCost + equipmentCost + manpowerCost + p.fuelCost + p.overheadCost;
  const salesPrice = costPrice * (1 + p.bomMarginPct / 100);
  const grossProfit = salesPrice - costPrice;
  const yQty = p.yieldQty || 1;
  const estCostPerUnit = costPrice / yQty;
  const estSalesPerUnit = salesPrice / yQty;
  const estProfitPerUnit = estSalesPerUnit - estCostPerUnit;
  const actualCostPerUnit = round1(estCostPerUnit);
  const actualProfitPerUnit = p.actualSalesPrice - actualCostPerUnit;
  const estProfitPct = estCostPerUnit ? (estProfitPerUnit / estCostPerUnit) * 100 : 0;
  const actualProfitPct = actualCostPerUnit
    ? (actualProfitPerUnit / actualCostPerUnit) * 100
    : 0;

  const totalProcMinutes = p.processes.reduce(
    (s, proc) => s + (proc.timeUnit === 'HR' ? proc.timeValue * 60 : proc.timeValue),
    0,
  );
  const fmtDuration = (mins: number) => {
    const m = Math.round(mins);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  };

  const yieldUnitCode = unitCode(p.boxUnitId ?? p.unitId) || 'unit';
  const batchQty = round1(yQty);

  // --- rows ---
  const ingredientRows = p.recipe.length
    ? p.recipe
        .map(
          (l, i) => `
          <tr>
            <td class="c">${i + 1}</td>
            <td>${esc(itemName(l.itemId))}</td>
            <td class="r">${money(l.quantity)}</td>
            <td>${esc(unitCode(l.unitId))}</td>
            <td class="r">${money(rateOf(l))}</td>
            <td class="r">${money(amountOf(l))}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td class="c muted" colspan="6">No ingredients.</td></tr>`;

  const manpowerText = (proc: RecipePrintInput['processes'][number]) => {
    const rows = (proc.manpower ?? []).filter((m) => m.designationId);
    if (!rows.length) return '—';
    return rows
      .map(
        (m) =>
          `${esc(designationName(m.designationId))}${
            m.workerCount > 1 ? ` ×${m.workerCount}` : ''
          }`,
      )
      .join(', ');
  };
  const processRows = p.processes.length
    ? p.processes
        .map(
          (proc, i) => `
          <tr>
            <td class="c">${i + 1}</td>
            <td>${esc(proc.name)}</td>
            <td class="r">${money(proc.timeValue)} ${proc.timeUnit === 'HR' ? 'Hr' : 'Min'}</td>
            <td>${esc(machineName(proc.machineId))}</td>
            <td>${manpowerText(proc)}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td class="c muted" colspan="5">No processes.</td></tr>`;

  const costingRow = (label: string, value: string, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td class="r">${value}</td></tr>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Recipe — ${esc(p.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #2f2a26; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #6d6258; font-size: 11px; margin-bottom: 14px; }
  .meta { display: flex; gap: 24px; flex-wrap: wrap; border: 1px solid #cfc4b0; background: #f3e8d3; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; }
  .meta div span { display: block; color: #6d6258; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .meta div b { font-size: 13px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; background: #5b544c; color: #fff; padding: 6px 8px; margin: 18px 0 0; border-radius: 4px 4px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #c9c1b4; padding: 5px 8px; text-align: left; }
  th { background: #efe7d6; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  td.c, th.c { text-align: center; }
  .muted { color: #999; }
  tfoot td, tr.total td { font-weight: bold; background: #f3ece0; }
  .grid2 { display: flex; gap: 16px; align-items: flex-start; }
  .grid2 > div { flex: 1; }
  @media print { body { margin: 12mm; } .no-print { display: none; } }
</style>
</head>
<body>
  <h1>Recipe — ${esc(p.name)}</h1>
  <div class="sub">Product code ${esc(p.code)} · ingredients, process flow &amp; costing</div>

  <div class="meta">
    <div><span>Category</span><b>${esc(p.category?.name ?? '-')}</b></div>
    <div><span>Group</span><b>${esc(p.group?.name ?? '-')}</b></div>
    <div><span>Product</span><b>${esc(p.name)}</b></div>
    <div><span>Yield</span><b>${money(p.yieldQty)} ${esc(yieldUnitCode)}</b></div>
  </div>

  <h2>Ingredients</h2>
  <table>
    <thead><tr><th class="c">#</th><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${ingredientRows}</tbody>
    <tfoot><tr><td colspan="5" class="r">Total Amount</td><td class="r">${money(materialCost)}</td></tr></tfoot>
  </table>

  <h2>Process Flow</h2>
  <table>
    <thead><tr><th class="c">#</th><th>Process</th><th class="r">Time</th><th>Machine</th><th>Manpower</th></tr></thead>
    <tbody>${processRows}</tbody>
    <tfoot><tr><td colspan="2" class="r">Total Processing Time</td><td colspan="3">${fmtDuration(totalProcMinutes)}</td></tr></tfoot>
  </table>

  <h2>Costing</h2>
  <div class="grid2">
    <table>
      <thead>
        <tr><th colspan="2" style="text-align:center;background:#5b544c;color:#fff;">Price per ${batchQty} ${esc(yieldUnitCode)}</th></tr>
        <tr><th>Description</th><th class="r">Amount</th></tr>
      </thead>
      <tbody>
        ${costingRow('Material Cost (from recipe)', money(materialCost))}
        ${costingRow('Equipment Cost (from process)', money(equipmentCost))}
        ${costingRow('Manpower Cost (from process)', money(manpowerCost))}
        ${costingRow('Fuel Cost', money(p.fuelCost))}
        ${costingRow('Overheads', money(p.overheadCost))}
        ${costingRow('Cost Price', money(costPrice), 'total')}
        ${costingRow('Profit Margin %', money(p.bomMarginPct))}
        ${costingRow('Sales Price', money(salesPrice), 'total')}
        ${costingRow('Gross Profit', money(grossProfit), 'total')}
      </tbody>
    </table>
    <table>
      <thead>
        <tr><th colspan="3" style="text-align:center;background:#5b544c;color:#fff;">Price per 1 ${esc(yieldUnitCode)}</th></tr>
        <tr><th>Description</th><th class="r">Estimated</th><th class="r">Actual</th></tr>
      </thead>
      <tbody>
        <tr><td>Sales Price</td><td class="r">${money1(estSalesPerUnit)}</td><td class="r">${money1(p.actualSalesPrice)}</td></tr>
        <tr><td>Cost Price</td><td class="r">${money1(estCostPerUnit)}</td><td class="r">${money1(actualCostPerUnit)}</td></tr>
        <tr class="total"><td>Profit</td><td class="r">${money1(estProfitPerUnit)}</td><td class="r">${money1(actualProfitPerUnit)}</td></tr>
        <tr><td>Profit Percentage</td><td class="r">${money1(estProfitPct)}%</td><td class="r">${money1(actualProfitPct)}%</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    window.onload = function () { window.focus(); window.print(); };
    window.onafterprint = function () { window.close(); };
  </script>
</body>
</html>`;

  return html;
}

/** Write a built recipe document into an already-open window and let it print. */
export function writeRecipeToWindow(w: Window, html: string): void {
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** Open a print window and render the recipe into it (use from a click handler
 * with no preceding await, so the popup isn't blocked). */
export function printRecipe(p: RecipePrintInput, refs: RecipePrintRefs): void {
  const w = window.open('', '_blank', 'width=980,height=1100');
  if (!w) return; // popup blocked
  writeRecipeToWindow(w, buildRecipeHtml(p, refs));
}
