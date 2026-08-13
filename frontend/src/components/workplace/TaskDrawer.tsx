'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  ClipboardList,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { Drawer } from '@/components/ui/Drawer';
import { Select } from '@/components/ui/Field';
import { Avatar, fullTime } from '@/components/workplace/people';
import { COLUMNS, dueLabel } from '@/components/workplace/task-ui';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@/lib/types';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  ...COLUMNS.map((c) => ({ value: c.status, label: c.label })),
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * One task, opened.
 *
 * What can be changed here follows who you are to the task, and the screen says
 * so rather than failing at the server: whoever raised it owns what it says,
 * whoever it is for owns how it is going, and both may talk about it. Every
 * write returns the whole task, so the board behind this drawer is updated from
 * the answer rather than from a guess about what changed.
 */
export function TaskDrawer({
  task,
  onClose,
  onChanged,
  onRemoved,
}: {
  task: Task | null;
  onClose: () => void;
  onChanged: (task: Task) => void;
  onRemoved: (id: number) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [comment, setComment] = useState('');
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setComment('');
    setLine('');
  }, [task?.id]);

  if (!task) return null;

  const run = async (fn: () => Promise<Task>) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: TaskStatus) =>
    run(() => api.post<Task>(`/tasks/${task.id}/status`, { status }));

  const toggleItem = (itemId: number, isDone: boolean) =>
    run(() =>
      api.post<Task>(`/tasks/${task.id}/checklist/${itemId}`, { isDone }),
    );

  const addItem = () => {
    const text = line.trim();
    if (!text) return;
    setLine('');
    return run(() => api.post<Task>(`/tasks/${task.id}/checklist`, { text }));
  };

  const removeItem = (itemId: number) =>
    run(() => api.delete<Task>(`/tasks/${task.id}/checklist/${itemId}`));

  const say = () => {
    const body = comment.trim();
    if (!body) return;
    setComment('');
    return run(() => api.post<Task>(`/tasks/${task.id}/comments`, { body }));
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this task?',
      message:
        'It goes for everyone it was assigned to, along with its checklist and comments. This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Keep',
    });
    if (!ok) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      onRemoved(task.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={task.title}
      subtitle={
        task.isMine
          ? task.assignees.length
            ? `You gave this to ${task.assignees.map((a) => a.name).join(', ')}`
            : 'Raised by you, for nobody yet'
          : `${task.createdByName} gave this to you`
      }
      width="md"
      icon={<ClipboardList className="h-5 w-5" />}
    >
      <div className="space-y-5">
        {/* ---------------------------------------------------------- state */}
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Status"
            wrapClassName="w-44"
            options={STATUS_OPTIONS}
            value={task.status}
            sortOptions={false}
            disabled={busy}
            onChange={(e) => void setStatus(e.target.value as TaskStatus)}
          />
          <div className="pb-2 text-xs text-slate-500 dark:text-slate-400">
            {task.dueAt ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  task.isOverdue &&
                    'font-medium text-rose-600 dark:text-rose-400',
                )}
              >
                {task.isOverdue ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <Calendar className="h-3.5 w-3.5" />
                )}
                Due {dueLabel(task.dueAt)}
              </span>
            ) : (
              <span className="text-slate-400">No due date</span>
            )}
            {task.branchId === null && (
              <span className="ml-3 inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                Company-wide
              </span>
            )}
          </div>
          {task.isMine && (
            <button
              className="ml-auto btn-secondary px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400"
              onClick={() => void remove()}
              title="Delete this task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {task.completedAt && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Finished by {task.completedByName} · {fullTime(task.completedAt)}
          </p>
        )}

        {task.description && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {task.description}
          </p>
        )}

        {/* ------------------------------------------------------ the people */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            On it
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {task.assignees.length === 0 && (
              <span className="text-sm italic text-slate-400">
                Nobody is assigned yet
              </span>
            )}
            {task.assignees.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Avatar name={a.name} id={a.id} size="sm" />
                {a.name}
              </span>
            ))}
          </div>
        </div>

        {/* --------------------------------------------------- the checklist */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Checklist{' '}
            {task.checklistTotal > 0 &&
              `· ${task.checklistDone}/${task.checklistTotal}`}
          </h3>
          <ul className="space-y-1">
            {task.checklist.map((c) => (
              <li
                key={c.id}
                className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <input
                  type="checkbox"
                  checked={c.isDone}
                  disabled={busy}
                  onChange={(e) => void toggleItem(c.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-sm',
                      c.isDone
                        ? 'text-slate-400 line-through'
                        : 'text-slate-700 dark:text-slate-200',
                    )}
                  >
                    {c.text}
                  </span>
                  {/* Who ticked it: a hygiene check nobody can be named for is
                      not a record of anything (SRS §8.13). */}
                  {c.isDone && c.doneByName && (
                    <span className="block text-[11px] text-slate-400">
                      {c.doneByName} · {c.doneAt ? fullTime(c.doneAt) : ''}
                    </span>
                  )}
                </span>
                {task.isMine && (
                  <button
                    className="text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                    onClick={() => void removeItem(c.id)}
                    title="Remove this step"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
            {task.checklist.length === 0 && (
              <li className="px-1.5 text-sm text-slate-400">
                No steps yet — add what has to be true for this to be done.
              </li>
            )}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addItem();
                }
              }}
              placeholder="Add a step, then Enter"
              className="input-base flex-1"
            />
          </div>
        </div>

        {/* ---------------------------------------------------- the comments */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Comments
          </h3>
          <div className="space-y-3">
            {task.comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar name={c.userName} id={c.userId} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {c.userName}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {fullTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                    {c.body}
                  </p>
                </div>
              </div>
            ))}
            {task.comments.length === 0 && (
              <p className="text-sm text-slate-400">Nothing said yet.</p>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void say();
                }
              }}
              placeholder="Add a comment…"
              className="input-base flex-1"
            />
            <button
              className="btn-secondary"
              disabled={busy || !comment.trim()}
              onClick={() => void say()}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="border-t border-slate-200 pt-3 text-xs text-slate-400 dark:border-slate-800">
          Raised by {task.createdByName} · {fullTime(task.createdAt)}
        </p>
      </div>
    </Drawer>
  );
}
