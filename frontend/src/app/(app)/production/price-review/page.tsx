'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Tags,
  AlertTriangle,
  TriangleAlert,
  RotateCcw,
  Crosshair,
  Info,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { useFetch, useUnsavedChangesGuard } from '@/lib/hooks';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { CostBreakdownDrawer } from '@/components/production/CostBreakdownDrawer';
import {
  TONE_MARK,
  TONE_TEXT,
  costBasisOf,
  costedAgo,
  isCostStale,
  money,
  num,
  profitPctAt,
  round1,
  signed,
  toPrice,
  varianceTone,
} from '@/lib/costing';
import type {
  ApplyCostingResult,
  PriceKey,
  PriceRevision,
  ProductCostVariance,
  RevisePricesResult,
} from '@/lib/types';

const ROUTE = '/production/price-review';

const PRICE_KEYS: PriceKey[] = ['intercompany', 'wholesale', 'retail'];
const PRICE_LABEL: Record<PriceKey, string> = {
  intercompany: 'Intercompany',
  wholesale: 'Wholesale',
  retail: 'Retail',
};

/**
 * The four states a SELLABLE product can be in:
 *  - alert  : a channel's margin has strayed further from its target than the
 *             product's tolerance allows, in EITHER direction. THE POINT OF THE
 *             SCREEN — needs a human decision: reprice, or accept the new margin
 *             by resetting the target.
 *  - drift  : cost has moved but every margin is still within tolerance. Cost is
 *             a calculation, so it can simply be applied.
 *  - inStep : cost matches and nothing is off target.
 *  - empty  : no BOM entered, so it recomputes to zero. Its cost is NOT
 *             updatable — zero would destroy a hand-entered figure — but its
 *             prices stay reviewable against whatever cost is stored.
 */
type Tab = 'alert' | 'drift' | 'inStep' | 'empty';

/**
 * One definition per tab, feeding both the hover tip and the note below it, so
 * the two can never tell different stories. `hint` states the RULE that puts a
 * product in that tab — only discoverable by hovering, since the note describes
 * the tab you are already on. `note` adds what to do about it.
 */
const TAB_ORDER: Tab[] = ['alert', 'drift', 'inStep', 'empty'];
const TAB_META: Record<Tab, { label: string; hint: string; note: string }> = {
  alert: {
    label: 'Off target',
    hint: 'A channel earns a margin further from its target than this product’s variance allows — in either direction. Measured at the recomputed cost. Needs a pricing decision.',
    note: 'A channel here earns a margin further from its target than this product allows. Nothing changes automatically — either reprice (↺ fills in the price that hits the target) or accept the new reality by resetting the target (⌖), then save. Saving a price also refreshes the product’s cost and profit %, so every screen agrees.',
  },
  drift: {
    label: 'Cost drifted',
    hint: 'The recomputed cost differs from the one the Product Master holds, but every margin is still on target. Cost is a calculation, so it can simply be written.',
    note: 'The recipe or packing now costs something other than what the Product Master holds, but every margin is still within tolerance. "Update costs" writes the cost alone — prices and targets are untouched.',
  },
  inStep: {
    label: 'In step',
    hint: 'Cost matches the Product Master and every margin is on target. Nothing needs doing.',
    note: 'Cost matches the Product Master and every margin sits within its tolerance. Prices and targets remain editable if you want to revise one anyway.',
  },
  empty: {
    label: 'No BOM yet',
    hint: 'No recipe or packing entered, so there is nothing to cost from and the cost recomputes to zero. Not a finding — and the cost cannot be updated here.',
    note: 'No recipe or packing has been entered, so there is nothing to cost from. The cost cannot be updated here (writing zero would lose the hand-entered figure), but prices stay reviewable against it. Enter the BOM in Recipe or Packing Master.',
  },
};

/** Editable cells, keyed `${productId}:${priceKey}` / `${productId}:${key}#t`. */
const priceKeyOf = (productId: number, key: PriceKey) => `${productId}:${key}`;
const targetKeyOf = (productId: number, key: PriceKey) =>
  `${productId}:${key}#t`;

