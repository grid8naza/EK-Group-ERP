'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, Plus, Save, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch, useLookupValues } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Field';
import type { AttendanceSetting, Branch } from '@/lib/types';

const ROUTE = '/hr/attendance-settings';

const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

/** Sunday first, as a calendar reads. */
const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

/** One level's rule while it is being edited. */
interface Draft {
  branchId: number | null;
  defaultTimeIn: number;
  defaultTimeOut: number;
  defaultTypeId: number | null;
  weeklyOffDays: number[];
}

/**
 * The working day — what a fresh attendance sheet is filled in with.
 *
 * Two levels, and the branch wins over the company. Not three: a rule per
 * employee would be a roster, and a bakery has a shift rather than two hundred
 * of them. The handful who genuinely differ carry their own hours on their
 * employee record, which the sheet applies on top of whatever is set here.
 */
export default function AttendanceSettingsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data, refetch } = useFetch<AttendanceSetting[]>(
    '/hr-attendance-settings',
  );
  // Scoped to the active company: /branches answers for ALL of them unless
  // asked, and a picker offering another company's branches is a picker that
  // can only produce a rejected save.
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const types = useLookupValues('ATTENDANCE_TYPE');

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState<number | null>(null);

  const canEdit = can(ROUTE, 'edit');

  useEffect(() => {
    setDrafts(
      (data ?? []).map((r) => ({
        branchId: r.branchId,
        defaultTimeIn: r.defaultTimeIn,
        defaultTimeOut: r.defaultTimeOut,
        defaultTypeId: r.defaultTypeId,
        weeklyOffDays: r.weeklyOffDays ?? [],
      })),
    );
  }, [data]);

  const byBranch = useMemo(
    () => new Map((data ?? []).map((r) => [r.branchId, r])),
    [data],
  );
  const branchList = useMemo(
    () => (branches ?? []).filter((b) => b.isActive),
    [branches],
  );
  /** Branches with no rule of their own — the ones an override can be added for. */
  const without = branchList.filter((b) => !byBranch.has(b.id));

  const nameOf = (branchId: number | null) =>
    branchId === null
      ? 'Company default'
      : (branchList.find((b) => b.id === branchId)?.name ?? `#${branchId}`);

  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((d) => d.map((row, x) => (x === i ? { ...row, ...p } : row)));

  const toggleDay = (i: number, day: number) =>
    setDrafts((d) =>
      d.map((row, x) =>
        x === i
          ? {
              ...row,
              weeklyOffDays: row.weeklyOffDays.includes(day)
                ? row.weeklyOffDays.filter((n) => n !== day)
                : [...row.weeklyOffDays, day].sort(),
            }
          : row,
      ),
    );

  const addLevel = (branchId: number | null) => {
    const company = drafts.find((d) => d.branchId === null);
    setDrafts((d) => [
      ...d,
      {
        branchId,
        // A new branch rule starts as a copy of the company's, so it is an
        // adjustment rather than a blank form to fill in again.
        defaultTimeIn: company?.defaultTimeIn ?? 9 * 60,
        defaultTimeOut: company?.defaultTimeOut ?? 18 * 60,
        defaultTypeId: company?.defaultTypeId ?? types[0]?.id ?? null,
        weeklyOffDays: company?.weeklyOffDays ?? [],
      },
    ]);
  };

  const save = async (i: number) => {
    const row = drafts[i];
    setSaving(i);
    try {
      await api.put('/hr-attendance-settings', row);
      toast.success(`${nameOf(row.branchId)} saved.`);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(null);
    }
  };

  const remove = async (branchId: number | null) => {
    const saved = byBranch.get(branchId);
    if (!saved) {
      // Never saved — just drop it off the screen.
      setDrafts((d) => d.filter((r) => r.branchId !== branchId));
      return;
    }
    if (
      !(await confirm({
        title: 'Remove this branch rule',
        message: `${nameOf(branchId)} goes back to following the company default. Days already marked are not touched.`,
        danger: true,
        confirmText: 'Remove',
      }))
    ) {
      return;
    }
    try {
      await api.delete(`/hr-attendance-settings/${saved.id}`);
      toast.success('Removed.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Attendance Settings"
        description="The working day a branch keeps — what a fresh attendance sheet is filled in with"
        icon={<Clock className="h-5 w-5" />}
      />

      {!activeCompanyId ? (
        <p className="card p-6 text-sm text-slate-400">
          Choose a company first.
        </p>
      ) : (
        <div className="space-y-4">
          {drafts.length === 0 && (
            <div className="card p-6 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No working day has been set. Until one is, sheets open at 09:00
                – 18:00 with nobody on a weekly off.
              </p>
              {canEdit && (
                <button
                  type="button"
                  className="btn-primary mx-auto mt-4 inline-flex items-center gap-2"
                  onClick={() => addLevel(null)}
                >
                  <Plus className="h-4 w-4" /> Set the company default
                </button>
              )}
            </div>
          )}

          {drafts.map((row, i) => (
            <div key={row.branchId ?? 'company'} className="card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {nameOf(row.branchId)}
                </h3>
                {row.branchId === null ? (
                  <Badge color="slate">
                    Every branch without a rule of its own
                  </Badge>
                ) : (
                  <Badge color="blue">Overrides the company</Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {canEdit && row.branchId !== null && (
                    <button
                      type="button"
                      className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                      onClick={() => remove(row.branchId)}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="btn-primary inline-flex items-center gap-2"
                      onClick={() => save(i)}
                      disabled={saving === i}
                    >
                      <Save className="h-4 w-4" />
                      {saving === i ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Time In
                  </span>
                  <input
                    type="time"
                    className="input-base"
                    disabled={!canEdit}
                    value={toTime(row.defaultTimeIn)}
                    onChange={(e) =>
                      patch(i, { defaultTimeIn: toMinutes(e.target.value) })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Time Out
                  </span>
                  <input
                    type="time"
                    className="input-base"
                    disabled={!canEdit}
                    value={toTime(row.defaultTimeOut)}
                    onChange={(e) =>
                      patch(i, { defaultTimeOut: toMinutes(e.target.value) })
                    }
                  />
                </label>
                <Select
                  label="Attendance type"
                  disabled={!canEdit}
                  sortOptions={false}
                  value={row.defaultTypeId ?? ''}
                  onChange={(e) =>
                    patch(i, { defaultTypeId: Number(e.target.value) || null })
                  }
                  options={types.map((t) => ({ value: t.id, label: t.label }))}
                />
              </div>

              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  Weekly off
                </p>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => {
                    const on = row.weeklyOffDays.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => toggleDay(i, d.value)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed',
                          on
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                        )}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  Those days open pre-filled as the weekly off rather than as
                  absence — not due at work is not the same as did not turn up.
                </p>
              </div>
            </div>
          ))}

          {canEdit && drafts.length > 0 && without.length > 0 && (
            <div className="card flex flex-wrap items-center gap-3 p-4">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                A branch that works different hours:
              </span>
              <Select
                wrapClassName="w-64"
                value=""
                placeholder="Add a branch rule…"
                onChange={(e) =>
                  e.target.value && addLevel(Number(e.target.value))
                }
                options={without.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
