'use client';

import { useEffect, useMemo, useState } from 'react';
import { Scale, AlertTriangle, TrendingDown, RotateCcw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type {
  ApplyCostingResult,
  PriceKey,
  PriceRevision,
  ProductCostVariance,
  RevisePricesResult,
} from '@/lib/types';

const ROUTE = '/production/cost-review';

const money = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const signed = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;
const num = (s: string) => Number(s) || 0;
const round1 = (v: number) => Math.round(v * 10) / 10;
const toPrice = (s: string) => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? round1(n).toFixed(2) : s;
};

const PRICE_KEYS: PriceKey[] = ['intercompany', 'wholesale', 'retail'];

/**
 * The four states a costed product can be in. They are genuinely different
 * things rather than severities of one, so they are tabs:
 *  - below  : a selling price no longer earns the margin it was set to earn.
 *             THE POINT OF THE SCREEN — needs a human pricing decision.
 *  - drift  : the recipe/packing costs something other than what the Product
 *             Master stores. Derived, so it can simply be applied.
 *  - inStep : recomputes to what is stored, and every margin holds.
 *  - empty  : no BOM entered, so it recomputes to zero. Not a finding, and NOT
 *             updatable — applying zero would destroy a hand-entered cost.
 */
type Tab = 'below' | 'drift' | 'inStep' | 'empty';

/** Editable price fields, keyed `${productId}:${priceKey}`. */
type Edits = Record<string, string>;
const editKey = (productId: number, key: PriceKey) => `${productId}:${key}`;

