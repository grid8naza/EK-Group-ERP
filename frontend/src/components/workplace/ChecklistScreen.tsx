'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CalendarDays,
  Clock,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Power,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useToast } from '@/providers/ToastProvider';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { PeopleField, type PickedPerson } from '@/components/workplace/people';
import { PRIORITY_TONE } from '@/components/workplace/task-ui';
import { cn } from '@/lib/utils';
import type {
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
  priority: TaskPriority;
  companyWide: boolean;
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
  priority: 'NORMAL',
  companyWide: false,
  isActive: true,
  assignees: [],
  items: [''],
});

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

  const [rows, setRows] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);

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

  const openAdd = () => {
    setEditing(null);
    setForm(blank());
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
      priority: t.priority,
      companyWide: t.branchId === null,
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
        priority: form.priority,
        companyWide: form.companyWide,
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

  /** Raise today's occurrence now rather than waiting for its start time. */
  const raiseNow = async (t: ChecklistTemplate) => {
    try {
      const res = await api.post<{ raised: boolean; message?: string }>(
        `/checklists/${t.id}/raise-now`,
      );
      if (res.raised) {
        toastRef.current.success('Raised. It is on the board now.');
        router.push('/workplace/tasks/assigned-to-me');
      } else {
        toastRef.current.success(res.message ?? 'Already raised today.');
      }
    } catch (e) {
      toastRef.current.error(
        e instanceof ApiError ? e.message : 'Could not raise it.',
      );
    }
  };

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
                    {t.branchId === null && (
                      <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <Building2 className="h-3 w-3" />
                        Company-wide
                      </span>
                    )}
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
              </p>

              {/* Only whoever set it up may change it — the same split as a
                  task, where the raiser owns what it says. */}
              {t.isMine && (
                <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                  <button
                    onClick={() => openEdit(t)}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => void raiseNow(t)}
                    title="Raise today's occurrence now"
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Raise now
                  </button>
                  <button
                    onClick={() => void toggleActive(t)}
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
          </div>

          {/* ---- who ---- */}
          <PeopleField
            label="Who has to do it"
            endpoint="/tasks/directory"
            chosen={form.assignees}
            onChange={(people) => setForm({ ...form, assignees: people })}
          />

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

            <Checkbox
              label="For the whole company, not just this branch"
              checked={form.companyWide}
              onChange={(e) =>
                setForm({ ...form, companyWide: e.target.checked })
              }
            />
            <Checkbox
              label="Active — raise it on schedule"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          </div>
        </div>
      </Drawer>
    </>
  );
}
