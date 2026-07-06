'use client';

import { useState } from 'react';
import { Inbox, Clock, Send, X, Check, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type {
  WorkflowTaskItem,
  WorkflowInstanceDetail,
} from '@/lib/types';

/** Compact relative time, falling back to a short date for older items. */
function relativeTime(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value).slice(0, 10);
}

const docLabel = (t: Pick<WorkflowTaskItem, 'documentRef' | 'documentId'>) =>
  t.documentRef || `#${t.documentId}`;

const money = (n?: number | null) =>
  n == null ? '' : n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function MyApprovalsPage() {
  const toast = useToast();
  const { data, loading, refetch } = useFetch<WorkflowTaskItem[]>(
    '/workflow/my-tasks',
  );

  const [active, setActive] = useState<WorkflowTaskItem | null>(null);
  const [detail, setDetail] = useState<WorkflowInstanceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const openTask = async (t: WorkflowTaskItem) => {
    setActive(t);
    setDetail(null);
    setRejecting(false);
    setReason('');
    setDetailLoading(true);
    try {
      const d = await api.get<WorkflowInstanceDetail>(
        `/workflow/instances/${t.instanceId}`,
      );
      setDetail(d);
    } catch {
      // Timeline is best-effort; the action buttons still work without it.
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDrawer = () => {
    setActive(null);
    setDetail(null);
    setRejecting(false);
    setReason('');
  };

  const act = async (
    action: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE',
    comment?: string,
  ) => {
    if (!active) return;
    setActing(true);
    try {
      await api.post(`/workflow/tasks/${active.taskId}/act`, {
        action,
        ...(comment ? { comment } : {}),
      });
      toast.success(
        action === 'REJECT'
          ? 'Document rejected.'
          : action === 'CANCEL'
            ? 'Document cancelled.'
            : action === 'FORWARD'
              ? 'Forwarded for higher approval.'
              : 'Document approved.',
      );
      closeDrawer();
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setActing(false);
    }
  };

  const submitReject = () => {
    if (!reason.trim()) {
      toast.error('A reason is required to reject.');
      return;
    }
    void act('REJECT', reason.trim());
  };

  const columns: Column<WorkflowTaskItem>[] = [
    {
      key: 'document',
      header: 'Document',
      accessor: (r) => docLabel(r),
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {docLabel(r)}
        </span>
      ),
    },
    { key: 'workflow', header: 'Workflow', accessor: (r) => r.workflowName },
    {
      key: 'step',
      header: 'Step',
      accessor: (r) => r.sequence,
      render: (r) => <Badge color="blue">Step {r.sequence}</Badge>,
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      sortAccessor: (r) => r.amount ?? null,
      render: (r) => (r.amount != null ? money(r.amount) : '-'),
    },
    {
      key: 'received',
      header: 'Received',
      sortAccessor: (r) => r.createdAt,
      accessor: (r) => relativeTime(r.createdAt),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="My Approvals"
        description="Documents awaiting your action"
        icon={<Inbox className="h-5 w-5" />}
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.taskId}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search documents..."
        defaultSort={{ key: 'received', dir: 'desc' }}
        onView={openTask}
        canView
        canEdit={false}
        canDelete={false}
        emptyMessage="No pending approvals."
      />

      <Drawer
        open={!!active}
        onClose={closeDrawer}
        title={active ? docLabel(active) : 'Approval'}
        subtitle={active?.workflowName}
        icon={<Inbox className="h-5 w-5" />}
        width="md"
        footer={
          active && (
            <div className="flex flex-col gap-3">
              {!active.canApprove && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                  Value beyond your limit — forward for higher approval.
                </p>
              )}
              {rejecting ? (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setRejecting(false);
                      setReason('');
                    }}
                    disabled={acting}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={submitReject}
                    disabled={acting}
                  >
                    {acting ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {active.canCancel && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void act('CANCEL')}
                      disabled={acting}
                    >
                      <X className="h-4 w-4" /> Cancel
                    </button>
                  )}
                  {active.canReject && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => setRejecting(true)}
                      disabled={acting}
                    >
                      <X className="h-4 w-4" /> Reject
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() =>
                      void act(active.canApprove ? 'APPROVE' : 'FORWARD')
                    }
                    disabled={acting}
                  >
                    {active.canApprove ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {acting
                      ? 'Working...'
                      : active.canApprove
                        ? active.buttonText
                        : `${active.buttonText} (Forward)`}
                  </button>
                </div>
              )}
            </div>
          )
        }
      >
        {active && (
          <div className="space-y-5">
            {/* Document summary */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Document
                  </p>
                  <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
                    {docLabel(active)}
                  </p>
                </div>
                {active.amount != null && (
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Amount
                    </p>
                    <p className="text-base font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {money(active.amount)}
                    </p>
                  </div>
                )}
              </div>
              {detail?.startedByName && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Started by {detail.startedByName}
                </p>
              )}
            </div>

            {rejecting && (
              <Textarea
                label="Reason for rejection"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this document is being rejected..."
              />
            )}

            {/* Timeline */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Timeline
              </h3>
              {detailLoading ? (
                <p className="text-sm text-slate-400">Loading timeline...</p>
              ) : detail && detail.timeline.length > 0 ? (
                <ol className="space-y-4">
                  {detail.timeline.map((entry) => (
                    <li key={entry.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                          <Clock className="h-3.5 w-3.5" />
                        </span>
                        <span className="mt-1 w-px flex-1 bg-slate-200 dark:bg-slate-800" />
                      </div>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {entry.userName}
                          </span>
                          <Badge color="slate">{entry.action}</Badge>
                        </div>
                        {entry.comment && (
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {entry.comment}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDate(entry.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-400">No history yet.</p>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
