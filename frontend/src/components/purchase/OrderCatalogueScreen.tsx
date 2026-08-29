'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Package,
  RotateCcw,
  ShoppingCart,
  Info,
  TriangleAlert,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { mediaUrl } from '@/lib/login-screen';
import { useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Checkbox, DateInput, Input, Select } from '@/components/ui/Field';
import type { Company, PurchaseOrder } from '@/lib/types';

const ROUTE = '/purchase/order-catalogue';
/** The order this screen raises is an ICPO, so it is the ICPO's rights that say
 *  whether the user may raise one. */
const ICPO_ROUTE = '/purchase/icpo';

/** One product as the catalogue reads it — mirrors the backend CatalogueRow. */
interface CatalogueRow {
  productId: number;
  code: string;
  name: string;
  imageUrl: string | null;
  packed: boolean;
  categoryId: number | null;
  categoryName: string | null;
  groupId: number | null;
  groupName: string | null;
  unitId: number;
  unitSymbol: string;
  decimalPlaces: number;
  price: number;
  shelfLife: number;
  demandCycles: number;
  windowDays: number;
  soldQty: number;
  avgDailySales: number;
  coverDays: number;
  nextProductionDate: string | null;
  minStock: number;
  maxStock: number;
  reorderLevel: number;
  available: number;
  onOrder: number;
  target: number;
  suggestedQty: number;
  belowLevel: boolean;
}

interface CatalogueResult {
  branchId: number;
  supplierCompanyId: number;
  deliveryDate: string;
  rows: CatalogueRow[];
}

/** Tomorrow, as YYYY-MM-DD — the day a branch orders for by default. */
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const qty = (n: number, decimals: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(decimals, 2),
  });

/**
 * The Order Catalogue.
 *
 * Everything the chosen supplier sells, on cards, with the branch's own numbers
 * on each: what it must keep, what it has, what it sold, and — the point of the
 * screen — how much to order. The quantity boxes start on the suggestion, so a
 * manager who agrees with it just presses Create.
 *
 * Read-only until then. Create posts an ordinary ICPO draft through
 * /purchase-orders and hands off to the ICPO screen, so the approval workflow,
 * the numbering and the creator gate are all the same ones a hand-typed order
 * goes through.
 */
