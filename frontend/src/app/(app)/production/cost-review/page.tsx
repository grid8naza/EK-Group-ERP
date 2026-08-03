'use client';

import { useMemo, useState } from 'react';
import { Scale, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { CostBreakdownDrawer } from '@/components/production/CostBreakdownDrawer';
import { costedAgo, isCostStale, money, signed } from '@/lib/costing';
import type { ApplyCostingResult, ProductCostVariance } from '@/lib/types';

const ROUTE = '/production/cost-review';

/**
 * The three states a NOT-SOLD product can be in. There is no margin tab here:
 * a semi-finished intermediate carries no selling price, so cost is the whole
 * review. Its cost still matters — it is what the packed product built from it
 * is costed against.
 *
 *  - drift  : the recipe now costs something other than the Product Master holds
 *  - inStep : recomputes to exactly what is stored
 *  - empty  : no BOM entered, so it recomputes to zero. Not a finding, and NOT
 *             updatable — zero would destroy a hand-entered cost.
 */
type Tab = 'drift' | 'inStep' | 'empty';

export default function CostReviewPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<ProductCostVariance[]>(
    '/products/costing/variance',
  );

  const [tab, setTab] = useState<Tab>('drift');
  const [detail, setDetail] = useState<ProductCostVariance | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const canEdit = can(ROUTE, 'edit');

  // Products that are NOT sold. Anything sellable is reviewed on price — where
  // its cost is shown too, since a margin is meaningless without one.
  const all = useMemo(() => (data ?? []).filter((r) => !r.canSell), [data]);

  const groups = useMemo(
    () => ({
      drift: all.filter((r) => r.hasDrift && !r.emptyBom),
      inStep: all.filter((r) => !r.hasDrift && !r.emptyBom),
      empty: all.filter((r) => r.emptyBom),
    }),
    [all],
  );
  const rows = groups[tab];
  const costable = groups.drift.filter((r) => !r.isLocked);

  const applyCosts = async () => {
    if (!costable.length) return;
    const ok = await confirm({
      title: 'Update cost prices',
      message:
        `Write the recomputed cost onto ${costable.length} product` +
        `${costable.length === 1 ? '' : 's'}? These are not sold, so no selling ` +
        `price is affected — but any packed product made from them is costed ` +
        `against these figures.`,
      confirmText: 'Update costs',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<ApplyCostingResult>('/products/costing/apply', {
        productIds: costable.map((r) => r.productId),
      });
      toast.success(
        `Cost updated on ${res.updated} product${res.updated === 1 ? '' : 's'}.`,
      );
      if (res.skippedLocked.length) {
        toast.error(`Skipped (locked): ${res.skippedLocked.join(', ')}`);
      }
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update costs.');
    } finally {
      setBusy(false);
    }
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
              ? new Date(r.lastCostedAt).toLocaleString()
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
      render: (r) => money(r.computedCost),
    },
    {
      key: 'costDelta',
      header: 'Difference',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortAccessor: (r) => r.costDelta,
      render: (r) =>
        r.emptyBom ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span
            className={cn(
              'font-semibold',
              r.costDelta > 0 && 'text-rose-600 dark:text-rose-400',
              r.costDelta < 0 && 'text-emerald-600 dark:text-emerald-400',
              r.costDelta === 0 && 'text-slate-400',
            )}
          >
            {signed(r.costDelta)}
          </span>
        ),
    },
  ];

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'drift', label: 'Cost drifted', count: groups.drift.length },
    { key: 'inStep', label: 'In step', count: groups.inStep.length },
    { key: 'empty', label: 'No BOM yet', count: groups.empty.length },
  ];

  const note =
    tab === 'drift'
      ? 'The recipe now costs something other than what the Product Master holds. These products are not sold, so no selling price is at stake — but each one is a source for the packed products made from it, and their cost is worked out from this figure. Review, then update.'
      : tab === 'inStep'
        ? 'Cost matches the Product Master. Nothing to do.'
        : 'No recipe has been entered for these, so there is nothing to cost from and they recompute to zero. Any cost shown was typed into the Product Master by hand; it cannot be updated here, because writing zero over it would lose it. Enter the recipe in Recipe Master instead.';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cost Review"
        description="Products you do not sell — whether each one still costs what the Product Master says it does."
        icon={<Scale className="h-5 w-5" />}
        actions={
          canEdit && tab === 'drift' ? (
            <button
              className="btn-primary"
              disabled={!costable.length || busy}
              onClick={applyCosts}
            >
              {busy
                ? 'Updating…'
                : `Update costs${costable.length ? ` (${costable.length})` : ''}`}
            </button>
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
            )}
          >
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
        {tab === 'empty' && <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />}
        <span>{note}</span>
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
          onRefresh={refetch}
          onRowClick={(r) => setDetail(r)}
          emptyMessage={
            tab === 'drift' ? 'Every cost matches the Product Master.' : 'Nothing here.'
          }
        />
      </div>

      <CostBreakdownDrawer row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
