'use client';

import { useMemo, useState } from 'react';
import { Clock, Plus, Moon } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useLock } from '@/lib/useLock';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Badge } from '@/components/ui/Badge';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, MultiSelect, Textarea, Checkbox } from '@/components/ui/Field';
import type { Branch, HrShift } from '@/lib/types';

const ROUTE = '/hr/shifts';

const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
/** 450 → "7h 30m" — what the shift is worth once the break is off. */
const hours = (m: number) =>
  `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

const empty = {
  code: '',
  name: '',
  /** Empty = every branch, which is what a shift starts as. */
  branchIds: [] as number[],
  timeIn: '09:00',
  timeOut: '18:00',
  breakMinutes: '0',
  remarks: '',
  isActive: true,
};

/**
 * Shift Master (SRS §8.9, FR-HRP-01).
 *
 * A named working pattern somebody can be put ON — as opposed to the working
 * day a branch keeps by default, which is Attendance Settings. A shift is
 * worked by ANY NUMBER of the company's branches — all of them, or a chosen
 * few — because that is how a group runs: the night bake happens at three of
 * the five plants, and it should not have to be entered three times.
 *
 * A finish at or before the start is a shift that crosses midnight, which is
 * what a night shift is and is why nothing here refuses it.
 */
export default function ShiftsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();

  const { data, loading, refetch } = useFetch<HrShift[]>('/hr-shifts');
  // Scoped to the active company: /branches answers for ALL of them unless
  // asked, and a picker offering another company's branches is a picker that
  // can only produce a rejected save.
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<HrShift>({
      endpoint: '/hr-shifts',
      route: ROUTE,
      noun: 'shift',
      nameOf: (s) => s.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HrShift | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const branchName = (id: number) =>
    (branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`;

  /**
   * Which branches work a shift, in words.
   *
   * Named rather than counted while the list is short — "Kadathy, Vazhakulam"
   * says what "2 branches" does not — and counted once it is long enough that
   * naming them would wrap the column.
   */
  const appliesTo = (s: HrShift) => {
    if (s.allBranches || s.branchIds.length === 0) return 'Every branch';
    if (s.branchIds.length <= 3) return s.branchIds.map(branchName).join(', ');
    return `${s.branchIds.length} branches`;
  };

  /** What this shift will be worth, as it is being typed. */
  const preview = useMemo(() => {
    const inM = toMinutes(form.timeIn);
    const outM = toMinutes(form.timeOut);
    const span = outM > inM ? outM - inM : outM + 1440 - inM;
    const net = Math.max(0, span - (Number(form.breakMinutes) || 0));
    return { net, overnight: outM <= inM };
  }, [form.timeIn, form.timeOut, form.breakMinutes]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (row: HrShift) =>
    guardEdit(row, () => {
      setEditing(row);
      setForm({
        code: row.code,
        name: row.name,
        branchIds: row.branchIds ?? [],
        timeIn: toTime(row.timeIn),
        timeOut: toTime(row.timeOut),
        breakMinutes: String(row.breakMinutes),
        remarks: row.remarks ?? '',
        isActive: row.isActive,
      });
      setOpen(true);
    });

  const save = async () => {
    if (!form.code.trim()) {
      toast.error('Give the shift a short code — M, N, GEN.');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Give the shift a name.');
      return;
    }
    if (form.timeIn === form.timeOut) {
      toast.error('A shift cannot start and finish at the same minute.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        branchIds: form.branchIds,
        timeIn: toMinutes(form.timeIn),
        timeOut: toMinutes(form.timeOut),
        breakMinutes: Number(form.breakMinutes) || 0,
        remarks: form.remarks.trim() || null,
        isActive: form.isActive,
      };
      if (editing) await api.patch(`/hr-shifts/${editing.id}`, payload);
      else await api.post('/hr-shifts', payload);
      toast.success(editing ? 'Shift updated.' : 'Shift added.');
      setOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: HrShift) =>
    guardDelete(row, async () => {
      try {
        await api.delete(`/hr-shifts/${row.id}`);
        toast.success('Shift removed.');
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
      }
    });

  const columns: Column<HrShift>[] = [
    {
      key: 'code',
      header: 'Code',
      sortable: true,
      className: 'font-mono font-medium',
      accessor: (r) => r.code,
    },
    { key: 'name', header: 'Shift', sortable: true, accessor: (r) => r.name },
    {
      key: 'timing',
      header: 'Timing',
      render: (r) => (
        <span className="inline-flex items-center gap-2 tabular-nums">
          {toTime(r.timeIn)} – {toTime(r.timeOut)}
          {r.overnight && (
            <span
              className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400"
              title="Finishes the following day"
            >
              <Moon className="h-3 w-3" /> overnight
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'break',
      header: 'Break',
      accessor: (r) => (r.breakMinutes ? `${r.breakMinutes} min` : '—'),
    },
    {
      key: 'hours',
      header: 'Hours',
      accessor: (r) => hours(r.workMinutes),
    },
    {
      key: 'branch',
      header: 'Applies to',
      accessor: (r) => appliesTo(r),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Shift Master"
        description="The working patterns people are put on — company-wide, or at the branches that work them"
        icon={<Clock className="h-5 w-5" />}
        actions={
          can(ROUTE, 'add') && (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={openNew}
            >
              <Plus className="h-4 w-4" /> Add a shift
            </button>
          )
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {!activeCompanyId ? (
          <p className="text-sm text-slate-400">Choose a company first.</p>
        ) : (
          <DataTable
            rows={data ?? []}
            columns={columns}
            loading={loading}
            rowKey={(r) => r.id}
            emptyMessage="No shifts yet. Add the ones this company works."
            onEdit={can(ROUTE, 'edit') ? openEdit : undefined}
            onDelete={can(ROUTE, 'delete') ? remove : undefined}
            renderLock={(r) => (
              <LockButton
                locked={r.isLocked}
                canLock={canLock}
                canUnlock={canUnlock}
                onToggle={() => toggleLock(r)}
              />
            )}
            bulkLock={bulkLock}
          />
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit shift' : 'Add a shift'}
        subtitle="A working pattern people can be rostered on"
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={save}
            saving={saving}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Code"
            required
            value={form.code}
            placeholder="M"
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <Input
            label="Shift"
            required
            value={form.name}
            placeholder="Morning"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Time In
            </span>
            <input
              type="time"
              className="input-base"
              value={form.timeIn}
              onChange={(e) => setForm({ ...form, timeIn: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Time Out
            </span>
            <input
              type="time"
              className="input-base"
              value={form.timeOut}
              onChange={(e) => setForm({ ...form, timeOut: e.target.value })}
            />
          </label>
          <Input
            label="Break (minutes)"
            type="number"
            value={form.breakMinutes}
            onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })}
          />
          {/* Any number of branches, because that is how a group runs: the
              night bake happens at three of the five plants. Left empty it is
              every branch — the ordinary answer, and the only one for a company
              that keeps no branches at all. */}
          <MultiSelect
            label="Applies to"
            value={form.branchIds}
            placeholder="Every branch"
            onChange={(v) => setForm({ ...form, branchIds: v.map(Number) })}
            options={(branches ?? [])
              .filter((b) => b.isActive)
              .map((b) => ({ value: b.id, label: b.name }))}
          />

          {/* What it comes to, as it is typed — including the night shift, which
              is easy to enter by accident and easier to miss. */}
          <div className="sm:col-span-2">
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
              Worth <strong>{hours(preview.net)}</strong> a day
              {preview.overnight && (
                <span className="ml-2 inline-flex items-center gap-1 text-violet-600 dark:text-violet-400">
                  <Moon className="h-3.5 w-3.5" /> finishes the next day
                </span>
              )}
            </p>
          </div>

          <div className="sm:col-span-2">
            <Textarea
              label="Remarks"
              rows={2}
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </div>
          <Checkbox
            label="Active"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
        </div>
      </Drawer>
    </div>
  );
}