export default function CostReviewPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<ProductCostVariance[]>(
    '/products/costing/variance',
  );

  const [tab, setTab] = useState<Tab>('below');
  const [edits, setEdits] = useState<Edits>({});
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const canEdit = can(ROUTE, 'edit');
  const all = useMemo(() => data ?? [], [data]);

  // A product below target is shown there and nowhere else, so a pricing problem
  // is never buried under a cost-drift row.
  const groups = useMemo(
    () => ({
      below: all.filter((r) => r.belowTarget && !r.emptyBom),
      drift: all.filter((r) => r.hasDrift && !r.belowTarget && !r.emptyBom),
      inStep: all.filter((r) => !r.hasDrift && !r.belowTarget && !r.emptyBom),
      empty: all.filter((r) => r.emptyBom),
    }),
    [all],
  );
  const rows = groups[tab];

  // ---- price revisions ----
  const priceOf = (r: ProductCostVariance, key: PriceKey) => {
    const edited = edits[editKey(r.productId, key)];
    if (edited != null) return edited;
    const p = r.prices.find((x) => x.key === key);
    return p ? p.price.toFixed(2) : '';
  };
  const setPrice = (productId: number, key: PriceKey, value: string) =>
    setEdits((prev) => ({ ...prev, [editKey(productId, key)]: value }));

  /** The revisions actually pending, i.e. an entered price that differs. */
  const pending = useMemo(() => {
    const out: PriceRevision[] = [];
    for (const r of all) {
      const rev: PriceRevision = { productId: r.productId };
      let any = false;
      for (const key of PRICE_KEYS) {
        const edited = edits[editKey(r.productId, key)];
        if (edited == null) continue;
        const current = r.prices.find((x) => x.key === key)?.price ?? 0;
        if (round1(num(edited)) === round1(current)) continue;
        rev[`${key}Price` as const] = round1(num(edited));
        any = true;
      }
      if (any) out.push(rev);
    }
    return out;
  }, [all, edits]);

  useUnsavedChangesGuard(() => pending.length > 0);
  // Warn on a browser close/refresh too — the guard above covers in-app leaves.
  useEffect(() => {
    if (!pending.length) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [pending.length]);

  const reload = async () => {
    setEdits({});
    await refetch();
  };

  /** Fill a product's price boxes with what restores each target margin. */
  const restoreTargets = (r: ProductCostVariance) =>
    setEdits((prev) => {
      const next = { ...prev };
      for (const p of r.prices) {
        if (p.belowTarget) next[editKey(r.productId, p.key)] = p.priceAtTarget.toFixed(2);
      }
      return next;
    });

  const savePrices = async () => {
    if (!pending.length) return;
    const ok = await confirm({
      title: 'Revise selling prices',
      message:
        `Update the selling prices of ${pending.length} product` +
        `${pending.length === 1 ? '' : 's'}? Each revised price sets a new ` +
        `target margin against the current cost. Recipe Master, Packing Master ` +
        `and the Product Master all read these same figures, so all three follow.`,
      confirmText: 'Update prices',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<RevisePricesResult>('/products/costing/prices', {
        revisions: pending,
      });
      toast.success(`${res.updated} product${res.updated === 1 ? '' : 's'} repriced.`);
      if (res.skippedLocked.length) {
        toast.error(`Skipped (locked): ${res.skippedLocked.join(', ')}`);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update prices.');
    } finally {
      setBusy(false);
    }
  };

  // ---- cost application ----
  const costable = [...groups.below, ...groups.drift].filter(
    (r) => r.hasDrift && !r.isLocked,
  );

  const applyCosts = async () => {
    if (!costable.length) return;
    const ok = await confirm({
      title: 'Update cost prices',
      message:
        `Write the recomputed cost onto ${costable.length} product` +
        `${costable.length === 1 ? '' : 's'}? Only the cost is written — selling ` +
        `prices and the target margins they were set to earn are left untouched.`,
      confirmText: 'Update costs',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<ApplyCostingResult>('/products/costing/apply', {
        productIds: costable.map((r) => r.productId),
      });
      toast.success(`Cost updated on ${res.updated} product${res.updated === 1 ? '' : 's'}.`);
      if (res.skippedLocked.length) {
        toast.error(`Skipped (locked): ${res.skippedLocked.join(', ')}`);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update costs.');
    } finally {
      setBusy(false);
    }
  };

  // ---- table ----
  const priceCell = (r: ProductCostVariance, key: PriceKey) => {
    const p = r.prices.find((x) => x.key === key);
    if (!p) return <span className="text-slate-300">—</span>;
    const edited = edits[editKey(r.productId, key)];
    const live = edited != null ? num(edited) : p.price;
    // The margin recalculates as you type, against the recomputed cost.
    const cost = r.emptyBom ? r.storedCost : r.computedCost;
    const pct = cost ? round1(((live - cost) / cost) * 100) : 0;
    const short = pct < p.targetProfitPct - 0.05;
    const changed = edited != null && round1(live) !== round1(p.price);

    return (
      <div className="flex flex-col items-end gap-0.5">
        {canEdit ? (
          <input
            className={cn(
              'w-24 rounded border px-2 py-1 text-right text-sm tabular-nums',
              changed
                ? 'border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40'
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
            )}
            type="number"
            min={0}
            step="any"
            value={priceOf(r, key)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setPrice(r.productId, key, e.target.value)}
            onBlur={(e) => setPrice(r.productId, key, toPrice(e.target.value))}
          />
        ) : (
          <span className="tabular-nums">{money(p.price)}</span>
        )}
        <span className="text-[11px] tabular-nums">
          <span className={cn(short ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-400')}>
            {money(pct)}%
          </span>
          <span className="text-slate-300"> / {money(p.targetProfitPct)}%</span>
        </span>
      </div>
    );
  };

  const columns: Column<ProductCostVariance>[] = [
    {
      key: 'name',
      header: 'Product',
      accessor: (r) => `${r.name} ${r.code}`,
      render: (r) => (
        <div>
          <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
            {r.name}
            {r.isLocked && <span title="Locked — not updated">🔒</span>}
          </div>
          <div className="text-xs text-slate-400">
            {r.code} · {r.basis === 'PACKING' ? 'Packing' : 'Recipe'}
            {r.categoryName ? ` · ${r.categoryName}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'storedCost',
      header: 'Cost (master)',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortAccessor: (r) => r.storedCost,
      render: (r) => money(r.storedCost),
    },
    {
      key: 'computedCost',
      header: 'Cost (recomputed)',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortAccessor: (r) => r.computedCost,
      render: (r) => (
        <div className="flex flex-col items-end">
          <span>{money(r.computedCost)}</span>
          {r.hasDrift && !r.emptyBom && (
            <span
              className={cn(
                'text-[11px] font-semibold',
                r.costDelta > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              {signed(r.costDelta)}
            </span>
          )}
        </div>
      ),
    },
    ...PRICE_KEYS.map((key) => ({
      key,
      header:
        key === 'intercompany'
          ? 'Intercompany'
          : key === 'wholesale'
            ? 'Wholesale'
            : 'Retail',
      headerClassName: 'text-right',
      className: 'text-right',
      sortable: false,
      render: (r: ProductCostVariance) => priceCell(r, key),
    })),
    ...(canEdit
      ? [
          {
            key: 'fix',
            header: '',
            sortable: false,
            className: 'w-10',
            render: (r: ProductCostVariance) =>
              r.belowTarget ? (
                <button
                  title="Fill in the prices that restore each target margin"
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreTargets(r);
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'below', label: 'Below target margin', count: groups.below.length },
    { key: 'drift', label: 'Cost drifted', count: groups.drift.length },
    { key: 'inStep', label: 'In step', count: groups.inStep.length },
    { key: 'empty', label: 'No BOM yet', count: groups.empty.length },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cost Review"
        description="What each product costs at today's rates, and whether its selling prices still earn the margin they were set to earn."
        icon={<Scale className="h-5 w-5" />}
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary"
                disabled={!costable.length || busy}
                onClick={applyCosts}
                title="Write the recomputed cost onto every product whose cost has drifted"
              >
                Update costs{costable.length ? ` (${costable.length})` : ''}
              </button>
              <button
                className="btn-primary"
                disabled={!pending.length || busy}
                onClick={savePrices}
              >
                {busy
                  ? 'Saving…'
                  : `Save price revisions${pending.length ? ` (${pending.length})` : ''}`}
              </button>
            </div>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              tab === t.key
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
              t.key === 'below' &&
                t.count > 0 &&
                tab !== t.key &&
                'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-300',
            )}
          >
            {t.key === 'below' && t.count > 0 && (
              <TrendingDown className="mr-1.5 inline h-4 w-4" />
            )}
            {t.label}
            <span className="ml-2 tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      <Note tab={tab} />

      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.productId}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search product…"
          onRefresh={reload}
          emptyMessage={
            tab === 'below'
              ? 'Every product is still earning the margin it was priced for.'
              : tab === 'drift'
                ? 'No costs have drifted.'
                : 'Nothing here.'
          }
        />
      </div>
    </div>
  );
}

/** What the current tab means, and what may be done about it. */
function Note({ tab }: { tab: Tab }) {
  const text =
    tab === 'below'
      ? 'These products no longer earn the margin their prices were set for — the cost of making them has risen underneath the price. Nothing is changed automatically: revise a price below, or use ↺ to fill in what restores each target margin, then save. A revised price sets a new target.'
      : tab === 'drift'
        ? 'The recipe or packing now costs something other than what the Product Master holds, but every margin still holds. Cost is a calculation, so "Update costs" can simply write it — target margins are left untouched.'
        : tab === 'inStep'
          ? 'Cost matches the Product Master and every price still earns its target margin. Nothing to do — prices remain editable if you want to revise one anyway.'
          : 'No recipe or packing has been entered for these, so there is nothing to cost from and they recompute to zero. Any cost shown was typed into the Product Master by hand; they cannot be cost-updated here, because writing zero over it would lose it. Enter the BOM in Recipe or Packing Master instead.';

  const danger = tab === 'empty';
  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
        danger
          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
      )}
    >
      {danger && <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />}
      <span>{text}</span>
    </div>
  );
}
