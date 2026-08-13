'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckSquare,
  ClipboardList,
  LayoutGrid,
  List,
  MessageSquare,
  Plus,
  Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/workplace/people';
import { TaskComposer } from '@/components/workplace/TaskComposer';
import { TaskDrawer } from '@/components/workplace/TaskDrawer';
import {
  COLUMNS,
  dueLabel,
  PRIORITY_TONE,
  type TaskSide,
} from '@/components/workplace/task-ui';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, TasksElsewhere } from '@/lib/types';

/**
 * A task board (SRS §8.12, FR-TSK-01 / FR-TSK-03).
 *
 * One component for both sides of the work: "Assigned to Me" is what this
 * person owes, "Assigned by Me" is what they are owed. Same cards, same
 * columns, same drawer — only the side differs, because a task looks the same
 * whichever end of it you are holding.
 *
 * The board is scoped to the company being worked in, and to the active branch
 * where there is one, because that is what the requirement asks for: a branch
 * works from the branch's board. That is right for a board and wrong for a
 * person, so anything waiting in another company is counted under the toolbar
 * rather than silently missing.
 */
export function TaskScreen({ side }: { side: TaskSide }) {
  const { user, activeCompanyId } = useAuth();
  const toast = useToast();
  const myId = user?.id ?? 0;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [elsewhere, setElsewhere] = useState<TasksElsewhere[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  // See components/workplace/MailboxScreen for why the toast helpers are held
  // in a ref rather than depended on: the provider's value is not memoized.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ scope: side });
      if (search.trim()) qs.set('q', search.trim());
      const [list, other] = await Promise.all([
        api.get<Task[]>(`/tasks?${qs}`),
        api.get<TasksElsewhere[]>(`/tasks/elsewhere?scope=${side}`),
      ]);
      setTasks(list);
      setElsewhere(other);
    } catch (e) {
      toastRef.current.error(
        e instanceof Error ? e.message : 'The board could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [search, side]);

  // Typing waits for a pause rather than querying per letter. Re-runs when the
  // company changes, because the board belongs to a company.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load, activeCompanyId]);

  /** Replace one task in place — every write returns the whole task back. */
  const put = (task: Task) =>
    setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));

  const move = async (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    // Moved on the board first, put back if the server disagrees: a card that
    // hangs where it was dropped feels broken even when nothing is wrong.
    const before = task;
    put({ ...task, status });
    try {
      put(await api.post<Task>(`/tasks/${task.id}/status`, { status }));
    } catch (e) {
      put(before);
      toastRef.current.error(
        e instanceof Error ? e.message : 'That could not be moved.',
      );
    }
  };

  const open = tasks.find((t) => t.id === openId) ?? null;
  const isMineSide = side === 'by-me';

  return (
    <>
      {/* ------------------------------------------------------------ toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="input-base w-72 pl-8"
          />
        </div>

        <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
          {(
            [
              { key: 'board', icon: LayoutGrid, label: 'Board' },
              { key: 'list', icon: List, label: 'List' },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition',
                view === v.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          ))}
        </div>

        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {tasks.length} {isMineSide ? 'given out' : 'on you'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary" onClick={() => void load()}>
            Refresh
          </button>
          <button className="btn-primary" onClick={() => setComposing(true)}>
            <Plus className="mr-1.5 inline h-4 w-4" />
            New task
          </button>
        </div>
      </div>

      {/* Work of this kind in companies they are not looking at. The board is
          company-scoped by requirement; this is what stops that being silent. */}
      {elsewhere.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Building2 className="h-3.5 w-3.5" />
          Also open elsewhere:
          {elsewhere.map((e) => (
            <span
              key={e.companyId}
              className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800"
            >
              {e.companyName} · {e.count}
            </span>
          ))}
          <span className="text-slate-400">
            — switch company at the top to work on those
          </span>
        </div>
      )}

      {loading && tasks.length === 0 && (
        <p className="text-sm text-slate-400">Loading…</p>
      )}

      {/* -------------------------------------------------------------- board */}
      {view === 'board' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto pb-6 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const cards = tasks.filter((t) => t.status === col.status);
            return (
              <div
                key={col.status}
                onDragOver={(e) => {
                  // Only a drop target while something is actually being
                  // dragged from this board.
                  if (dragId != null) e.preventDefault();
                }}
                onDrop={() => {
                  const task = tasks.find((t) => t.id === dragId);
                  setDragId(null);
                  if (task) void move(task, col.status);
                }}
                className="flex min-h-[12rem] flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40"
              >
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={cn('h-2 w-2 rounded-full', col.tone)} />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {col.label}
                  </h3>
                  <span className="text-xs text-slate-400">{cards.length}</span>
                </div>

                <div className="space-y-2">
                  {cards.map((t) => (
                    <article
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setOpenId(t.id)}
                      className={cn(
                        'cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-brand-300 hover:shadow dark:border-slate-800 dark:bg-slate-900',
                        dragId === t.id && 'opacity-40',
                      )}
                    >
                      <TaskCard task={t} side={side} myId={myId} />
                    </article>
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-slate-400">
                      Nothing here
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --------------------------------------------------------------- list */}
      {view === 'list' && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {tasks.length === 0 && !loading ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-800">
              {search
                ? 'Nothing matches that.'
                : isMineSide
                  ? 'You have not given anybody a task yet.'
                  : 'Nothing has been assigned to you.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {tasks.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setOpenId(t.id)}
                      className="cursor-pointer bg-white transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800 dark:text-slate-100">
                          {t.title}
                        </div>
                        <div className="text-xs text-slate-400">
                          {isMineSide
                            ? t.assignees.length
                              ? `for ${t.assignees.map((a) => a.name).join(', ')}`
                              : 'for nobody yet'
                            : `from ${t.createdByName}`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Badge
                          color={
                            t.status === 'DONE'
                              ? 'green'
                              : t.status === 'BLOCKED'
                                ? 'amber'
                                : t.status === 'IN_PROGRESS'
                                  ? 'blue'
                                  : 'slate'
                          }
                        >
                          {COLUMNS.find((c) => c.status === t.status)?.label ??
                            'Cancelled'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-medium',
                            PRIORITY_TONE[t.priority],
                          )}
                        >
                          {t.priority.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                        {t.dueAt ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1',
                              t.isOverdue
                                ? 'font-medium text-rose-600 dark:text-rose-400'
                                : 'text-slate-500',
                            )}
                          >
                            {t.isOverdue ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : (
                              <Calendar className="h-3 w-3" />
                            )}
                            {dueLabel(t.dueAt)}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-400">
                        {t.checklistTotal > 0 &&
                          `${t.checklistDone}/${t.checklistTotal}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <TaskComposer
        open={composing}
        side={side}
        onClose={() => setComposing(false)}
        onCreated={(t) => {
          setComposing(false);
          // Only lands on THIS board when it is this person's side of it —
          // work given to somebody else does not belong on "assigned to me".
          if (side === 'by-me' || t.isForMe) setTasks((list) => [t, ...list]);
        }}
      />

      <TaskDrawer
        task={open}
        onClose={() => setOpenId(null)}
        onChanged={put}
        onRemoved={(id) => {
          setTasks((list) => list.filter((t) => t.id !== id));
          setOpenId(null);
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------- card --

function TaskCard({
  task,
  side,
  myId,
}: {
  task: Task;
  side: TaskSide;
  myId: number;
}) {
  return (
    <>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
          {task.title}
        </h4>
        {task.priority !== 'NORMAL' && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
              PRIORITY_TONE[task.priority],
            )}
          >
            {task.priority}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        {task.dueAt && (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              task.isOverdue && 'font-medium text-rose-600 dark:text-rose-400',
            )}
          >
            {task.isOverdue ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Calendar className="h-3 w-3" />
            )}
            {dueLabel(task.dueAt)}
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span className="inline-flex items-center gap-1">
            <CheckSquare className="h-3 w-3" />
            {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {task.commentCount}
          </span>
        )}
        {task.branchId === null && (
          <span className="inline-flex items-center gap-1" title="Company-wide">
            <Building2 className="h-3 w-3" />
            company
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Who it is ON, on the board of work given out; who it is FROM, on
            your own board. Either way, the face you would ask about it. */}
        <div className="flex -space-x-1.5">
          {side === 'by-me' ? (
            task.assignees.length ? (
              task.assignees.slice(0, 4).map((a) => (
                <span key={a.id} title={a.name}>
                  <Avatar name={a.name} id={a.id} size="sm" />
                </span>
              ))
            ) : (
              <span className="text-[11px] italic text-slate-400">
                nobody yet
              </span>
            )
          ) : (
            <span title={`Raised by ${task.createdByName}`}>
              <Avatar
                name={task.createdByName}
                id={task.createdById}
                size="sm"
              />
            </span>
          )}
        </div>
        {task.assignees.length > 4 && (
          <span className="text-[11px] text-slate-400">
            +{task.assignees.length - 4}
          </span>
        )}
        {side === 'by-me' && task.assignees.some((a) => a.id === myId) && (
          <span className="text-[11px] text-slate-400">
            <ClipboardList className="mr-0.5 inline h-3 w-3" />
            yours too
          </span>
        )}
      </div>
    </>
  );
}