export function OrderCatalogueScreen() {
  const { can, activeCompanyId, activeBranch } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const canViewScreen = can(ROUTE, 'view');
  const canRaiseOrder = can(ICPO_ROUTE, 'add');

  const [supplierId, setSupplierId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(tomorrow);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [shortOnly, setShortOnly] = useState(false);

  /** What the user is actually ordering, keyed by product. Empty = not ordered. */
  const [order, setOrder] = useState<Record<number, string>>({});
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<CatalogueResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quantities typed but never turned into an order are worth a warning — they
  // are somebody's morning of judgement about a shelf.
  useUnsavedChangesGuard(() => touched && Object.keys(order).length > 0);

  const { data: companies } = useFetch<Company[]>('/companies');
  // A company cannot supply itself, and the ICPO already refuses one that tries.
  const suppliers = useMemo(
    () => (companies ?? []).filter((c) => c.id !== activeCompanyId),
    [companies, activeCompanyId],
  );

  // Only the workflow's designated creator may raise an order where a workflow
  // governs the ICPO form; it supersedes the Add privilege.
  const { data: createAccess } = useFetch<{
    workflowGoverned: boolean;
    canCreate: boolean;
  }>(canRaiseOrder ? '/purchase-orders/create-access' : null);
  const mayCreate = canRaiseOrder && (createAccess?.canCreate ?? false);

  const branchId = activeBranch?.id ?? null;

  // ---- the catalogue itself ----
  //
  // Refetched whenever the supplier or the delivery date moves: the date is not
  // decoration, it decides how many days of cover each suggestion buys.
  const load = useCallback(async () => {
    if (!supplierId || !branchId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<CatalogueResult>(
        `/purchase-catalogue?supplierId=${supplierId}&deliveryDate=${deliveryDate}`,
      );
      setData(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed to load the catalogue.');
    } finally {
      setLoading(false);
    }
  }, [supplierId, deliveryDate, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // Seed every quantity box with the suggestion the moment a catalogue lands.
  // Typed quantities do NOT survive a change of supplier or date — they were
  // answers to a different question, and carrying them over would quietly order
  // yesterday's numbers against today's cover.
  useEffect(() => {
    const seeded: Record<number, string> = {};
    for (const r of rows) {
      if (r.suggestedQty > 0) seeded[r.productId] = String(r.suggestedQty);
    }
    setOrder(seeded);
    setTouched(false);
  }, [rows]);

  const categories = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of rows) {
      if (r.categoryId != null && !seen.has(r.categoryId)) {
        seen.set(r.categoryId, r.categoryName ?? `#${r.categoryId}`);
      }
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryId && String(r.categoryId) !== categoryId) return false;
      // "Needs attention" — under the level somebody set, or with something to
      // order. A branch working through a long catalogue starts here.
      if (shortOnly && !r.belowLevel && r.suggestedQty <= 0) return false;
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term)
      );
    });
  }, [rows, search, categoryId, shortOnly]);

  /** Grouped by category, so a long catalogue reads in sections. */
  const sections = useMemo(() => {
    const byCategory = new Map<string, CatalogueRow[]>();
    for (const r of visible) {
      const key = r.categoryName ?? 'Uncategorised';
      const bucket = byCategory.get(key);
      if (bucket) bucket.push(r);
      else byCategory.set(key, [r]);
    }
    return [...byCategory].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const setQty = (productId: number, value: string) => {
    setTouched(true);
    setOrder((o) => {
      const next = { ...o };
      if (value === '') delete next[productId];
      else next[productId] = value;
      return next;
    });
  };

  const resetToSuggested = () => {
    const seeded: Record<number, string> = {};
    for (const r of rows) {
      if (r.suggestedQty > 0) seeded[r.productId] = String(r.suggestedQty);
    }
    setOrder(seeded);
    setTouched(false);
  };

  const clearAll = () => {
    setTouched(true);
    setOrder({});
  };

  /** The lines as they will be posted — only positive quantities count. */
  const orderLines = useMemo(
    () =>
      rows
        .map((r) => ({ row: r, quantity: Number(order[r.productId] ?? 0) }))
        .filter((l) => l.quantity > 0),
    [rows, order],
  );

  // Informational only: an ICPO carries no price, because what the goods cost is
  // decided by the batch that ends up shipping. Shown so a branch can see the
  // rough size of what it is committing to.
  const indicativeValue = orderLines.reduce(
    (sum, l) => sum + l.quantity * l.row.price,
    0,
  );

  const createOrder = async () => {
    if (!orderLines.length) {
      toast.error('Enter a quantity against at least one product.');
      return;
    }
    setSaving(true);
    try {
      const draft = await api.post<PurchaseOrder>('/purchase-orders', {
        supplierCompanyId: Number(supplierId),
        // Local midnight on the day the goods are wanted. The ICPO form takes it
        // from here and lets the branch set the hour before submitting.
        deliveryAt: new Date(`${deliveryDate}T00:00`).toISOString(),
        lines: orderLines.map((l) => ({
          productId: l.row.productId,
          quantity: l.quantity,
          unitId: l.row.unitId,
        })),
      });
      setTouched(false);
      toast.success(
        `Draft ${draft.orderNo} raised with ${orderLines.length} product${
          orderLines.length === 1 ? '' : 's'
        }.`,
      );
      // Hand off to the ICPO screen, opened on the draft: the branch gets a last
      // look — and the Submit button — where every other order is reviewed.
      router.push(`${ICPO_ROUTE}?doc=${draft.id}`);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to raise the order.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canViewScreen) {
    return (
      <div className="p-6">
        <PageHeader
          title="Order Catalogue"
          icon={<LayoutGrid className="h-5 w-5" />}
        />
        <p className="text-sm text-slate-500">
          You do not have permission to view this screen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="Order Catalogue"
        description="What the supplier sells, what this branch keeps, and how much to order"
        icon={<LayoutGrid className="h-5 w-5" />}
        actions={
          <Badge color={branchId ? 'blue' : 'amber'}>
            {activeBranch?.name ?? 'No branch selected'}
          </Badge>
        }
      />

      {/* An ICPO belongs to the branch that raised it, so there is nothing to
          show — and nothing that could be ordered — without one. */}
      {!branchId ? (
        <div className="card p-8 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Select an active branch in the header. The catalogue is read for one
            branch — its levels, its stock, its sales — and an order can only be
            raised for the branch you are working in.
          </p>
        </div>
      ) : (
        <>
          <div className="card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Supplier"
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              placeholder="Select a supplier company"
              options={suppliers.map((c) => ({
                value: c.id,
                label: `${c.name} (${c.code})`,
              }))}
            />
            <DateInput
              label="Wanted on"
              value={deliveryDate}
              onChange={(iso) => iso && setDeliveryDate(iso)}
            />
            <Input
              label="Search"
              placeholder="Name or code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              label="Category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              placeholder="All categories"
              options={categories}
            />
          </div>

          {supplierId && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Checkbox
                label="Only what needs ordering"
                checked={shortOnly}
                onChange={(e) => setShortOnly(e.target.checked)}
              />
              <div className="flex items-center gap-2">
                <button className="btn-secondary text-xs" onClick={clearAll}>
                  Clear all
                </button>
                <button
                  className="btn-secondary text-xs"
                  onClick={resetToSuggested}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to suggested
                </button>
              </div>
            </div>
          )}

          {/* The grid. Scrolls under the summary bar, which stays put. */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {!supplierId ? (
              <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Choose a supplier company to see its catalogue.
              </div>
            ) : loading ? (
              <div className="card p-8 text-center text-sm text-slate-500">
                Loading the catalogue…
              </div>
            ) : error ? (
              <div className="card p-8 text-center text-sm text-rose-600">
                {error}
              </div>
            ) : !visible.length ? (
              <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                {rows.length
                  ? 'Nothing matches those filters.'
                  : 'This company does not sell anything to order.'}
              </div>
            ) : (
              sections.map(([category, items]) => (
                <section key={category} className="mb-6">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {category}
                    <span className="ml-2 font-normal normal-case text-slate-400">
                      {items.length} product{items.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {items.map((row) => (
                      <ProductCard
                        key={row.productId}
                        row={row}
                        value={order[row.productId] ?? ''}
                        onChange={(v) => setQty(row.productId, v)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>

          {/* What has been picked so far, and the way out of the screen. */}
          {supplierId && (
            <div className="card sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {orderLines.length}
                </span>{' '}
                product{orderLines.length === 1 ? '' : 's'} to order
                {indicativeValue > 0 && (
                  <span
                    className="ml-2 text-slate-400"
                    title="Indicative only — an inter-company order carries no price. What the goods cost is decided by the batch that ships."
                  >
                    ≈ {money(indicativeValue)}
                  </span>
                )}
              </div>
              <button
                className="btn-primary"
                disabled={!orderLines.length || saving || !mayCreate}
                title={
                  !mayCreate
                    ? createAccess?.workflowGoverned
                      ? 'This order is governed by an approval workflow — only its designated creator can raise it.'
                      : 'You do not have permission to raise an inter-company purchase order.'
                    : undefined
                }
                onClick={createOrder}
              >
                <ShoppingCart className="h-4 w-4" />
                {saving ? 'Creating…' : 'Create ICPO'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One product's card: the picture and the price, then the four figures the
 * suggestion is built from, then the box to change it in.
 *
 * The figures are on the card rather than behind a click because the suggestion
 * is an argument, not an instruction — a manager who can see that "42 a day over
 * 21 days, 2 days of cover, 19 on the shelf" is what produced 65 can tell at a
 * glance when it is wrong.
 */
function ProductCard({
  row,
  value,
  onChange,
}: {
  row: CatalogueRow;
  value: string;
  onChange: (value: string) => void;
}) {
  const ordering = Number(value) > 0;
  const step = row.decimalPlaces > 0 ? 10 ** -row.decimalPlaces : 1;

  return (
    <div
      className={cn(
        'card flex flex-col overflow-hidden transition',
        ordering
          ? 'border-brand-400 ring-1 ring-brand-400 dark:border-brand-600 dark:ring-brand-600'
          : 'border-slate-200 dark:border-slate-800',
      )}
    >
      <div className="relative flex h-32 items-center justify-center bg-slate-50 dark:bg-slate-800/50">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(row.imageUrl)}
            alt={row.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <Package className="h-8 w-8 text-slate-300 dark:text-slate-600" />
        )}
        {row.belowLevel && (
          <span
            className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-rose-600/90 px-2 py-0.5 text-[11px] font-medium text-white"
            title={`Below the level set for this branch (${qty(
              Math.max(row.reorderLevel, row.minStock),
              row.decimalPlaces,
            )} ${row.unitSymbol}).`}
          >
            <TriangleAlert className="h-3 w-3" /> Low
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold text-slate-900 dark:text-white"
            title={row.name}
          >
            {row.name}
          </p>
          <p className="text-xs text-slate-400">
            {row.code}
            {row.packed && <span className="ml-1">· Packed</span>}
          </p>
        </div>

        <div className="flex items-baseline justify-between">
          <span
            className="text-sm font-semibold text-slate-700 dark:text-slate-200"
            title="Latest inter-company price. Indicative — the batch that ships carries the real one."
          >
            {money(row.price)}
            <span className="ml-1 text-xs font-normal text-slate-400">
              / {row.unitSymbol}
            </span>
          </span>
        </div>

        {/* The four figures behind the suggestion. */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
          <Figure
            label="Minimum"
            value={qty(row.minStock, row.decimalPlaces)}
            hint={
              row.maxStock > 0
                ? `This branch keeps a minimum of ${qty(row.minStock, row.decimalPlaces)} and holds at most ${qty(row.maxStock, row.decimalPlaces)} ${row.unitSymbol}.`
                : `This branch keeps a minimum of ${qty(row.minStock, row.decimalPlaces)} ${row.unitSymbol}.`
            }
          />
          <Figure
            label="Available"
            value={qty(row.available, row.decimalPlaces)}
            tone={row.belowLevel ? 'warn' : undefined}
            hint="On hand at this branch, less anything already held for another document."
          />
          <Figure
            label="Avg / day"
            value={qty(row.avgDailySales, 2)}
            hint={
              row.shelfLife > 0
                ? `${qty(row.soldQty, row.decimalPlaces)} ${row.unitSymbol} sold here over the last ${row.windowDays} days — ${row.demandCycles} shelf lives of ${row.shelfLife} days.`
                : `${qty(row.soldQty, row.decimalPlaces)} ${row.unitSymbol} sold here over the last ${row.windowDays} days. This product tracks no shelf life, so a fixed window is used.`
            }
          />
          <Figure
            label="Cover"
            value={`${row.coverDays}d`}
            hint={
              row.nextProductionDate
                ? `This delivery has to last ${row.coverDays} day${row.coverDays === 1 ? '' : 's'} — the next production run is ${row.nextProductionDate}.${
                    row.shelfLife > 0
                      ? ` Capped at the ${row.shelfLife}-day shelf life.`
                      : ''
                  }`
                : `Made to order, so the branch carries its own lead time: ${row.coverDays} day${row.coverDays === 1 ? '' : 's'}.`
            }
          />
        </dl>

        {row.onOrder > 0 && (
          <p
            className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
            title="Already coming on an open ICPO from this supplier, and deducted from the suggestion."
          >
            <Info className="h-3 w-3" />
            {qty(row.onOrder, row.decimalPlaces)} {row.unitSymbol} already on
            order
          </p>
        )}

        <div className="mt-auto flex items-end gap-2 pt-1">
          <Input
            label="Order"
            type="number"
            min={0}
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            wrapClassName="flex-1"
            className="text-right tabular-nums"
          />
          <button
            type="button"
            className="mb-[1px] shrink-0 rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            title={`Suggested: ${qty(row.target, row.decimalPlaces)} to cover ${row.coverDays} day${row.coverDays === 1 ? '' : 's'}, less ${qty(row.available, row.decimalPlaces)} available${row.onOrder > 0 ? ` and ${qty(row.onOrder, row.decimalPlaces)} on order` : ''}.`}
            onClick={() => onChange(String(row.suggestedQty))}
          >
            {qty(row.suggestedQty, row.decimalPlaces)} {row.unitSymbol}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One labelled figure on a card, with the reasoning behind it on hover. */
function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'warn';
}) {
  return (
    <div title={hint}>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd
        className={cn(
          'font-medium tabular-nums',
          tone === 'warn'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
