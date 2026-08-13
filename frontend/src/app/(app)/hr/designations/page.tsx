'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Cpu } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { money2, dec2 } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { StatusToggle } from '@/components/ui/StatusToggle';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { HrDesignation, HrCategory, HrGroup, Company } from '@/lib/types';

const ROUTE = '/hr/designations';

const empty = {
  code: '',
  name: '',
  categoryId: '',
  groupId: '',
  ratePerHour: '0.00',
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

export default function HrDesignationsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } =
    useFetch<HrDesignation[]>('/hr-designations');
  const { data: categories } = useFetch<HrCategory[]>('/hr-categories');
  const { data: groups } = useFetch<HrGroup[]>('/hr-groups');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<HrDesignation>({
      endpoint: '/hr-designations',
      route: ROUTE,
      noun: 'designation',
      nameOf: (d) => d.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HrDesignation | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  // List filters (empty string = no filter). Group choices cascade from the
  // selected category.
  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const nameRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const companyNameById = new Map(companyList.map((c) => [c.id, c.name]));
  // Designations attach to LEAF manpower groups only (no sub-groups) within the
  // chosen category — exactly like Item/Product master.
  const groupOptions = (groups ?? []).filter(
    (g) =>
      !g.subGroupApplicable &&
      g.isActive &&
      (!form.categoryId || String(g.categoryId) === form.categoryId),
  );

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (d: HrDesignation) => ({
    code: d.code,
    name: d.name,
    categoryId: d.categoryId != null ? String(d.categoryId) : '',
    groupId: d.groupId != null ? String(d.groupId) : '',
    ratePerHour: dec2(String(d.ratePerHour ?? 0)),
    allCompanies: d.allCompanies,
    companyIds: d.companyIds ?? [],
    isActive: d.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (d: HrDesignation) => {
    setEditing(d);
    setView(false);
    setForm(formFrom(d));
    setOpen(true);
  };
  const openView = (d: HrDesignation) => {
    setEditing(d);
    setView(true);
    setForm(formFrom(d));
    setOpen(true);
  };

  // Alt+A opens the New form (when allowed and no drawer is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'a' && canAdd && !open) {
        e.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdd, open]);

  const toggleCompany = (id: number) =>
    setForm((f) => ({
      ...f,
      companyIds: f.companyIds.includes(id)
        ? f.companyIds.filter((x) => x !== id)
        : [...f.companyIds, id],
    }));

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Designation Name is required.');
      return;
    }
    if (!form.groupId) {
      toast.error(
        'Select a group — every designation belongs to a leaf group.',
      );
      return;
    }
    if (!form.allCompanies && form.companyIds.length === 0) {
      toast.error('Select at least one company, or choose "All companies".');
      return;
    }

    const num = (s: string) => Number(s) || 0;
    const payload = {
      // code + category are derived server-side from the group.
      name: form.name.trim(),
      groupId: Number(form.groupId),
      ratePerHour: num(form.ratePerHour),
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: HrDesignation;
      if (editing) {
        saved = await api.patch<HrDesignation>(
          `/hr-designations/${editing.id}`,
          payload,
        );
        toast.success('Designation updated.');
      } else {
        saved = await api.post<HrDesignation>('/hr-designations', payload);
        toast.success('Designation created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        // Fast entry: keep the context (category, group, availability), clear
        // only the identity fields and refocus Designation Name.
        setEditing(null);
        setForm((f) => ({ ...f, name: '' }));
        setTimeout(() => nameRef.current?.focus(), 0);
      } else if (mode === 'save') {
        setEditing(saved);
        setForm(formFrom(saved));
      } else {
        closeDrawer();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: HrDesignation) => {
    const ok = await confirm({
      title: 'Delete designation',
      message: `Delete "${d.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/hr-designations/${d.id}`);
      toast.success('Designation deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Quick retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (d: HrDesignation) =>
    guardEdit(d, async () => {
      try {
        await api.patch(`/hr-designations/${d.id}`, { isActive: !d.isActive });
        toast.success(
          d.isActive ? 'Designation set inactive.' : 'Designation set active.',
        );
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
      }
    });

  // Group dropdown options follow the selected category (or all groups when no
  // category is chosen).
  const filterGroups = useMemo(
    () =>
      (groups ?? []).filter(
        (g) => !categoryFilter || String(g.categoryId) === categoryFilter,
      ),
    [groups, categoryFilter],
  );

  // Rows after filters; column ordering is handled by the table's sortable
  // headers (default: Code ascending).
  const visibleRows = useMemo(() => {
    let rows = [...(data ?? [])];
    if (categoryFilter)
      rows = rows.filter((r) => String(r.categoryId) === categoryFilter);
    if (groupFilter)
      rows = rows.filter((r) => String(r.groupId) === groupFilter);
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows;
  }, [data, categoryFilter, groupFilter, status]);

  const availabilityText = (d: HrDesignation) =>
    d.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  const columns: Column<HrDesignation>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Designation Name',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      accessor: (r) => r.category?.name ?? '-',
    },
    { key: 'group', header: 'Group', accessor: (r) => r.group?.name ?? '-' },
    {
      key: 'ratePerHour',
      header: 'Rate/hr',
      accessor: (r) => money2(r.ratePerHour),
      sortAccessor: (r) => r.ratePerHour ?? 0,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'availability',
      header: 'Availability',
      sortAccessor: (r) => (r.allCompanies ? Infinity : r.companyIds.length),
      render: (r) =>
        r.allCompanies ? (
          <Badge color="violet">All</Badge>
        ) : (
          <Badge color="blue">
            <span title={availabilityText(r)}>{r.companyIds.length}</span>
          </Badge>
        ),
    },
    {
      key: 'isActive',
      header: 'Status',
      sortAccessor: (r) => (r.isActive ? 'Active' : 'Inactive'),
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const title = view
    ? 'View Designation'
    : editing
      ? 'Edit Designation'
      : 'New Designation';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Designation Master"
        description="Manpower designations under a group, with an hourly rate for process costing"
        icon={<Cpu className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">
                Alt+A
              </span>
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={visibleRows}
        defaultSort={{ key: 'code', dir: 'asc' }}
        // Remount when the filters change so pagination jumps back to page 1.
        key={`${categoryFilter}|${groupFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search designations..."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setGroupFilter(''); // reset group when category changes
              }}
              wrapClassName="w-44"
              placeholder="All categories"
              options={(categories ?? []).map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
            <Select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              wrapClassName="w-44"
              placeholder="All groups"
              options={filterGroups.map((g) => ({
                value: String(g.id),
                label: g.name,
              }))}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapClassName="w-40"
              placeholder="All statuses"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
        }
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        rowActions={(r) => (
          <StatusToggle
            active={r.isActive}
            canEdit={canEdit}
            onToggle={() => toggleActive(r)}
          />
        )}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No designations found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Designation details"
        icon={<Cpu className="h-5 w-5" />}
        width="lg"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Code (auto)"
              value={editing ? editing.code : 'Generated from the group'}
              disabled
            />
            <Input
              ref={nameRef}
              label="Designation Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. CNC Machine Operator"
            />

            {/* Classification — immutable after creation (the code encodes it),
                so it's read-only when editing. To move a designation, inactivate
                it and create a new one under the right group. */}
            {editing ? (
              <>
                <Input
                  label="Category"
                  value={editing.category?.name ?? '-'}
                  disabled
                />
                <Input
                  label="Group"
                  value={editing.group?.name ?? '-'}
                  disabled
                />
              </>
            ) : (
              <>
                <Select
                  label="Category"
                  value={form.categoryId}
                  onChange={(e) =>
                    // changing category clears a now-invalid group
                    setForm({
                      ...form,
                      categoryId: e.target.value,
                      groupId: '',
                    })
                  }
                  placeholder="— None —"
                  options={(categories ?? [])
                    .filter((c) => c.isActive)
                    .map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  label="Group"
                  required
                  value={form.groupId}
                  onChange={(e) =>
                    setForm({ ...form, groupId: e.target.value })
                  }
                  placeholder={
                    form.categoryId
                      ? 'Select a leaf group'
                      : 'Pick a category first'
                  }
                  options={groupOptions.map((g) => ({
                    value: g.id,
                    label: g.name,
                  }))}
                />
              </>
            )}

            <Input
              label="Rate per Hour"
              type="number"
              min={0}
              step="any"
              value={form.ratePerHour}
              onChange={(e) =>
                setForm({ ...form, ratePerHour: e.target.value })
              }
              onBlur={() =>
                setForm((f) => ({ ...f, ratePerHour: dec2(f.ratePerHour) }))
              }
              placeholder="Manpower cost per hour"
            />

            {/* Availability */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Availability</span>
              <Checkbox
                label="All companies (including ones added later)"
                checked={form.allCompanies}
                onChange={(e) =>
                  setForm({ ...form, allCompanies: e.target.checked })
                }
              />
              {!form.allCompanies && (
                <div className="mt-1 max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {companyList.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      No companies found.
                    </p>
                  ) : (
                    companyList.map((co) => (
                      <Checkbox
                        key={co.id}
                        label={`${co.name} (${co.code})`}
                        checked={form.companyIds.includes(co.id)}
                        onChange={() => toggleCompany(co.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
            </div>
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
