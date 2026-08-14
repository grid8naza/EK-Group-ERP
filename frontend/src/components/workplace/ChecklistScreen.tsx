'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CalendarDays,
  Clock,
  ExternalLink,
  GripVertical,
  History,
  Pencil,
  Plus,
  Power,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { DOC_PARAM } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { PeopleField, type PickedPerson } from '@/components/workplace/people';
import { ChecklistHistoryDrawer } from '@/components/workplace/ChecklistHistoryDrawer';
import { PRIORITY_TONE } from '@/components/workplace/task-ui';
import { cn } from '@/lib/utils';
import type {
  AudienceOptions,
  ChecklistFrequency,
  ChecklistTemplate,
  TaskPriority,
} from '@/lib/types';

/** Sunday-first, matching the stored 0-6 and every calendar in the building. */
const WEEKDAYS = [
  { value: 0, short: 'Sun' },
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
];

const FREQUENCIES: {
  value: ChecklistFrequency;
  label: string;
  hint: string;
}[] = [
  { value: 'DAILY', label: 'Every day', hint: 'Opening and closing checks' },
  { value: 'WEEKLY', label: 'Chosen days', hint: 'Deep clean on a Monday' },
  { value: 'MONTHLY', label: 'Once a month', hint: 'Stock-take, servicing' },
];

const PRIORITIES: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** "HH:mm" → minutes after midnight — the server stores minutes, the browser
 *  speaks the string. The other direction is done server-side (formatMinutes),
 *  so the screen never has to agree with it twice. */
const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

interface Form {
  name: string;
  description: string;
  frequency: ChecklistFrequency;
  weekdays: number[];
  dayOfMonth: number;
  startTime: string;
  /** Empty means "by the end of the day". */
  dueTime: string;
  /** Its working life. Empty end = no end date. */
  startsOn: string;
  endsOn: string;
  priority: TaskPriority;
  /** Where it applies. Null branch = the whole company. */
  companyId: number | null;
  branchId: number | null;
  isActive: boolean;
  assignees: PickedPerson[];
  items: string[];
}

const blank = (): Form => ({
  name: '',
  description: '',
  frequency: 'DAILY',
  weekdays: [1],
  dayOfMonth: 1,
  startTime: '06:00',
  dueTime: '',
  // Today, in the browser's own reckoning — a new checklist means to start now.
  startsOn: new Date().toLocaleDateString('en-CA'),
  endsOn: '',
  priority: 'NORMAL',
  companyId: null,
  branchId: null,
  isActive: true,
  assignees: [],
  items: [''],
});

/** "at 08:00 tomorrow", "on Mon 18 Aug at 06:00" — when it next comes out. */
function nextRunLabel(nextRunAt: string | null): string {
  if (!nextRunAt) return 'never';
  const at = new Date(nextRunAt);
  const time = at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date().setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  if (days === 0) return `at ${time} today`;
  if (days === 1) return `at ${time} tomorrow`;
  return `on ${at.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} at ${time}`;
}

/** "Every day at 06:00", "Mon, Thu at 07:30", "Day 1 at 09:00". */
function scheduleLabel(t: ChecklistTemplate): string {
  const at = ` at ${t.startTime}`;
  if (t.frequency === 'DAILY') return `Every day${at}`;
  if (t.frequency === 'WEEKLY') {
    const days = WEEKDAYS.filter((d) => t.weekdays.includes(d.value))
      .map((d) => d.short)
      .join(', ');
    return `${days || 'No days chosen'}${at}`;
  }
  return `Day ${t.dayOfMonth ?? 1} of each month${at}`;
}

/**
 * Recurring checklists (SRS §8.12, FR-TSK-02) — the schedules, not the
 * checklists under way.
 *
 * An occurrence is an ordinary task: it lands on Assigned to Me, is ticked
 * there, records who ticked what, and raises the same alerts. So this screen
 * ends where the schedule ends, and "what has to be checked this morning" is
 * always answered in one place — the board — rather than in two that could
 * disagree.
 */
