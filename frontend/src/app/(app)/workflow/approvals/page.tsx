'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ExternalLink, GitBranch, Inbox, Search } from 'lucide-react';
import { DOC_PARAM, useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
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

/** Everything one branch of one company is waiting on this person for. */
interface BranchGroup {
  key: string;
  branchName: string;
  tasks: WorkflowTaskItem[];
}
interface CompanyGroup {
  companyId: number | null;
  companyName: string;
  isActive: boolean;
  count: number;
  branches: BranchGroup[];
}

/**
 * My Approvals — everything waiting on this person, wherever it is.
 *
 * ONE list across every company and branch. The inbox has always been scoped to
 * the person rather than to the active company — a task is assigned to a user,
 * not to a company — but the flat list left that invisible: ten payments from
 * four branches of two companies read as ten numbers, and a director had to
 * switch company to find out what was waiting there.
 *
 * So the grouping is the point of the screen, not decoration. Company, then
 * branch within it, each headed and counted, with the company being worked in
 * first because that is where most of the work is.
 *
 * Seeing is one thing and ACTING is another: a document can only be opened in
 * its own company, so opening one from elsewhere offers the switch. That is a
 * deliberate stop rather than an oversight — the company decides what a screen
 * shows, and moving somebody between companies without asking would change the
 * whole application under them.
 */
export default function MyApprovalsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { activeCompanyId, switchCompany } = useAuth();
  const { data, loading, refetch } = useFetch<WorkflowTaskItem[]>(
    '/workflow/my-tasks',
  );
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((t) =>
      [
        docLabel(t),
        t.documentType,
        t.workflowName,
        t.companyName,
        t.branchName,
        t.buttonText,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

  /**
   * Grouped, with the company being worked in at the top and — inside each —
   * company-wide documents before the branches. Everything else alphabetical,
   * so the same list is in the same order every time it is opened.
   */
  const groups = useMemo((): CompanyGroup[] => {
    const byCompany = new Map<number | null, WorkflowTaskItem[]>();
    for (const t of rows) {
      const id = t.companyId ?? null;
      byCompany.set(id, [...(byCompany.get(id) ?? []), t]);
    }
    return [...byCompany.entries()]
      .map(([companyId, list]) => {
        const byBranch = new Map<string, WorkflowTaskItem[]>();
        for (const t of list) {
          const name = t.branchName ?? '';
          byBranch.set(name, [...(byBranch.get(name) ?? []), t]);
        }
        return {
          companyId,
          companyName: list[0]?.companyName ?? 'Unknown company',
          isActive: companyId != null && companyId === activeCompanyId,
          count: list.length,
          branches: [...byBranch.entries()]
            .map(([branchName, tasks]) => ({
              key: branchName || '—',
              branchName,
              tasks: [...tasks].sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
              ),
            }))
            .sort((a, b) => a.branchName.localeCompare(b.branchName)),
        };
      })
      .sort((a, b) =>
        a.isActive === b.isActive
          ? a.companyName.localeCompare(b.companyName)
          : a.isActive
            ? -1
            : 1,
      );
  }, [rows, activeCompanyId]);

  const openDocument = async (t: WorkflowTaskItem) => {
    if (!t.route) {
      // A form with no route is a workflow bound to something that has no
      // screen. Better said plainly than by a button that does nothing.
      toast.error(
        `${docLabel(t)} has no screen to open — check the form this workflow is bound to.`,
      );
      return;
    }
    // A document is only readable in ITS company. Asked rather than switched
    // silently: changing the active company changes the whole application.
    if (t.companyId && t.companyId !== activeCompanyId) {
      const ok = await confirm({
        title: `Switch to ${t.companyName ?? 'that company'}?`,
        message:
          `${docLabel(t)} belongs to ${t.companyName ?? 'another company'}, and can only be opened there. ` +
          `Switch to it and open the document?`,
        confirmText: 'Switch and open',
        cancelText: 'Stay here',
      });
      if (!ok) return;
      try {
        await switchCompany(t.companyId);
      } catch {
        toast.error('Could not switch company.');
        return;
      }
    }
    router.push(`${t.route}?${DOC_PARAM}=${t.documentId}`);
  };

  const total = rows.length;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="My Approvals"
        description="Everything waiting on you, in every company and branch — open one to read it and decide"
        icon={<Inbox className="h-5 w-5" />}
        actions={
          <button className="btn-secondary" onClick={refetch}>
            Refresh
          </button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {total} waiting on you
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search document, kind, workflow, company or branch…"
            className="input-base w-80 pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-6">
        {loading && (
          <p className="text-sm text-slate-400">Loading…</p>
        )}
        {!loading && total === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-800">
            {search ? 'Nothing matches that.' : 'Nothing is waiting on you.'}
          </p>
        )}

        {groups.map((g) => (
          <section key={g.companyId ?? 'none'}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
              <Building2 className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {g.companyName}
              </h2>
              <Badge color={g.isActive ? 'green' : 'slate'}>
                {g.count} waiting
              </Badge>
              {/* Where they are NOT working. Opening one of these asks to move
                  them first, so it is worth knowing before they click. */}
              {!g.isActive && (
                <span className="text-xs text-slate-400">
                  opening these switches you to {g.companyName}
                </span>
              )}
            </div>

            {g.branches.map((b) => (
              <div key={b.key} className="mt-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <GitBranch className="h-3 w-3" />
                  {b.branchName || 'No branch'}
                  <span className="normal-case tracking-normal">
                    · {b.tasks.length}
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {b.tasks.map((t) => (
                        <tr
                          key={t.taskId}
                          className="bg-white transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-800 dark:text-slate-100">
                              {docLabel(t)}
                            </div>
                            <div className="text-xs text-slate-400">
                              {[t.documentType, t.workflowName]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Badge color="blue">Step {t.sequence}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                            {t.buttonText}
                            {/* Said on the row so somebody working through a
                                list knows which they can finish themselves. */}
                            {!t.canApprove && (
                              <div className="text-xs text-amber-600 dark:text-amber-400">
                                beyond your limit — review and pass up
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {t.amount != null ? money(t.amount) : '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-400">
                            {relativeTime(t.createdAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              className="btn-secondary whitespace-nowrap px-3 py-1 text-xs"
                              title="Open the document to read it and act on it"
                              onClick={() => void openDocument(t)}
                            >
                              <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
