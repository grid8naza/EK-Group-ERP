'use client';

import { useMemo, useState } from 'react';
import { Plus, ClipboardList } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, CloseFooter } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import type {
  ProductionPlan,
  ProductionPlanStatus,
  Unit,
} from '@/lib/types';

const ROUTE = '/production/plans';

const statusColor = (s: ProductionPlanStatus) =>
  s === 'CONFIRMED' ? 'green' : s === 'CANCELLED' ? 'slate' : 'amber';
const statusLabel = (s: ProductionPlanStatus) =>
  s.charAt(0) + s.slice(1).toLowerCase();
const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

export default function ProductionPlansPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<ProductionPlan[]>(
    '/production-plans',
  );
  const { data: pending, refetch: refetchPending } = useFetch<{
    count: number;
  }>('/production-plans/pending-count');
  const { data: units } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, guardDelete, bulkLock } =
    useLock<ProductionPlan>({
      endpoint: '/production-plans',
      route: ROUTE,
      noun: 'production plan',
      nameOf: (p) => p.planNo,
      reload: () => {
        refetch();
        refetchPending();
      },
    });

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ProductionPlan | null>(null);
  const [creating, setCreating] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canView = can(ROUTE, 'view');
  const canDelete = can(ROUTE, 'delete');

  const unitById = useMemo(
    () => new Map((units ?? []).map((u) => [u.id, u])),
    [units],
  );
  const unitLabel = (id: number) => {
    const u = unitById.get(id);
    return u?.symbol ?? u?.code ?? '';
  };

  const pendingCount = pending?.count ?? 0;

  const openView = async (row: ProductionPlan) => {
    try {
      const full = await api.get<ProductionPlan>(`/production-plans/${row.id}`);
      setCurrent(full);
      setOpen(true);
    } catch {
      toast.error('Failed to open the plan.');
    }
  };

  const createPlan = async () => {
    if (pendingCount === 0) {
      toast.error('There are no pending work orders to plan.');
      return;
    }
    const ok = await confirm({
      title: 'New production plan?',
      message: `Club the ${pendingCount} pending work order${pendingCount === 1 ? '' : 's'} into a new plan? Demand is grouped by division and materials exploded from recipes.`,
      confirmText: 'Yes',
      cancelText: 'No',
    });
    if (!ok) return;
    setCreating(true);
    try {
      const plan = await api.post<ProductionPlan>('/production-plans', {});
      toast.success(`Plan ${plan.planNo} created.`);
      await Promise.all([refetch(), refetchPending()]);
      setCurrent(plan);
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create plan.');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (p: ProductionPlan) => {
    const ok = await confirm({
      title: 'Delete plan',
      message: `Delete ${p.planNo}? Its work orders return to the pending pool.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/production-plans/${p.id}`);
      toast.success('Plan deleted.');
      refetch();
      refetchPending();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Group the plan's product lines by division for the document view.
  const grouped = useMemo(() => {
    if (!current) return [];
    const map = new Map<string, ProductionPlan['lines']>();
    for (const l of current.lines) {
      const key = l.divisionName ?? 'Unassigned';
      (map.get(key) ?? map.set(key, []).get(key)!).push(l);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [current]);

  const columns: Column<ProductionPlan>[] = [
    { key: 'planNo', header: 'Plan', accessor: (r) => r.planNo },
    { key: 'planDate', header: 'Date', accessor: (r) => fmtDate(r.planDate) },
    {
      key: 'products',
      header: 'Products',
      accessor: (r) => String(r.lines.length),
    },
    {
      key: 'materials',
      header: 'Materials',
      accessor: (r) => String(r.materials.length),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Production Plan"
        description="Clubs the pending work orders, grouped by division, with materials from recipes"
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          canAdd && (
            <button
              className="btn-primary"
              onClick={createPlan}
              disabled={creating || pendingCount === 0}
              title={
                pendingCount === 0 ? 'No pending work orders to plan' : undefined
              }
            >
              <Plus className="h-4 w-4" /> New Plan
              {pendingCount > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[10px]">
                  {pendingCount}
                </span>
              )}
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={() => {
          refetch();
          refetchPending();
        }}
        searchPlaceholder="Search plans..."
        onView={openView}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canDelete={canDelete}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No production plans yet"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={current ? current.planNo : 'Production Plan'}
        subtitle="Production plan"
        icon={<ClipboardList className="h-5 w-5" />}
        footer={<CloseFooter onClose={() => setOpen(false)} />}
      >
        {current && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Plan date" value={fmt(current.planDate)} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </p>
                <div className="mt-1">
                  <Badge color={statusColor(current.status)}>
                    {statusLabel(current.status)}
                  </Badge>
                </div>
              </div>
              <Field
                label="Work orders"
                value={
                  current.workOrders && current.workOrders.length
                    ? current.workOrders.map((w) => w.orderNo).join(', ')
                    : '—'
                }
              />
              <Field label="Created" value={fmt(current.createdAt)} />
            </div>

            {/* Products to make, grouped by division */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                To produce — by division
              </p>
              <div className="space-y-4">
                {grouped.map(([division, lines]) => (
                  <div key={division}>
                    <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {division}
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {lines.map((l) => (
                          <tr
                            key={l.id}
                            className="border-b border-slate-100 dark:border-slate-800/60"
                          >
                            <td className="py-1.5 pr-2 text-slate-800 dark:text-slate-100">
                              {l.productName}
                            </td>
                            <td className="w-28 py-1.5 text-right tabular-nums">
                              {l.quantity.toLocaleString()}
                            </td>
                            <td className="w-14 py-1.5 pl-2 text-slate-500">
                              {unitLabel(l.unitId)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>

            {/* Material requirement */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Raw-material requirement
              </p>
              {current.materials.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No recipe materials — the planned products have no recipe BOM.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                      <th className="py-2 pr-2">Item</th>
                      <th className="w-28 py-2 text-right">Required</th>
                      <th className="w-14 py-2 pl-2">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.materials.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-slate-100 dark:border-slate-800/60"
                      >
                        <td className="py-1.5 pr-2 text-slate-800 dark:text-slate-100">
                          {m.itemName}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {m.quantity.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500">
                          {unitLabel(m.unitId)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}
