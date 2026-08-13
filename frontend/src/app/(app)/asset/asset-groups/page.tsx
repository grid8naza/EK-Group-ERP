'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Layers } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
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
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { AssetGroup, AssetCategory, Company } from '@/lib/types';

const ROUTE = '/asset/asset-groups';
const MAX_LEVEL = 5;

const empty = {
  parentGroupId: '', // '' = primary group
  categoryId: '',
  name: '',
  description: '',
  subGroupApplicable: false,
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

export default function AssetGroupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<AssetGroup[]>('/asset-groups');
  const { data: categories } = useFetch<AssetCategory[]>('/asset-categories');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<AssetGroup>({
      endpoint: '/asset-groups',
      route: ROUTE,
      noun: 'asset group',
      nameOf: (g) => g.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AssetGroup | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const [categoryFilter, setCategoryFilter] = useState('');
  const [primaryFilter, setPrimaryFilter] = useState('');
  const [parentFilter, setParentFilter] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const categoryList = categories ?? [];
  const groupList = data ?? [];
  const companyList = companies ?? [];
  const companyNameById = new Map(companyList.map((c) => [c.id, c.name]));

  // Groups that may act as a parent: containers (sub-group applicable) not yet
  // at the deepest level.
  const parentCandidates = useMemo(
    () => groupList.filter((g) => g.subGroupApplicable && g.level < MAX_LEVEL),
    [groupList],
  );
  const primaryGroups = useMemo(
    () => groupList.filter((g) => g.level === 1),
    [groupList],
  );

  const selectedParent = form.parentGroupId
    ? groupList.find((g) => String(g.id) === form.parentGroupId)
    : undefined;
  // Category is always picked first; a sub-group simply nests under a parent in
  // that same category.
  const effectiveCategoryId = form.categoryId
    ? Number(form.categoryId)
    : undefined;
  const effectiveLevel = selectedParent ? selectedParent.level + 1 : 1;
  const canBeContainer = effectiveLevel < MAX_LEVEL;
  // Parent options for the form: active containers (level < 5) within the
  // chosen category.
  const formParentOptions = parentCandidates.filter(
    (g) =>
      g.isActive &&
      (!form.categoryId || String(g.categoryId) === form.categoryId),
  );

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (g: AssetGroup) => ({
    parentGroupId: g.parentGroupId ? String(g.parentGroupId) : '',
    categoryId: String(g.categoryId),
    name: g.name,
    description: g.description ?? '',
    subGroupApplicable: g.subGroupApplicable,
    allCompanies: g.allCompanies,
    companyIds: g.companyIds ?? [],
    isActive: g.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
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

  const openEdit = (g: AssetGroup) => {
    setEditing(g);
    setView(false);
    setForm(formFrom(g));
    setOpen(true);
  };

  const openView = (g: AssetGroup) => {
    setEditing(g);
    setView(true);
    setForm(formFrom(g));
    setOpen(true);
  };

  const toggleCompany = (id: number) =>
    setForm((f) => ({
      ...f,
      companyIds: f.companyIds.includes(id)
        ? f.companyIds.filter((x) => x !== id)
        : [...f.companyIds, id],
    }));

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.categoryId) {
      toast.error('Select a category.');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.subGroupApplicable && !canBeContainer) {
      toast.error(`A level-${MAX_LEVEL} group cannot have sub-groups.`);
      return;
    }
    if (!form.allCompanies && form.companyIds.length === 0) {
      toast.error('Select at least one company, or choose "All companies".');
      return;
    }

    setSaving(true);
    try {
      let saved: AssetGroup;
      if (editing) {
        // Hierarchy (category/parent/code/level) is immutable — send only the
        // editable fields.
        saved = await api.patch<AssetGroup>(`/asset-groups/${editing.id}`, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          subGroupApplicable: form.subGroupApplicable,
          allCompanies: form.allCompanies,
          companyIds: form.allCompanies ? [] : form.companyIds,
          isActive: form.isActive,
        });
        toast.success('Asset group updated.');
      } else {
        saved = await api.post<AssetGroup>('/asset-groups', {
          categoryId: effectiveCategoryId,
          parentGroupId: selectedParent ? selectedParent.id : undefined,
          subGroupApplicable: form.subGroupApplicable,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          allCompanies: form.allCompanies,
          companyIds: form.allCompanies ? [] : form.companyIds,
          isActive: form.isActive,
        });
        toast.success('Asset group created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        // Fast entry: keep the placement (parent/category/availability), clear
        // only the per-record fields and refocus Name.
        setEditing(null);
        setForm((f) => ({ ...f, name: '', description: '' }));
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

  const remove = async (g: AssetGroup) => {
    const ok = await confirm({
      title: 'Delete asset group',
      message: `Delete "${g.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/asset-groups/${g.id}`);
      toast.success('Asset group deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (g: AssetGroup) =>
    guardEdit(g, async () => {
      try {
        await api.patch(`/asset-groups/${g.id}`, { isActive: !g.isActive });
        toast.success(
          g.isActive ? 'Asset group set inactive.' : 'Asset group set active.',
        );
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
      }
    });

  // Rows after the filters; column ordering is handled by the table's sortable
  // headers (default: Code ascending = hierarchical tree order).
  const filteredRows = useMemo(() => {
    let rows = [...groupList];
    if (status === 'active') rows = rows.filter((g) => g.isActive);
    else if (status === 'inactive') rows = rows.filter((g) => !g.isActive);
    if (categoryFilter)
      rows = rows.filter((g) => String(g.categoryId) === categoryFilter);
    // Primary group filter → the primary and its whole subtree (shared CC+L1
    // code prefix). Parent group filter → direct children only.
    if (primaryFilter) {
      const primary = groupList.find((g) => String(g.id) === primaryFilter);
      if (primary) {
        const prefix = primary.code.slice(0, 4);
        rows = rows.filter((g) => g.code.startsWith(prefix));
      }
    }
    if (parentFilter) {
      rows = rows.filter((g) => String(g.parentGroupId ?? '') === parentFilter);
    }
    return rows;
  }, [groupList, status, categoryFilter, primaryFilter, parentFilter]);

  const availabilityText = (g: AssetGroup) =>
    g.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  const columns: Column<AssetGroup>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code, sortable: true },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span
          className="font-medium text-slate-800 dark:text-slate-100"
          style={{ paddingLeft: (r.level - 1) * 18 }}
        >
          {r.level > 1 && <span className="mr-1 text-slate-400">↳</span>}
          {r.name}
        </span>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      sortable: true,
      sortAccessor: (r) => r.level,
      render: (r) => (
        <Badge color={r.level === 1 ? 'blue' : 'slate'}>L{r.level}</Badge>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      sortable: true,
      sortAccessor: (r) => (r.subGroupApplicable ? 'Sub-groups' : 'Leaf'),
      render: (r) =>
        r.subGroupApplicable ? (
          <Badge color="violet">Sub-groups</Badge>
        ) : (
          <Badge color="green">Leaf</Badge>
        ),
    },
    {
      key: 'category',
      header: 'Category',
      accessor: (r) => r.category?.name ?? '-',
      sortable: true,
    },
    {
      key: 'parent',
      header: 'Parent',
      accessor: (r) => r.parent?.name ?? '—',
      sortable: true,
      sortAccessor: (r) => r.parent?.name ?? '',
    },
    {
      key: 'availability',
      header: 'Availability',
      sortable: true,
      sortAccessor: (r) => (r.allCompanies ? Infinity : r.companyIds.length),
      render: (r) =>
        r.allCompanies ? (
          <Badge color="violet">All companies</Badge>
        ) : (
          <Badge color="blue">
            <span title={availabilityText(r)}>
              {r.companyIds.length}{' '}
              {r.companyIds.length === 1 ? 'company' : 'companies'}
            </span>
          </Badge>
        ),
    },
    {
      key: 'isActive',
      header: 'Status',
      sortable: true,
      sortAccessor: (r) => (r.isActive ? 'Active' : 'Inactive'),
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const title = view
    ? 'View Asset Group'
    : editing
      ? 'Edit Asset Group'
      : 'New Asset Group';
  // Code of the primary group chosen in the filter (used to scope the parent
  // filter to that primary's subtree).
  const primaryGroupCode = primaryFilter
    ? groupList.find((g) => String(g.id) === primaryFilter)?.code
    : undefined;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Asset Group Master"
        description="Multilayer asset groups under a category (up to 5 levels), with auto-generated codes"
        icon={<Layers className="h-5 w-5" />}
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
        rows={filteredRows}
        defaultSort={{ key: 'code', dir: 'asc' }}
        key={`${status}|${categoryFilter}|${primaryFilter}|${parentFilter}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search asset groups..."
        rowClassName={(r) =>
          r.level === 1
            ? 'bg-brand-100/70 hover:!bg-brand-200/60 dark:bg-brand-950/40 dark:hover:!bg-brand-900/40'
            : undefined
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={categoryFilter}
              onChange={(e) => {
                // Changing category resets the primary/parent narrowing.
                setCategoryFilter(e.target.value);
                setPrimaryFilter('');
                setParentFilter('');
              }}
              wrapClassName="w-40"
              placeholder="All categories"
              options={categoryList.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
            <Select
              value={primaryFilter}
              onChange={(e) => {
                // Switching the primary group invalidates a parent from another.
                setPrimaryFilter(e.target.value);
                setParentFilter('');
              }}
              wrapClassName="w-40"
              placeholder="All primary groups"
              options={primaryGroups
                .filter(
                  (g) =>
                    !categoryFilter || String(g.categoryId) === categoryFilter,
                )
                .map((g) => ({ value: String(g.id), label: g.name }))}
            />
            <Select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              wrapClassName="w-40"
              placeholder="Any parent group"
              options={parentCandidates
                .filter(
                  (g) =>
                    (!categoryFilter ||
                      String(g.categoryId) === categoryFilter) &&
                    // When a primary group is chosen, only parents within its
                    // subtree (sharing the primary's CC+L1 code prefix).
                    (!primaryGroupCode ||
                      g.code.startsWith(primaryGroupCode.slice(0, 4))),
                )
                .map((g) => ({
                  value: String(g.id),
                  label: `${'· '.repeat(g.level - 1)}${g.name}`,
                }))}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapClassName="w-32"
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
        emptyMessage="No asset groups found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Asset group details"
        icon={<Layers className="h-5 w-5" />}
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
            {/* Placement: primary (category) vs sub-group (parent). Immutable
                once created, so it's read-only when editing. To reposition,
                inactivate this group and create a new one. */}
            {editing ? (
              <>
                <Input
                  label="Category"
                  value={editing.category?.name ?? ''}
                  disabled
                  wrapClassName="sm:col-span-2"
                />
                <Input
                  label="Parent group"
                  value={editing.parent?.name ?? '— None (primary group) —'}
                  disabled
                  wrapClassName="sm:col-span-2"
                />
              </>
            ) : (
              <>
                {/* Category first, then a parent group within that category. */}
                <Select
                  label="Category"
                  required
                  value={form.categoryId}
                  onChange={(e) =>
                    // Changing the category invalidates a parent from another one.
                    setForm({
                      ...form,
                      categoryId: e.target.value,
                      parentGroupId: '',
                    })
                  }
                  placeholder="Select a category"
                  wrapClassName="sm:col-span-2"
                  options={categoryList
                    .filter((c) => c.isActive)
                    .map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  label="Parent group"
                  value={form.parentGroupId}
                  disabled={!form.categoryId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, parentGroupId: e.target.value }))
                  }
                  placeholder={
                    form.categoryId
                      ? '— None (primary group) —'
                      : 'Pick a category first'
                  }
                  wrapClassName="sm:col-span-2"
                  options={formParentOptions.map((g) => ({
                    value: String(g.id),
                    label: `${'· '.repeat(g.level - 1)}${g.name}`,
                  }))}
                />
              </>
            )}

            {editing && (
              <Input
                label="Code (auto)"
                value={editing.code}
                disabled
                wrapClassName="sm:col-span-2"
              />
            )}

            <Input
              label="Level"
              value={`Level ${editing ? editing.level : effectiveLevel}${
                (editing ? editing.level : effectiveLevel) === 1
                  ? ' (primary)'
                  : ''
              }`}
              disabled
            />

            <Input
              ref={nameRef}
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Forklifts"
            />
            {/* Sub-group applicable */}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Checkbox
                label="Sub-group applicable (this group holds sub-groups)"
                checked={form.subGroupApplicable}
                disabled={!canBeContainer && !form.subGroupApplicable}
                onChange={(e) =>
                  setForm({ ...form, subGroupApplicable: e.target.checked })
                }
              />
              <p className="ml-6 text-xs text-slate-500 dark:text-slate-400">
                {form.subGroupApplicable
                  ? 'Assets cannot be added here — only sub-groups.'
                  : 'Leaf group — assets are created directly under it.'}
                {!canBeContainer &&
                  ` Level ${MAX_LEVEL} is the deepest, so it can’t hold sub-groups.`}
              </p>
            </div>

            {/* Availability — all companies or a chosen set */}
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
              {!form.allCompanies && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {form.companyIds.length} selected — the asset group is
                  available only in these companies.
                </p>
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

            {/* Description — kept at the very bottom of the form. */}
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
