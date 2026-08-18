'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { DateInput, Input, Select } from '@/components/ui/Field';
import type { AttendanceHoliday, Branch } from '@/lib/types';

const ROUTE = '/hr/holidays';

const thisYear = () => new Date().getFullYear();

/**
 * The dated days off.
 *
 * Beside the weekly off rather than folded into it: one is a rule about the
 * week, the other a list of dates that changes every year and is set months
 * ahead. A sheet for one of these days opens pre-filled as a holiday, which is
 * the whole reason to keep the list.
 */
export default function HolidaysPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [year, setYear] = useState(thisYear());
  const { data, loading, refetch } = useFetch<AttendanceHoliday[]>(
    `/hr-holidays?year=${year}`,
    [year],
  );
  const { data: branches } = useFetch<Branch[]>('/branches');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceHoliday | null>(null);
  const [form, setForm] = useState({ date: '', name: '', branchId: '' });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  const branchName = (id: number | null) =>
    id === null
      ? 'Whole company'
      : ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`);

  /** The years worth offering — a couple back, a couple forward. */
  const years = useMemo(() => {
    const y = thisYear();
    return [y - 2, y - 1, y, y + 1, y + 2].map((n) => ({
      value: n,
      label: String(n),
    }));
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ date: '', name: '', branchId: '' });
    setOpen(true);
  };

  const openEdit = (row: AttendanceHoliday) => {
    setEditing(row);
    setForm({
      date: row.date.slice(0, 10),
      name: row.name,
      branchId: row.branchId ? String(row.branchId) : '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.date) {
      toast.error('Which day?');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Give the holiday a name.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        name: form.name.trim(),
        branchId: form.branchId ? Number(form.branchId) : null,
      };
      if (editing) await api.put(`/hr-holidays/${editing.id}`, payload);
      else await api.post('/hr-holidays', payload);
      toast.success(editing ? 'Holiday updated.' : 'Holiday added.');
      setOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: AttendanceHoliday) => {
    if (
      !(await confirm({
        title: 'Remove this holiday',
        message: `Remove "${row.name}" on ${formatDayMonthYear(row.date)}? Days already marked are not touched.`,
        danger: true,
        confirmText: 'Remove',
      }))
    ) {
      return;
    }
    try {
      await api.delete(`/hr-holidays/${row.id}`);
      toast.success('Removed.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  const columns: Column<AttendanceHoliday>[] = [
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      sortAccessor: (r) => r.date,
      accessor: (r) => formatDayMonthYear(r.date),
    },
    {
      key: 'weekday',
      header: 'Day',
      accessor: (r) =>
        new Date(`${r.date.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
          undefined,
          { weekday: 'long', timeZone: 'UTC' },
        ),
    },
    { key: 'name', header: 'Holiday', accessor: (r) => r.name },
    {
      key: 'branch',
      header: 'Applies to',
      accessor: (r) => branchName(r.branchId),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <PageHeader
        title="Holiday Calendar"
        description="The dated days off — a sheet for one of these opens pre-filled as a holiday"
        icon={<CalendarDays className="h-5 w-5" />}
        actions={
          canAdd && (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={openNew}
            >
              <Plus className="h-4 w-4" /> Add a holiday
            </button>
          )
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            label="Year"
            wrapClassName="w-32"
            sortOptions={false}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            options={years}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {(data ?? []).length} holiday
            {(data ?? []).length === 1 ? '' : 's'} in {year}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!activeCompanyId ? (
            <p className="text-sm text-slate-400">Choose a company first.</p>
          ) : (
            <DataTable
              rows={data ?? []}
              columns={columns}
              loading={loading}
              rowKey={(r) => r.id}
              emptyMessage={`Nothing is down for ${year} yet.`}
              onEdit={canEdit ? openEdit : undefined}
              onDelete={canDelete ? remove : undefined}
            />
          )}
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit holiday' : 'Add a holiday'}
        subtitle="A day nobody is due at work"
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={save}
            saving={saving}
          />
        }
      >
        <div className="space-y-4">
          <DateInput
            label="Date"
            required
            value={form.date}
            onChange={(iso) => setForm({ ...form, date: iso })}
          />
          <Input
            label="Holiday"
            required
            value={form.name}
            placeholder="Onam, Christmas, Founder’s Day"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            label="Applies to"
            value={form.branchId}
            onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            placeholder="Whole company"
            options={(branches ?? [])
              .filter((b) => b.isActive)
              .map((b) => ({ value: b.id, label: b.name }))}
          />
          <p className="text-xs text-slate-400">
            Leave the branch empty for a holiday the whole company keeps. A
            branch that keeps a local holiday of its own gets its own line.
          </p>
        </div>
      </Drawer>
    </div>
  );
}
