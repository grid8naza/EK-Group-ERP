'use client';

import { useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
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
import { Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  MaterialRequest,
  MaterialRequestStatus,
  Unit,
} from '@/lib/types';

const ROUTE = '/production/material-requests';

const statusColor = (s: MaterialRequestStatus) =>
  s === 'ISSUED' ? 'green' : s === 'CANCELLED' ? 'slate' : 'amber';
const statusLabel = (s: MaterialRequestStatus) =>
  s.charAt(0) + s.slice(1).toLowerCase();
const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

const shortCount = (mr: MaterialRequest) =>
  mr.lines.filter((l) => l.requiredQty > l.availableQty).length;

export default function MaterialRequestsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<MaterialRequest[]>(
    '/material-requests',
  );
  const { data: units } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, guardDelete, bulkLock } =
    useLock<MaterialRequest>({
      endpoint: '/material-requests',
      route: ROUTE,
      noun: 'material request',
      nameOf: (m) => m.requestNo,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<MaterialRequest | null>(null);
  const [busy, setBusy] = useState(false);
  // What the store is handing over, per line id, while the issue is being keyed.
  const [issueQty, setIssueQty] = useState<Record<number, string>>({});

  const canView = can(ROUTE, 'view');
  const canDelete = can(ROUTE, 'delete');
  const canEdit = can(ROUTE, 'edit');

  const unitById = useMemo(
    () => new Map((units ?? []).map((u) => [u.id, u])),
    [units],
  );
  const unitLabel = (id: number) => {
    const u = unitById.get(id);
    return u?.symbol ?? u?.code ?? '';
  };

  // Only an open, unlocked request can still be handed over — once issued the
  // stock has moved, so the quantities become a record rather than an entry.
  const issuing =
    !!current && canEdit && current.status === 'DRAFT' && !current.isLocked;

  const openView = async (row: MaterialRequest) => {
    try {
      const full = await api.get<MaterialRequest>(`/material-requests/${row.id}`);
      setCurrent(full);
      // Default to what the store can actually give: the requirement, capped by
      // what was on hand. A store issuing more than it holds is refused anyway.
      setIssueQty(
        Object.fromEntries(
          full.lines.map((l) => [
            l.id,
            String(Math.min(l.requiredQty, l.availableQty)),
          ]),
        ),
      );
      setOpen(true);
    } catch {
      toast.error('Failed to open the request.');
    }
  };

  const remove = async (m: MaterialRequest) => {
    const ok = await confirm({
      title: 'Delete material request',
      message: `Delete ${m.requestNo}?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/material-requests/${m.id}`);
      toast.success('Material request deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  /** Hand the materials over — this is what takes them out of store stock. */
  const issue = async () => {
    if (!current) return;
    const lines = current.lines.map((l) => ({
      lineId: l.id,
      issuedQty: Number(issueQty[l.id] ?? 0) || 0,
    }));
    if (!lines.some((l) => l.issuedQty > 0)) {
      toast.error('Enter what the store is issuing.');
      return;
    }
    const ok = await confirm({
      title: 'Issue materials',
      message:
        `Issue ${lines.filter((l) => l.issuedQty > 0).length} item(s) from ` +
        `${current.storeName ?? 'the store'}? This takes them out of stock.`,
      confirmText: 'Issue',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const upd = await api.post<MaterialRequest>(
        `/material-requests/${current.id}/issue`,
        { lines },
      );
      setCurrent(upd);
      toast.success(`Materials issued${upd.issueNo ? ` (${upd.issueNo})` : ''}.`);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to issue.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: MaterialRequestStatus) => {
    if (!current) return;
    setBusy(true);
    try {
      const upd = await api.patch<MaterialRequest>(
        `/material-requests/${current.id}/status`,
        { status },
      );
      setCurrent({ ...current, status: upd.status });
      toast.success('Material request updated.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<MaterialRequest>[] = [
    { key: 'requestNo', header: 'Request', accessor: (r) => r.requestNo },
    { key: 'planNo', header: 'Plan', accessor: (r) => r.planNo ?? '—' },
    {
      key: 'division',
      header: 'Division',
      accessor: (r) => r.divisionName ?? 'Unassigned',
    },
    { key: 'store', header: 'Store', accessor: (r) => r.storeName ?? '—' },
    {
      key: 'items',
      header: 'Items',
      render: (r) => {
        const short = shortCount(r);
        return (
          <span>
            {r.lines.length}
            {short > 0 && (
              <Badge color="red" className="ml-2">
                {short} short
              </Badge>
            )}
          </span>
        );
      },
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
        title="Material Request"
        description="Raw materials requested from the store for each division — raised from a production plan"
        icon={<ClipboardCheck className="h-5 w-5" />}
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search material requests..."
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
        emptyMessage="No material requests yet"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={current ? current.requestNo : 'Material Request'}
        subtitle="Store requisition"
        icon={<ClipboardCheck className="h-5 w-5" />}
        footer={<CloseFooter onClose={() => setOpen(false)} />}
      >
        {current && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field
                label="Division"
                value={current.divisionName ?? 'Unassigned'}
              />
              <Field label="Plan" value={current.planNo ?? '—'} />
              <Field label="Store" value={current.storeName ?? '—'} />
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
              <Field label="Raised" value={fmt(current.createdAt)} />
              {current.status === 'ISSUED' && (
                <>
                  <Field label="Goods issue" value={current.issueNo ?? '—'} />
                  <Field label="Issued" value={fmt(current.issuedAt)} />
                </>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                    <th className="py-2 pr-2">Item</th>
                    <th className="w-24 py-2 text-right">Required</th>
                    <th className="w-24 py-2 text-right">In store</th>
                    <th className="w-24 py-2 text-right">Short</th>
                    {(issuing || current.status === 'ISSUED') && (
                      <th className="w-28 py-2 text-right">Issued</th>
                    )}
                    <th className="w-12 py-2 pl-2">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {current.lines.map((l) => {
                    const short = Math.max(0, l.requiredQty - l.availableQty);
                    return (
                      <tr
                        key={l.id}
                        className="border-b border-slate-100 dark:border-slate-800/60"
                      >
                        <td className="py-1.5 pr-2 text-slate-800 dark:text-slate-100">
                          {l.itemName}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {l.requiredQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-500">
                          {l.availableQty.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {short > 0 ? (
                            <span className="font-medium text-rose-600 dark:text-rose-400">
                              {short.toLocaleString(undefined, {
                                maximumFractionDigits: 3,
                              })}
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              0
                            </span>
                          )}
                        </td>
                        {issuing && (
                          <td className="py-1 pl-2">
                            <Input
                              type="number"
                              min={0}
                              max={l.requiredQty}
                              step="any"
                              value={issueQty[l.id] ?? ''}
                              onChange={(e) =>
                                setIssueQty((q) => ({
                                  ...q,
                                  [l.id]: e.target.value,
                                }))
                              }
                              className="text-right tabular-nums"
                            />
                          </td>
                        )}
                        {!issuing && current.status === 'ISSUED' && (
                          <td className="py-1.5 text-right tabular-nums">
                            {l.issuedQty.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                            {l.issuedQty < l.requiredQty && (
                              <span className="ml-1 text-xs text-amber-600 dark:text-amber-500">
                                short
                              </span>
                            )}
                          </td>
                        )}
                        <td className="py-1.5 pl-2 text-slate-500">
                          {unitLabel(l.unitId)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {issuing && (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                <button className="btn-primary" onClick={issue} disabled={busy}>
                  Issue materials
                </button>
                <button
                  className="btn-ghost text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => setStatus('CANCELLED')}
                  disabled={busy}
                >
                  Cancel request
                </button>
                <p className="w-full text-xs text-slate-400">
                  Issuing takes these quantities out of{' '}
                  {current.storeName ?? 'the store'}. Issue less than required
                  when the store hands over short — only what is issued leaves
                  stock.
                </p>
              </div>
            )}
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