export default function PriceReviewPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<ProductCostVariance[]>(
    '/products/costing/variance',
  );

  const [tab, setTab] = useState<Tab>('alert');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ProductCostVariance | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const canEdit = can(ROUTE, 'edit');

  // Sellable products only. What is NOT sold has no price to review and is
  // reviewed on cost alone, in Cost Review.
  const all = useMemo(() => (data ?? []).filter((r) => r.canSell), [data]);

  const groups = useMemo(
    () => ({
      alert: all.filter((r) => r.hasAlert && !r.emptyBom),
      drift: all.filter((r) => r.hasDrift && !r.hasAlert && !r.emptyBom),
      inStep: all.filter((r) => !r.hasDrift && !r.hasAlert && !r.emptyBom),
      empty: all.filter((r) => r.emptyBom),
    }),
    [all],
  );
  const rows = groups[tab];

  // ---- edits ----
  const shownPrice = (r: ProductCostVariance, key: PriceKey) => {
    const edited = edits[priceKeyOf(r.productId, key)];
    if (edited != null) return edited;
    const p = r.prices.find((x) => x.key === key);
    return p ? p.price.toFixed(2) : '';
  };
  const shownTarget = (r: ProductCostVariance, key: PriceKey) => {
    const edited = edits[targetKeyOf(r.productId, key)];
    if (edited != null) return edited;
    const p = r.prices.find((x) => x.key === key);
    return p?.targetProfitPct != null ? p.targetProfitPct.toFixed(2) : '';
  };
  const setCell = (cellKey: string, value: string) =>
    setEdits((prev) => ({ ...prev, [cellKey]: value }));

  /** The revisions actually pending — an entered value that differs. */
  const pending = useMemo(() => {
    const out: PriceRevision[] = [];
    for (const r of all) {
      const rev: PriceRevision = { productId: r.productId };
      let any = false;
      for (const key of PRICE_KEYS) {
        const p = r.prices.find((x) => x.key === key);
        if (!p) continue;

        const ep = edits[priceKeyOf(r.productId, key)];
        if (ep != null && round1(num(ep)) !== round1(p.price)) {
          rev[`${key}Price` as const] = round1(num(ep));
          any = true;
        }

        const et = edits[targetKeyOf(r.productId, key)];
        if (et != null) {
          // Blank clears the target; the key must still be SENT so the server
          // can tell "cleared" from "left alone".
          const next = et.trim() === '' ? null : round1(num(et));
          if (next !== p.targetProfitPct) {
            rev[`${key}TargetPct` as const] = next;
            any = true;
          }
        }
      }
      if (any) out.push(rev);
    }
    return out;
  }, [all, edits]);

  useUnsavedChangesGuard(() => pending.length > 0);
  // Also warn on a browser close / refresh; the guard above covers in-app leaves.
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

  /**
   * Reprice: fill in what hits each off-target channel's target margin.
   *
   * Confirmed because it overwrites whatever is already in those price boxes,
   * including edits typed a moment ago. It only fills the form — Save is still
   * what writes — so the prompt says so rather than implying a commit.
   */
  const repriceToTarget = async (r: ProductCostVariance) => {
    const moves = r.prices.filter((p) => p.alert && p.priceAtTarget != null);
    if (!moves.length) return;
    const ok = await confirm({
      title: 'Reprice to target',
      message:
        `${r.name} — set ${moves
          .map(
            (p) => `${p.label} ${money(p.price)} → ${money(p.priceAtTarget!)}`,
          )
          .join(
            ', ',
          )}. This overwrites anything typed into those price boxes. ` +
        `Nothing is written until you press Save.`,
      confirmText: 'Reprice',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const p of moves) {
        next[priceKeyOf(r.productId, p.key)] = p.priceAtTarget!.toFixed(2);
      }
      return next;
    });
  };

  /**
   * Reset targets: accept each off-target channel's actual margin as intended.
   *
   * The more consequential of the two, so it is the one marked dangerous and
   * defaulted to Cancel: it moves the goalposts. Once the target matches what
   * the product currently earns, the channel stops being flagged — and a real
   * erosion afterwards has a lower bar to clear before anyone notices.
   */
  const resetTargets = async (r: ProductCostVariance) => {
    const moves = r.prices.filter((p) => p.alert);
    if (!moves.length) return;
    const ok = await confirm({
      title: 'Reset targets to the current margin',
      message:
        `${r.name} — move ${moves
          .map(
            (p) =>
              `${p.label} ${money(p.targetProfitPct ?? 0)}% → ${money(p.actualProfitPct)}%`,
          )
          .join(', ')}. This accepts the margin as it stands rather than ` +
        `correcting it, so the channel stops being flagged. Only do this if the ` +
        `new margin is what you now intend. Nothing is written until you press Save.`,
      confirmText: 'Reset targets',
      cancelText: 'Cancel',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const p of moves) {
        next[targetKeyOf(r.productId, p.key)] = p.actualProfitPct.toFixed(2);
      }
      return next;
    });
  };

  const save = async () => {
    if (!pending.length) return;
    const ok = await confirm({
      title: 'Save price review',
      message:
        `Update ${pending.length} product${pending.length === 1 ? '' : 's'}? ` +
        `A revised price also refreshes its profit % and the product's cost, so ` +
        `Recipe Master, Packing Master and the Product Master all agree. A reset ` +
        `target accepts the current margin as the intended one.`,
      confirmText: 'Save',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<RevisePricesResult>(
        '/products/costing/prices',
        {
          revisions: pending,
        },
      );
      toast.success(
        `${res.updated} product${res.updated === 1 ? '' : 's'} updated.`,
      );
      if (res.skippedLocked.length) {
        toast.error(`Skipped (locked): ${res.skippedLocked.join(', ')}`);
      }
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  // ---- cost application ----
  // A margin only means something against a current cost, so a sellable product
  // can have its cost refreshed here too — it is the input to the judgement the
  // screen exists to support.
  const costable = all.filter((r) => r.hasDrift && !r.emptyBom && !r.isLocked);

  const applyCosts = async () => {
    if (!costable.length) return;
    const ok = await confirm({
      title: 'Update cost prices',
      message:
        `Write the recomputed cost onto ${costable.length} product` +
        `${costable.length === 1 ? '' : 's'}? Only the cost is written — selling ` +
        `prices and their targets are left untouched.`,
      confirmText: 'Update costs',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<ApplyCostingResult>(
        '/products/costing/apply',
        {
          productIds: costable.map((r) => r.productId),
        },
      );
      toast.success(
        `Cost updated on ${res.updated} product${res.updated === 1 ? '' : 's'}.`,
      );
      if (res.skippedLocked.length) {
        toast.error(`Skipped (locked): ${res.skippedLocked.join(', ')}`);
      }
      await reload();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to update costs.',
      );
    } finally {
      setBusy(false);
    }
  };

  // ---- price cell ----
  const priceCell = (r: ProductCostVariance, key: PriceKey) => {
    const p = r.prices.find((x) => x.key === key);
    if (!p) return <span className="text-slate-300">—</span>;

    const ep = edits[priceKeyOf(r.productId, key)];
    const livePrice = ep != null ? num(ep) : p.price;
    const priceChanged = ep != null && round1(livePrice) !== round1(p.price);

    const et = edits[targetKeyOf(r.productId, key)];
    const liveTarget =
      et != null ? (et.trim() === '' ? null : num(et)) : p.targetProfitPct;
    const targetChanged = et != null && liveTarget !== p.targetProfitPct;

    // Both actuals recalculate as you type: one against the Product Master's
    // cost, one against the recomputed cost.
    const masterPct = profitPctAt(livePrice, r.storedCost);
    const costingPct = profitPctAt(livePrice, costBasisOf(r));
    const variance =
      liveTarget == null ? null : round1(costingPct - liveTarget);
    // Colour by how the margin sits against target. Without a tolerance nothing
    // "alerts", but the direction still shows — a channel short of target must
    // never read the same as one comfortably over it.
    const tone = varianceTone(variance, r.maxVariancePct);

    return (
      <div className="flex flex-col items-end gap-1">
        {canEdit ? (
          <input
            className={cn(
              'w-24 rounded border px-2 py-1 text-right text-sm tabular-nums',
              priceChanged
                ? 'border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40'
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
            )}
            type="number"
            min={0}
            step="any"
            value={shownPrice(r, key)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setCell(priceKeyOf(r.productId, key), e.target.value)
            }
            onBlur={(e) =>
              setCell(priceKeyOf(r.productId, key), toPrice(e.target.value))
            }
          />
        ) : (
          <span className="tabular-nums">{money(p.price)}</span>
        )}

        {/* target · master · costing — see the legend above the table */}
        <div className="flex items-center gap-1 text-[11px] tabular-nums">
          {canEdit ? (
            <input
              className={cn(
                'w-14 rounded border px-1 py-0.5 text-right text-[11px] tabular-nums',
                targetChanged
                  ? 'border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
              )}
              type="number"
              step="any"
              placeholder="—"
              title="Target profit % for this channel (blank = no target)"
              value={shownTarget(r, key)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                setCell(targetKeyOf(r.productId, key), e.target.value)
              }
            />
          ) : (
            <span className="text-slate-500">
              {liveTarget == null ? '—' : money(liveTarget)}
            </span>
          )}
          <span className="text-slate-300">·</span>
          <span
            className="text-slate-400"
            title="Margin at the Product Master's cost"
          >
            {money(masterPct)}
          </span>
          <span className="text-slate-300">·</span>
          <span
            className={cn('font-semibold', TONE_TEXT[tone])}
            title={
              variance == null
                ? 'Margin at the recomputed cost (no target set)'
                : `Margin at the recomputed cost — ${signed(variance)} against target`
            }
          >
            {TONE_MARK[tone]}
            {money(costingPct)}
          </span>
        </div>
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
            {r.hasAlert && (
              <TriangleAlert className="h-4 w-4 flex-none text-rose-500" />
            )}
            {r.name}
            {r.isLocked && <span title="Locked — not updated">🔒</span>}
          </div>
          <div className="text-xs text-slate-400">
            {r.code} · {r.basis === 'PACKING' ? 'Packing' : 'Recipe'}
            {r.maxVariancePct != null
              ? ` · ±${money(r.maxVariancePct)}%`
              : ' · exact target'}
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
      key: 'lastCostedAt',
      header: 'Last costed',
      className: 'whitespace-nowrap',
      // Sort by the timestamp; a never-costed product sorts oldest, which is
      // where it belongs in a review.
      sortAccessor: (r: ProductCostVariance) =>
        r.lastCostedAt ? new Date(r.lastCostedAt).getTime() : 0,
      render: (r: ProductCostVariance) => (
        <span
          className={cn(
            'text-xs',
            isCostStale(r.lastCostedAt)
              ? 'font-medium text-amber-600 dark:text-amber-400'
              : 'text-slate-400',
          )}
          title={
            r.lastCostedAt
              ? formatDateTime(r.lastCostedAt)
              : 'This cost has never been established from a BOM.'
          }
        >
          {costedAgo(r.lastCostedAt)}
        </span>
      ),
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
      header: PRICE_LABEL[key],
      headerClassName: 'text-right',
      className: 'text-right',
      sortable: false,
      render: (r: ProductCostVariance) => priceCell(r, key),
    })),
    {
      key: 'actions',
      header: '',
      sortable: false,
      className: 'w-28',
      // The row is dense with inputs, so the breakdown opens from an explicit
      // button rather than a row click that a stray tap could fire.
      render: (r: ProductCostVariance) => (
        <div className="flex items-center gap-0.5">
          <button
            title="Where this cost comes from"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
            onClick={(e) => {
              e.stopPropagation();
              setDetail(r);
            }}
          >
            <Info className="h-4 w-4" />
          </button>
          {canEdit && r.hasAlert && (
            <>
              <button
                title="Reprice: fill in the prices that hit each target margin"
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                onClick={(e) => {
                  e.stopPropagation();
                  void repriceToTarget(r);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                title="Reset target: accept the current margin as the intended one"
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                onClick={(e) => {
                  e.stopPropagation();
                  void resetTargets(r);
                }}
              >
                <Crosshair className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const tabs = TAB_ORDER.map((key) => ({
    key,
    ...TAB_META[key],
    count: groups[key].length,
  }));

  const note = TAB_META[tab].note;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Price Review"
        description="Products you sell — whether each channel still earns the margin it is meant to."
        icon={<Tags className="h-5 w-5" />}
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
                onClick={save}
              >
                {busy
                  ? 'Saving…'
                  : `Save${pending.length ? ` (${pending.length})` : ''}`}
              </button>
            </div>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            title={t.hint}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              tab === t.key
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
              t.key === 'alert' &&
                t.count > 0 &&
                tab !== t.key &&
                'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-300',
            )}
          >
            {t.key === 'alert' && t.count > 0 && (
              <TriangleAlert className="mr-1.5 inline h-4 w-4" />
            )}
            {t.label}
            <span className="ml-2 tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      <div
        className={cn(
          'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
          tab === 'empty'
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
            : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
        )}
      >
        {tab === 'empty' && (
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        )}
        <span>{note}</span>
      </div>

      {/* Legend — three percentages sit under every price and need naming. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          Under each price:
        </span>
        <span>
          <b className="text-slate-700 dark:text-slate-200">target %</b>{' '}
          (editable)
        </span>
        <span className="text-slate-300">·</span>
        <span>actual at Product Master cost</span>
        <span className="text-slate-300">·</span>
        <span>actual at recomputed cost</span>
        <span className="text-slate-300">|</span>
        {/* The colours carry the finding, so they are named rather than left to
            be inferred. Each swatch uses the class it describes. */}
        <span className={TONE_TEXT.ok}>● on target</span>
        <span className={TONE_TEXT.short}>▼ below target</span>
        <span className={TONE_TEXT.over}>▲ above target</span>
        <span className={TONE_TEXT.none}>● no target</span>
      </div>

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
            tab === 'alert'
              ? 'Every channel is earning a margin within its target tolerance.'
              : tab === 'drift'
                ? 'No costs have drifted.'
                : 'Nothing here.'
          }
        />
      </div>

      <CostBreakdownDrawer row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
