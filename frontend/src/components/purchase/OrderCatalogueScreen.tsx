'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Package,
  RotateCcw,
  ShoppingCart,
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
  poQty: number;
  contractQty: number;
  contractSources: {
    contractId: number;
    contractNo: string;
    customerName: string;
    quantity: number;
    rate: number;
  }[];
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

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(value * factor) / factor;
};

/**
 * The suggestion, for a given number of cover days.
 *
 *   (cover x average daily sales) - min stock - available + PO qty + contract qty
 *
 * The same arithmetic the server does, repeated here so editing Cover answers
 * instantly instead of waiting on a round trip. Every input is already on the
 * row, so nothing has to be fetched to redo it — which is the reason the server
 * sends them rather than just the answer.
 *
 * `onOrder` is deliberately NOT netted off: what is already coming on an open
 * ICPO is shown as a column to read, not subtracted.
 */
const suggestFor = (row: CatalogueRow, coverDays: number) =>
  roundTo(
    Math.max(
      0,
      row.avgDailySales * coverDays -
        row.minStock -
        row.available +
        row.poQty +
        row.contractQty,
    ),
    row.decimalPlaces,
  );

/**
 * The Order Catalogue.
 *
 * Everything the chosen supplier sells, as a list with the branch's own numbers
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
  /**
   * Cover days the user has OVERRIDDEN, keyed by product. Absent = use the one
   * the server worked out from the production schedule.
   *
   * Kept apart from the row rather than written into it: the server's cover is
   * the argument the screen is making, and a branch that types over it for one
   * product should still see what the schedule said when they change their mind.
   */
  const [coverEdits, setCoverEdits] = useState<Record<number, string>>({});
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
    // Overridden cover days go too. They were judgements about a different
    // supplier or a different delivery day, and the schedule this catalogue was
    // built from is not the one they were typed against.
    setCoverEdits({});
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

  /**
   * Cover days for a row: the branch's override where they typed one, otherwise
   * what the production schedule worked out.
   */
  const coverOf = (row: CatalogueRow) => {
    const edited = coverEdits[row.productId];
    if (edited === undefined || edited === '') return row.coverDays;
    const n = Number(edited);
    return Number.isFinite(n) && n > 0 ? n : row.coverDays;
  };

  /**
   * Changing the cover re-answers the question the row is asking, so the
   * quantity moves with it — leaving the old number beside a new cover would be
   * a suggestion for a period nobody is now ordering for.
   */
  const setCover = (row: CatalogueRow, value: string) => {
    setTouched(true);
    setCoverEdits((c) => {
      const next = { ...c };
      if (value === '') delete next[row.productId];
      else next[row.productId] = value;
      return next;
    });
    const n = value === '' ? row.coverDays : Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    const fresh = suggestFor(row, n);
    setOrder((o) => {
      const next = { ...o };
      if (fresh > 0) next[row.productId] = String(fresh);
      else delete next[row.productId];
      return next;
    });
  };

  const resetToSuggested = () => {
    const seeded: Record<number, string> = {};
    for (const r of rows) {
      if (r.suggestedQty > 0) seeded[r.productId] = String(r.suggestedQty);
    }
    setOrder(seeded);
    setCoverEdits({});
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
                <section key={category} className="mb-5">
                  <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {category}
                    <span className="ml-2 font-normal normal-case text-slate-400">
                      {items.length} product{items.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                  {/* A LIST, not cards. Ordering is comparing — is 65 right
                      when the shelf has 19 and it sells 42 a day — and that is
                      reading DOWN a column, which cards cannot offer. It also
                      puts forty products on screen instead of four. The wide
                      columns collapse on a narrow viewport, where the figures
                      move under the name. */}
                  <div className="card overflow-hidden">
                    <div className="hidden border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:flex lg:items-center dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                      <span className="w-10 shrink-0" />
                      <span className="min-w-0 flex-1 pl-3">Product</span>
                      <span className="w-24 shrink-0 text-right">Price</span>
                      <span className="w-20 shrink-0 text-right">Min</span>
                      <span className="w-20 shrink-0 text-right">Available</span>
                      <span className="w-20 shrink-0 text-right">Avg / day</span>
                      <span className="w-16 shrink-0 text-right">PO</span>
                      <span className="w-16 shrink-0 text-right">Contract</span>
                      <span className="w-20 shrink-0 text-center">Cover</span>
                      <span className="w-20 shrink-0 text-right">Suggested</span>
                      <span className="w-28 shrink-0 pl-3 text-right">Order</span>
                    </div>
                    {items.map((row) => (
                      <ProductRow
                        key={row.productId}
                        row={row}
                        value={order[row.productId] ?? ''}
                        onChange={(v) => setQty(row.productId, v)}
                        cover={coverOf(row)}
                        coverEdited={coverEdits[row.productId] !== undefined}
                        onCover={(v) => setCover(row, v)}
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
 * One product as a LIST ROW: thumbnail, name, price, then the four figures the
 * suggestion is built from, then the box to change it in.
 *
 * The figures are on the row rather than behind a click because the suggestion
 * is an argument, not an instruction — a manager who can see that "42 a day over
 * 21 days, 2 days of cover, 19 on the shelf" is what produced 65 can tell at a
 * glance when it is wrong. In a list they also line up into columns, so the
 * comparison that actually decides an order — which of these forty is short —
 * is one read down the page instead of forty separate ones.
 */
function ProductRow({
  row,
  value,
  onChange,
  cover,
  coverEdited,
  onCover,
}: {
  row: CatalogueRow;
  value: string;
  onChange: (value: string) => void;
  /** Cover days in force — the branch's override, or the schedule's answer. */
  cover: number;
  /** Whether that is an override, so the row can say the schedule is off. */
  coverEdited: boolean;
  onCover: (value: string) => void;
}) {
  const ordering = Number(value) > 0;
  const step = row.decimalPlaces > 0 ? 10 ** -row.decimalPlaces : 1;
  // What the suggestion IS at the cover in force — the server's figure is only
  // right while nobody has changed the cover.
  const suggested = suggestFor(row, cover);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-y-2 border-b border-slate-100 px-3 py-2 text-sm transition last:border-b-0 lg:flex-nowrap dark:border-slate-800/60',
        ordering
          ? 'bg-brand-50/60 dark:bg-brand-950/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
      )}
    >
      {/* Thumbnail. Small on purpose — it is here to be recognised in passing,
          not studied; the product is identified by its name and code. */}
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(row.imageUrl)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-4 w-4 text-slate-300 dark:text-slate-600" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 pl-3">
        <p
          className="truncate font-medium text-slate-900 dark:text-white"
          title={row.name}
        >
          {row.name}
          {row.belowLevel && (
            <span
              className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              title={`Below the level set for this branch (${qty(
                Math.max(row.reorderLevel, row.minStock),
                row.decimalPlaces,
              )} ${row.unitSymbol}).`}
            >
              <TriangleAlert className="h-2.5 w-2.5" /> Low
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-400">
          {row.code}
          {row.packed && <span className="ml-1">· Packed</span>}
          {row.onOrder > 0 && (
            <span
              className="ml-1 text-slate-500 dark:text-slate-400"
              title="Already coming on an open ICPO from this supplier, and deducted from the suggestion."
            >
              · {qty(row.onOrder, row.decimalPlaces)} {row.unitSymbol} on order
            </span>
          )}
        </p>
      </div>

      <Cell
        className="w-24"
        label="Price"
        title="Latest inter-company price. Indicative — the batch that ships carries the real one."
      >
        {money(row.price)}
      </Cell>

      <Cell
        className="w-20"
        label="Min"
        title={
          row.maxStock > 0
            ? `This branch keeps a minimum of ${qty(row.minStock, row.decimalPlaces)} and holds at most ${qty(row.maxStock, row.decimalPlaces)} ${row.unitSymbol}.`
            : `This branch keeps a minimum of ${qty(row.minStock, row.decimalPlaces)} ${row.unitSymbol}.`
        }
      >
        {qty(row.minStock, row.decimalPlaces)}
      </Cell>

      <Cell
        className="w-20"
        label="Available"
        tone={row.belowLevel ? 'warn' : undefined}
        title="On hand at this branch, less anything already held for another document."
      >
        {qty(row.available, row.decimalPlaces)}
      </Cell>

      <Cell
        className="w-20"
        label="Avg / day"
        title={
          row.shelfLife > 0
            ? `${qty(row.soldQty, row.decimalPlaces)} ${row.unitSymbol} sold here over the last ${row.windowDays} days — ${row.demandCycles} shelf lives of ${row.shelfLife} days.`
            : `${qty(row.soldQty, row.decimalPlaces)} ${row.unitSymbol} sold here over the last ${row.windowDays} days. This product tracks no shelf life, so a fixed window is used.`
        }
      >
        {qty(row.avgDailySales, 2)}
      </Cell>

      {/* Ordered by an outside CUSTOMER from this branch, and owed under a
          supply contract that day. Both ADD to the suggestion — a caterer's
          bread is owed to the caterer and cannot also be the bread on the
          shelf — so they are shown as their own columns rather than folded in
          where nobody could see them. */}
      <Cell
        className="w-16"
        label="PO"
        tone={row.poQty > 0 ? 'add' : undefined}
        title={
          row.poQty > 0
            ? `${qty(row.poQty, row.decimalPlaces)} ${row.unitSymbol} ordered from this branch by customers, for on or before the delivery date and not yet dispatched. Added to the suggestion.`
            : 'Nothing ordered from this branch by outside customers for that day.'
        }
      >
        {row.poQty > 0 ? `+${qty(row.poQty, row.decimalPlaces)}` : '—'}
      </Cell>

      <Cell
        className="w-16"
        label="Contract"
        tone={row.contractQty > 0 ? 'add' : undefined}
        title={
          row.contractSources.length
            ? `Owed under ${row.contractSources.length} contract${row.contractSources.length === 1 ? '' : 's'} that day: ${row.contractSources
                .map(
                  (s) =>
                    `${s.customerName} ${qty(s.quantity, row.decimalPlaces)} (${s.contractNo})`,
                )
                .join('; ')}. Added to the suggestion.`
            : 'No supply contract covers this product on that day.'
        }
      >
        {row.contractQty > 0
          ? `+${qty(row.contractQty, row.decimalPlaces)}`
          : '—'}
      </Cell>

      {/* Cover is EDITABLE: the schedule's answer is a good default and not a
          fact — a holiday, a festival week or a van that cannot run tomorrow
          are all reasons a branch knows better. Typing here re-answers the
          suggestion rather than sitting beside a number computed for a period
          nobody is now ordering for. */}
      <div className="flex w-20 shrink-0 items-center justify-end gap-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 lg:hidden">
          Cover
        </span>
        <Input
          type="number"
          min={1}
          step={1}
          value={String(cover)}
          onChange={(e) => onCover(e.target.value)}
          wrapClassName="w-12"
          className={cn(
            '!py-1 !px-1 text-center tabular-nums',
            coverEdited && 'border-brand-400 font-semibold text-brand-700',
          )}
          aria-label={`Cover days for ${row.name}`}
          title={
            coverEdited
              ? `Overridden. The schedule says ${row.coverDays} day${row.coverDays === 1 ? '' : 's'}${row.nextProductionDate ? ` — the next production run is ${row.nextProductionDate}` : ''}. Clear the box to go back to it.`
              : row.nextProductionDate
                ? `This delivery has to last ${row.coverDays} day${row.coverDays === 1 ? '' : 's'} — the next production run is ${row.nextProductionDate}.${
                    row.shelfLife > 0
                      ? ` Capped at the ${row.shelfLife}-day shelf life.`
                      : ''
                  }`
                : `Made to order, so the branch carries its own lead time: ${row.coverDays} day${row.coverDays === 1 ? '' : 's'}.`
          }
        />
        <span className="text-xs text-slate-400">d</span>
      </div>

      {/* The suggestion, and the way back to it. Clicking puts it in the box —
          which is what somebody wants after typing over it and changing
          their mind. */}
      <div className="w-20 shrink-0 text-right">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 lg:hidden">
          Suggested{' '}
        </span>
        <button
          type="button"
          className="rounded px-1 font-semibold tabular-nums text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950"
          // The whole sum, in the order it is worked out — the screen is making
          // an argument, and this is where a branch checks it.
          title={
            `${qty(row.avgDailySales, 2)} a day x ${cover} day${cover === 1 ? '' : 's'} cover = ${qty(row.avgDailySales * cover, row.decimalPlaces)}` +
            `, less ${qty(row.minStock, row.decimalPlaces)} minimum and ${qty(row.available, row.decimalPlaces)} available` +
            (row.poQty > 0
              ? `, plus ${qty(row.poQty, row.decimalPlaces)} on customer orders`
              : '') +
            (row.contractQty > 0
              ? `, plus ${qty(row.contractQty, row.decimalPlaces)} on contract`
              : '') +
            ` = ${qty(suggested, row.decimalPlaces)}.` +
            (row.onOrder > 0
              ? ` ${qty(row.onOrder, row.decimalPlaces)} is already on order and is NOT deducted.`
              : '') +
            ' Click to use it.'
          }
          onClick={() => onChange(String(suggested))}
        >
          {qty(suggested, row.decimalPlaces)}
        </button>
      </div>

      <div className="flex w-28 shrink-0 items-center gap-1 pl-3">
        <Input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          wrapClassName="flex-1"
          className="!py-1 text-right tabular-nums"
          aria-label={`Order quantity for ${row.name}`}
        />
        <span className="w-8 shrink-0 text-xs text-slate-400">
          {row.unitSymbol}
        </span>
      </div>
    </div>
  );
}

/**
 * One figure in a row. The label shows only on a narrow viewport, where the
 * columns have wrapped under the name and the header row is hidden — a bare
 * number with nothing above it says nothing.
 */
function Cell({
  children,
  className,
  label,
  title,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
  title: string;
  /** `warn` = short of the level; `add` = demand that RAISES the suggestion. */
  tone?: 'warn' | 'add';
}) {
  return (
    <div
      className={cn('shrink-0 text-right tabular-nums', className)}
      title={title}
    >
      {label && (
        <span className="text-[11px] uppercase tracking-wide text-slate-400 lg:hidden">
          {label}{' '}
        </span>
      )}
      <span
        className={cn(
          'font-medium',
          tone === 'warn'
            ? 'text-rose-600 dark:text-rose-400'
            : tone === 'add'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {children}
      </span>
    </div>
  );
}
