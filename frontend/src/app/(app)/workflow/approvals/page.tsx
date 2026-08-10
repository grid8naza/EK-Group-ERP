'use client';

import { useRouter } from 'next/navigation';
import { ExternalLink, Inbox } from 'lucide-react';
import { DOC_PARAM, useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { WorkflowTaskItem } from '@/lib/types';

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

/**
 * My Approvals — what is waiting on this person, and the way to each of them.
 *
 * A worklist, not a place to approve from. Opening a row takes the approver to
 * the document on its own screen, where they can read it and act there.
 *
 * That is not merely nicer; it is the only correct arrangement. What approval
 * MEANS belongs to the module that owns the document — a voucher reaches the
 * books, an approved ICPO becomes a sales order — and the engine cannot reach a
 * module to make any of it happen. Acting here talked to the engine alone, so
 * the workflow completed while the document sat untouched: a voucher approved
 * by everybody, never posted, and past the point where it could be submitted,
 * withdrawn or posted by hand. Sending the approver to the document means the
 * module's own approval path runs, which is the one that knows what to do.
 *
 * It also means nobody approves a figure they have not seen. The row shows a
 * reference and an amount; the voucher shows the entry.
 */
export default function MyApprovalsPage() {
  const router = useRouter();
  const toast = useToast();
  const { data, loading, refetch } = useFetch<WorkflowTaskItem[]>(
    '/workflow/my-tasks',
  );

  const openDocument = (t: WorkflowTaskItem) => {
    if (!t.route) {
      // A form with no route is a workflow bound to something that has no
      // screen. Better said plainly than by a button that does nothing.
      toast.error(
        `${docLabel(t)} has no screen to open — check the form this workflow is bound to.`,
      );
      return;
    }
    router.push(`${t.route}?${DOC_PARAM}=${t.documentId}`);
  };

  const columns: Column<WorkflowTaskItem>[] = [
    {
      key: 'document',
      header: 'Document',
      accessor: (r) => `${docLabel(r)} ${r.documentType ?? ''}`,
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800 dark:text-slate-100">
            {docLabel(r)}
          </div>
          {r.documentType && (
            <div className="text-xs text-slate-400">{r.documentType}</div>
          )}
        </div>
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
      key: 'waiting',
      header: 'Waiting for',
      accessor: (r) => r.buttonText,
      render: (r) => (
        <span className="text-slate-600 dark:text-slate-300">
          {r.buttonText}
          {/* Said here rather than only on the document, so somebody working
              through a list knows which ones they can finish themselves. */}
          {!r.canApprove && (
            <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
              beyond your limit — review and pass up
            </span>
          )}
        </span>
      ),
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
    {
      key: 'open',
      header: '',
      sortable: false,
      className: 'w-28',
      render: (r) => (
        <button
          className="btn-secondary whitespace-nowrap px-3 py-1 text-xs"
          title="Open the document to read it and act on it"
          onClick={(e) => {
            e.stopPropagation();
            openDocument(r);
          }}
        >
          <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
          Open
        </button>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="My Approvals"
        description="Documents awaiting your action — open one to read it and decide"
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
        onView={openDocument}
        canView
        canEdit={false}
        canDelete={false}
        emptyMessage="No pending approvals."
      />
    </div>
  );
}