export function ChecklistScreen() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { activeCompanyId, activeBranchId } = useAuth();

  const [rows, setRows] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  /** The checklist whose register is being read, if any. */
  const [historyOf, setHistoryOf] = useState<ChecklistTemplate | null>(null);
  /**
   * Where this person may set one up. Asked of the server rather than read from
   * AuthProvider, which knows the branches of the ACTIVE company only — and the
   * whole point of the pickers is choosing another one.
   */
  const [scope, setScope] = useState<AudienceOptions>({
    companies: [],
    branches: [],
    groups: [],
    everyoneCount: 0,
  });
  const branchesOf = (companyId: number | null) =>
    scope.branches.filter((b) => b.companyId === companyId);

  // See MailboxScreen: the toast context value is unmemoized, so depending on
  // it would turn one failed load into a request loop.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<ChecklistTemplate[]>('/checklists'));
    } catch {
      toastRef.current.error('Could not load your checklists.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    api
      .get<AudienceOptions>('/checklists/scope')
      .then((s) => alive && setScope(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const openAdd = () => {
    setEditing(null);
    // A new one defaults to where you are working, which is the common case —
    // the pickers are there for when it is not.
    setForm({
      ...blank(),
      companyId: activeCompanyId ?? scope.companies[0]?.id ?? null,
      branchId: activeBranchId ?? null,
    });
    setOpen(true);
  };

  const openEdit = (t: ChecklistTemplate) => {
    setEditing(t);
    setForm({
      name: t.name,
      description: t.description ?? '',
      frequency: t.frequency,
      weekdays: t.weekdays.length ? t.weekdays : [1],
      dayOfMonth: t.dayOfMonth ?? 1,
      startTime: t.startTime,
      dueTime: t.dueTime ?? '',
      startsOn: t.startsOn,
      endsOn: t.endsOn ?? '',
      priority: t.priority,
      companyId: t.companyId,
      branchId: t.branchId,
      isActive: t.isActive,
      assignees: t.assignees,
      items: t.items.length ? t.items.map((i) => i.text) : [''],
    });
    setOpen(true);
  };

  const save = async () => {
    const items = form.items.map((i) => i.trim()).filter(Boolean);
    if (!form.name.trim()) {
      toastRef.current.error('Give the checklist a name.');
      return;
    }
    if (!items.length) {
      toastRef.current.error('A checklist needs at least one thing to check.');
      return;
    }
    if (!form.assignees.length) {
      toastRef.current.error('Say who has to do it.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        frequency: form.frequency,
        weekdays: form.frequency === 'WEEKLY' ? form.weekdays : [],
        dayOfMonth: form.frequency === 'MONTHLY' ? form.dayOfMonth : undefined,
        startMinutes: toMinutes(form.startTime),
        // Empty means the end of that day, which the server stores as null.
        dueMinutes: form.dueTime ? toMinutes(form.dueTime) : null,
        startsOn: form.startsOn || undefined,
        // Empty means no end date, which the server stores as null.
        endsOn: form.endsOn || null,
        priority: form.priority,
        companyId: form.companyId ?? undefined,
        branchId: form.branchId,
        isActive: form.isActive,
        assigneeIds: form.assignees.map((a) => a.id),
        items,
      };
      if (editing) {
        await api.patch(`/checklists/${editing.id}`, payload);
        toastRef.current.success('Checklist updated.');
      } else {
        await api.post('/checklists', payload);
        toastRef.current.success('Checklist saved. It will raise itself.');
      }
      setOpen(false);
      await load();
    } catch (e) {
      toastRef.current.error(
        e instanceof ApiError ? e.message : 'Could not save that.',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: ChecklistTemplate) => {
    try {
      await api.patch(`/checklists/${t.id}`, { isActive: !t.isActive });
      await load();
    } catch (e) {
      toastRef.current.error(
        e instanceof ApiError ? e.message : 'Could not change that.',
      );
    }
  };

  const remove = async (t: ChecklistTemplate) => {
    const ok = await confirm({
      title: 'Delete checklist',
      message: `Stop raising "${t.name}"? The occurrences it has already raised are kept — a completed check is a record.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/checklists/${t.id}`);
      toastRef.current.success('Checklist deleted.');
      await load();
    } catch (e) {
      toastRef.current.error(
        e instanceof ApiError ? e.message : 'Could not delete that.',
      );
    }
  };

  const openHistory = (t: ChecklistTemplate) => setHistoryOf(t);

  /**
   * Go to today's occurrence — the task itself, on the board where it is ticked.
   *
   * Whoever it is FOR goes to their own board; anybody else (the person who set
   * it up, watching it) to the one that lists what they have given out. Sending
   * either to the other's screen would show them a board their task is not on.
   */
  const openOccurrence = (t: ChecklistTemplate) => {
    if (!t.todayTaskId) return;
    const board = t.isForMe
      ? '/workplace/tasks/assigned-to-me'
      : '/workplace/tasks/assigned-by-me';
    router.push(`${board}?${DOC_PARAM}=${t.todayTaskId}`);
  };

  // There is no "raise now". The sweep puts a checklist out within minutes of
  // its start time, so the button only ever meant "a bit earlier today" — and
  // it raised an occurrence whatever the schedule said, which put rows in the
  // register for days nobody expected. A checklist that has to happen on a day
  // it is not scheduled for is a task, and the board raises those.

  // ------------------------------------------------------------- the items --

  const setItem = (index: number, text: string) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((v, i) => (i === index ? text : v)),
    }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, ''] }));
  const removeItem = (index: number) =>
    setForm((f) => ({
      ...f,
      items:
        f.items.length === 1 ? [''] : f.items.filter((_, i) => i !== index),
    }));
  const moveItem = (index: number, by: number) =>
    setForm((f) => {
      const next = [...f.items];
      const to = index + by;
      if (to < 0 || to >= next.length) return f;
      [next[index], next[to]] = [next[to], next[index]];
      return { ...f, items: next };
    });

  const zone = rows[0]?.timeZone;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {rows.length} {rows.length === 1 ? 'checklist' : 'checklists'}
          {/* Which clock the times mean. The server runs in UTC and the bakery
              does not, so a screen that showed "06:00" without saying whose six
              would be quietly ambiguous. */}
          {zone && (
            <span className="ml-2 text-xs text-slate-400">
              times are {zone.replace('_', ' ')}
            </span>
          )}
        </p>
        <button
          onClick={openAdd}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          New checklist
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
          <Repeat className="h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No recurring checklists yet.
          </p>
          <p className="max-w-md text-xs text-slate-400">
            Opening and closing checks, hygiene rounds, production sign-offs —
            set one up once and it raises itself on the board every time it is
            due.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex flex-col gap-2 rounded-xl border bg-white p-4 dark:bg-slate-900',
                t.isActive
                  ? 'border-slate-200 dark:border-slate-800'
                  : 'border-dashed border-slate-300 dark:border-slate-700',
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg',
                    t.isActive
                      ? 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400'
                      : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
                  )}
                >
                  <Repeat className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {t.name}
                    </span>
                    {t.priority !== 'NORMAL' && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          PRIORITY_TONE[t.priority],
                        )}
                      >
                        {t.priority.toLowerCase()}
                      </span>
                    )}
                    {!t.isActive && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Paused
                      </span>
                    )}
                    {/* WHOSE checklist it is. The list crosses companies — a
                        schedule has to be findable whatever company you are
                        working in — so the card has to say, or two branches'
                        opening checks would be indistinguishable. */}
                    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Building2 className="h-3 w-3" />
                      {t.companyName ?? `Company #${t.companyId}`}
                      {t.branchName ? ` · ${t.branchName}` : ' · company-wide'}
                    </span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {scheduleLabel(t)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.dueTime ? `Due by ${t.dueTime}` : 'Due end of day'}
                    </span>
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.items.length} {t.items.length === 1 ? 'check' : 'checks'} ·{' '}
                {t.assignees.map((a) => a.name).join(', ') || 'nobody'}
                {/* Whose schedule it is. Shown to everybody else, so that a card
                    with no Edit button reads as somebody else's rather than as a
                    screen that is not working. */}
                {!t.isMine && t.createdByName && (
                  <> · set up by {t.createdByName}</>
                )}
              </p>

              {/*
                Where it has got to today — the question a schedule always
                prompts, and the one the card could not answer. Without it a
                reader sees a time of day and cannot tell whether the system has
                done its part yet.
              */}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {t.todayTaskId ? (
                  <>
                    {/* Whether it was DONE, not merely whether it came out. This
                        is what the person who set it up came here to find out,
                        and the alternative was going to a board in another
                        company to look. */}
                    {t.todayStatus === 'DONE' ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                        Done today
                      </span>
                    ) : t.todayStatus === 'BLOCKED' ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                        Blocked
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                        Out today · {t.todayDone}/{t.todayTotal}
                      </span>
                    )}
                    {t.todayCompletedByName && (
                      <span className="text-slate-500 dark:text-slate-400">
                        by {t.todayCompletedByName}
                      </span>
                    )}
                    <button
                      onClick={() => openOccurrence(t)}
                      className="flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t.isForMe ? 'Open it on my board' : 'See the task'}
                    </button>
                  </>
                ) : t.hasEnded ? (
                  <span className="text-slate-400">
                    Ended {t.endsOn} — it will not come round again.
                  </span>
                ) : !t.isActive ? (
                  <span className="text-slate-400">
                    Paused — it will not come out again until resumed.
                  </span>
                ) : t.notStarted ? (
                  <span className="text-slate-400">
                    Starts {t.startsOn} · first {nextRunLabel(t.nextRunAt)}
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Not out yet · next {nextRunLabel(t.nextRunAt)}
                  </span>
                )}
              </p>

              {/* Whoever set it up may CHANGE it — the same split as a task,
                  where the raiser owns what it says and the assignee owns how it
                  is going. The register is open to both of them: it is the record
                  of work one of them asked for and the other did. */}
              <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                <button
                  onClick={() => openHistory(t)}
                  title="Every day it was expected, and what became of it"
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <History className="h-3.5 w-3.5" />
                  History
                </button>
                {t.isMine && (
                  <>
                    <button
                      onClick={() => openEdit(t)}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    {/* Stop it raising work without destroying it — a refit, a
                        seasonal close, the person it is for on leave. Distinct
                        from Delete, which loses the schedule, and from an end
                        date, which is a finish you knew about in advance. */}
                    <button
                      onClick={() => void toggleActive(t)}
                      title={
                        t.isActive
                          ? 'Stop it coming round, without deleting it. The record is kept.'
                          : 'Start it coming round again.'
                      }
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Power className="h-3.5 w-3.5" />
                      {t.isActive ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => void remove(t)}
                      className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-950"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ----------------------------------------------------- the register -- */}
      <ChecklistHistoryDrawer
        template={historyOf}
        onClose={() => setHistoryOf(null)}
        onOpenTask={(taskId, isForMe) =>
          router.push(
            `${isForMe ? '/workplace/tasks/assigned-to-me' : '/workplace/tasks/assigned-by-me'}?${DOC_PARAM}=${taskId}`,
          )
        }
      />

      {/* ------------------------------------------------------ the editor -- */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit checklist' : 'New recurring checklist'}
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={() => void save()}
            saving={saving}
          />
        }
      >
        <div className="space-y-5">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Kitchen opening checks"
            autoFocus
          />
          <Textarea
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Anything the person doing it needs to know."
          />

          {/* ---- when ---- */}
          <div className="card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Repeat className="h-4 w-4 text-brand-600" /> How often
            </h3>

            <div className="grid gap-2 sm:grid-cols-3">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setForm({ ...form, frequency: f.value })}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition',
                    form.frequency === f.value
                      ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                    {f.label}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    {f.hint}
                  </span>
                </button>
              ))}
            </div>

            {form.frequency === 'WEEKLY' && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  On which days
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const on = form.weekdays.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            weekdays: on
                              ? f.weekdays.filter((v) => v !== d.value)
                              : [...f.weekdays, d.value].sort(),
                          }))
                        }
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                          on
                            ? 'border-brand-300 bg-brand-600 text-white dark:border-brand-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                        )}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {form.frequency === 'MONTHLY' && (
              <div className="mt-3 max-w-[12rem]">
                <Input
                  label="Day of the month"
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.dayOfMonth)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dayOfMonth: Math.min(
                        31,
                        Math.max(1, Number(e.target.value) || 1),
                      ),
                    })
                  }
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  A 29th, 30th or 31st still runs in shorter months, on the last
                  day.
                </p>
              </div>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input
                label="Appears at"
                type="time"
                value={form.startTime}
                onChange={(e) =>
                  setForm({ ...form, startTime: e.target.value || '06:00' })
                }
              />
              <div>
                <Input
                  label="Due by (optional)"
                  type="time"
                  value={form.dueTime}
                  onChange={(e) =>
                    setForm({ ...form, dueTime: e.target.value })
                  }
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Left empty: the end of that day.
                </p>
              </div>
            </div>

            {/* ---- for how long ---- */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Input
                  label="Starts on"
                  type="date"
                  value={form.startsOn}
                  onChange={(e) =>
                    setForm({ ...form, startsOn: e.target.value })
                  }
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Nothing before this counts as missed.
                </p>
              </div>
              <div>
                <Input
                  label="Ends on (optional)"
                  type="date"
                  value={form.endsOn}
                  min={form.startsOn || undefined}
                  onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  {form.endsOn
                    ? 'It stops coming round after this day.'
                    : 'Left empty: no end date — it runs until paused.'}
                </p>
              </div>
            </div>
          </div>

          {/* ---- what ---- */}
          <div className="card p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              What has to be checked
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              One line each. These are copied onto every occurrence, so editing
              them changes tomorrow&apos;s checklist and never what was signed
              for yesterday.
            </p>
            <div className="space-y-1.5">
              {form.items.map((text, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveItem(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="text-slate-300 hover:text-slate-600 disabled:opacity-30"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="w-5 flex-none text-right text-xs text-slate-400">
                    {i + 1}.
                  </span>
                  <input
                    value={text}
                    onChange={(e) => setItem(i, e.target.value)}
                    onKeyDown={(e) => {
                      // Enter adds the next line, which is how anybody types a
                      // list without reaching for the mouse.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addItem();
                      }
                    }}
                    placeholder="Fridge temperature logged"
                    className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    aria-label="Remove line"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItem}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Add a line
            </button>
          </div>

          {/* ---- the rest ---- */}
          <div className="card space-y-3 p-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                Priority
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm({ ...form, priority: p })}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition',
                      form.priority === p
                        ? 'border-brand-300 bg-brand-600 text-white dark:border-brand-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    {p.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/*
              WHERE it applies, chosen here rather than taken from the company
              picker in the topbar. A schedule is set up for a place — often not
              the one you are working in — and making somebody switch company to
              write a checklist for another branch is a step that existed only
              because the data model asked for it.
            */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Company
                </label>
                <select
                  value={form.companyId ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      companyId: Number(e.target.value) || null,
                      // A branch belongs to one company, so it cannot survive
                      // the company changing under it. Nor can the people: they
                      // were chosen from those who work at the OLD company, and
                      // leaving them there would only produce a refusal on save.
                      branchId: null,
                      assignees: [],
                    })
                  }
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {scope.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Branch
                </label>
                <select
                  value={form.branchId ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      branchId: Number(e.target.value) || null,
                      // Chosen from the people at the OLD branch, so they cannot
                      // carry over — the save would only refuse them.
                      assignees: [],
                    })
                  }
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="">The whole company</option>
                  {branchesOf(form.companyId).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  {form.branchId
                    ? 'It raises on that branch’s board only.'
                    : 'It raises on every branch’s board.'}
                </p>
              </div>
            </div>
          </div>

          {/*
            ---- who ----
            AFTER the company and branch, because who may be given it DEPENDS on
            both: the list holds only people who work there, so asking first
            would offer names the save then refused. The endpoint carries both,
            so changing either picker re-asks.
          */}
          <PeopleField
            label="Who has to do it"
            endpoint={`/checklists/directory?companyId=${form.companyId ?? 0}&branchId=${form.branchId ?? ''}`}
            chosen={form.assignees}
            onChange={(people) => setForm({ ...form, assignees: people })}
            placeholder={
              form.companyId
                ? 'Search people who work there…'
                : 'Choose a company first…'
            }
          />

          {/*
            Last, because it is the switch you throw once everything above is
            settled — and the one thing on this form that is not about WHAT the
            checklist is, but about whether it is running at all.
          */}
          <div className="card p-4">
            <Checkbox
              label="Active — raise it on schedule"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            <p className="mt-1 pl-6 text-[11px] text-slate-400">
              {form.isActive
                ? 'It comes round on its own from the start date.'
                : 'Saved, but nothing will be raised until this is switched on.'}
            </p>
          </div>
        </div>
      </Drawer>
    </>
  );
}
