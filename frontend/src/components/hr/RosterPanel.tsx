'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, CalendarClock, Moon, Clock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { FormSection } from '@/components/ui/FormSection';
import { Select, Textarea, DateInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { HrShift, ShiftAssignment } from '@/lib/types';

/**
 * An employee's roster — which shift they are on, and from when.
 *
 * A dated SERIES, like the postings beside it: moving somebody onto nights is a
 * new line starting the day it takes effect, and the server closes the one
 * before it the day before. That is what lets last March's attendance resolve
 * against the shift they were actually on in March.
 *
 * The attendance sheet reads this FIRST — ahead of the person's own hours and
 * ahead of the branch's working day — because a roster is the most specific
 * thing anybody has said about that day.
 */

const emptyForm = {
  shiftId: '',
  effectiveFrom: '',
  effectiveTo: '',
  remarks: '',
};

type Form = typeof emptyForm;

const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hours = (m: number) =>
  `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export interface RosterPanelProps {
  /** The employee whose roster this is; null before the record exists. */
  employeeId: number | null;
  /**
   * The branch THEY are at, so the shift list offers what their branch works.
   *
   * Not the branch in the header: this panel is opened from a list that can
   * show every branch at once, and a dropdown offering a shift the person's
   * branch does not work is a dropdown whose every choice the server refuses.
   */
  branchId?: number | null;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

export function RosterPanel({
  employeeId,
  branchId,
  readOnly = false,
  onDirtyChange,
}: RosterPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // The shifts THIS PERSON's branch works — the same rule the server enforces
  // on save, so nothing is offered that would only be refused. Falls back to
  // the branch in the header when the caller does not say.
  const { data: shifts } = useFetch<HrShift[]>(
    branchId ? `/hr-shifts?branchId=${branchId}` : '/hr-shifts',
    [branchId],
  );

  const open = adding || editingId !== null;
  useEffect(() => {
    onDirtyChange?.(open);
  }, [open, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const load = useCallback(async () => {
    if (!employeeId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows(
        await api.get<ShiftAssignment[]>(`/hr-employees/${employeeId}/shifts`),
      );
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setAdding(true);
  };

  const startEdit = (row: ShiftAssignment) => {
    setAdding(false);
    setEditingId(row.id);
    setForm({
      shiftId: String(row.shiftId),
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo ?? '',
      remarks: row.remarks ?? '',
    });
  };

  const close = () => {
    setAdding(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const save = async () => {
    if (!employeeId) return;
    if (!form.shiftId) {
      toast.error('Which shift?');
      return;
    }
    if (!form.effectiveFrom) {
      toast.error('From which day?');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        shiftId: Number(form.shiftId),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        remarks: form.remarks.trim() || null,
      };
      const next = editingId
        ? await api.put<ShiftAssignment[]>(
            `/hr-employees/${employeeId}/shifts/${editingId}`,
            payload,
          )
        : await api.post<ShiftAssignment[]>(
            `/hr-employees/${employeeId}/shifts`,
            payload,
          );
      setRows(next);
      toast.success(editingId ? 'Roster updated.' : 'Put on the shift.');
      close();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: ShiftAssignment) => {
    if (!employeeId) return;
    const ok = await confirm({
      title: 'Remove this roster line',
      message: `Remove ${row.shiftName} from ${formatDayMonthYear(row.effectiveFrom)}? Days already marked keep the times they were marked with.`,
      danger: true,
      confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      setRows(
        await api.delete<ShiftAssignment[]>(
          `/hr-employees/${employeeId}/shifts/${row.id}`,
        ),
      );
      toast.success('Removed.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  if (!employeeId) {
    return (
      <p className="px-1 py-6 text-sm text-slate-400">
        Save the employee first — a roster hangs off the person it is for.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <FormSection>Roster</FormSection>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Two readings of the same series. Read-only, it is a history and the
            note says how to read it; editable, it is a thing you act on and the
            note says what acting does. */}
        <p className="text-xs text-slate-400">
          {readOnly
            ? 'Every shift they have been on, and from when. The attendance sheet fills each day in from whichever was in force — so this is what last month was marked against, not only what today is.'
            : 'The shift they work, from when. Putting somebody on a new shift closes the one before it — the attendance sheet then fills their day in from whichever was in force.'}
        </p>
        {!readOnly && !open && (
          <button
            type="button"
            className="btn-primary inline-flex flex-none items-center gap-2"
            onClick={startAdd}
          >
            <Plus className="h-4 w-4" /> Put on a shift
          </button>
        )}
      </div>

      {open && (
        <ReadOnlyFieldset readOnly={readOnly}>
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-800 dark:bg-brand-950/20">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Shift"
                required
                value={form.shiftId}
                onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
                options={(shifts ?? [])
                  .filter((s) => s.isActive)
                  .map((s) => ({
                    value: s.id,
                    label: `${s.code} — ${s.name} (${toTime(s.timeIn)}–${toTime(s.timeOut)})`,
                  }))}
              />
              <DateInput
                label="From"
                required
                value={form.effectiveFrom}
                onChange={(iso) => setForm({ ...form, effectiveFrom: iso })}
              />
              <DateInput
                label="Until (blank = until changed)"
                value={form.effectiveTo}
                onChange={(iso) => setForm({ ...form, effectiveTo: iso })}
              />
              <div className="sm:col-span-2">
                <Textarea
                  label="Remarks"
                  rows={2}
                  value={form.remarks}
                  placeholder="Covering nights while Suresh is on leave"
                  onChange={(e) =>
                    setForm({ ...form, remarks: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </ReadOnlyFieldset>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
          Nobody has put this person on a shift. Their attendance fills in from
          their own hours, or from the branch&apos;s working day.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={cn(
                'overflow-hidden rounded-xl border',
                r.current
                  ? 'border-brand-300 dark:border-brand-700'
                  : 'border-slate-200 dark:border-slate-700',
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
                <CalendarClock className="h-4 w-4 flex-none text-brand-600" />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {formatDayMonthYear(r.effectiveFrom)} &rarr;{' '}
                  {r.effectiveTo
                    ? formatDayMonthYear(r.effectiveTo)
                    : 'until changed'}
                </span>
                {r.current && <Badge color="green">In force</Badge>}
                <span className="ml-auto inline-flex items-center gap-2 text-sm">
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {r.shiftCode}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {r.shiftName}
                  </span>
                </span>
                {!readOnly && (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
                      title="Edit"
                      onClick={() => startEdit(r)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      title="Remove"
                      onClick={() => remove(r)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  {toTime(r.timeIn)} – {toTime(r.timeOut)}
                </span>
                {r.overnight && (
                  <span className="inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-400">
                    <Moon className="h-3.5 w-3.5" /> finishes the next day
                  </span>
                )}
                {r.breakMinutes > 0 && <span>{r.breakMinutes} min break</span>}
                <span className="font-medium">
                  {hours(r.workMinutes)} a day
                </span>
              </div>
              {r.remarks && (
                <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {r.remarks}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
