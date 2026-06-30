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
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Group, Category, Company } from '@/lib/types';

const ROUTE = '/inventory/groups';
const MAX_LEVEL = 5;

const empty = {
  parentGroupId: '', // '' = primary group
  categoryId: '',
  name: '',
  description: '',
  subGroupApplicable: false,
  allCompanies: true,
  companyIds: [] as number[],
  forItem: true,
  forProduct: false,
  isActive: true,
};

export default function GroupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Group[]>('/groups');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete } = useLock<Group>({
    endpoint: '/groups',
    route: ROUTE,
    noun: 'group',
    nameOf: (g) => g.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<'code' | 'name' | 'category'>('code');
  const [applies, setApplies] = useState(''); // '' | 'item' | 'product'
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
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
  // A sub-group inherits its parent's category; a primary group uses the picked one.
  const effectiveCategoryId = selectedParent
    ? selectedParent.categoryId
    : form.categoryId
      ? Number(form.categoryId)
      : undefined;
  const effectiveLevel = selectedParent ? selectedParent.level + 1 : 1;
  const canBeContainer = effectiveLevel < MAX_LEVEL;

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (g: Group) => ({
    parentGroupId: g.parentGroupId ? String(g.parentGroupId) : '',
    categoryId: String(g.categoryId),
    name: g.name,
    description: g.description ?? '',
    subGroupApplicable: g.subGroupApplicable,
    allCompanies: g.allCompanies,
    companyIds: g.companyIds ?? [],
    forItem: g.forItem,
    forProduct: g.forProduct,
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

  const openEdit = (g: Group) => {
    setEditing(g);
    setView(false);
    setForm(formFrom(g));
    setOpen(true);
  };

  const openView = (g: Group) => {
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

  const save = async (again = false) => {
    if (!selectedParent && !form.categoryId) {
      toast.error('Pick a category (primary group) or a parent group (sub-group).');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!form.forItem && !form.forProduct) {
      toast.error('Select Item, Product, or both.');
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
      if (editing) {
        // Hierarchy (category/parent/code/level) is immutable — send only the
        // editable fields.
        await api.patch(`/groups/${editing.id}`, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          subGroupApplicable: form.subGroupApplicable,
          allCompanies: form.allCompanies,
          companyIds: form.allCompanies ? [] : form.companyIds,
          forItem: form.forItem,
          forProduct: form.forProduct,
          isActive: form.isActive,
        });
        toast.success('Group updated.');
      } else {
        await api.post('/groups', {
          categoryId: effectiveCategoryId,
          parentGroupId: selectedParent ? selectedParent.id : undefined,
          subGroupApplicable: form.subGroupApplicable,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          allCompanies: form.allCompanies,
          companyIds: form.allCompanies ? [] : form.companyIds,
          forItem: form.forItem,
          forProduct: form.forProduct,
          isActive: form.isActive,
        });
        toast.success('Group created.');
      }
      await refetch();
      if (again) {
        // Fast entry: keep the placement (parent/category/availability), clear
        // only the per-record fields and refocus Name.
        setEditing(null);
        setForm((f) => ({ ...f, name: '', description: '' }));
        setTimeout(() => nameRef.current?.focus(), 0);
      } else {
        setOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: Group) => {
    const ok = await confirm({
      title: 'Delete group',
      message: `Delete "${g.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/groups/${g.id}`);
      toast.success('Group deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (g: Group) =>
    guardEdit(g, async () => {
      try {
        await api.patch(`/groups/${g.id}`, { isActive: !g.isActive });
        toast.success(g.isActive ? 'Group set inactive.' : 'Group set active.');
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
      }
    });

  const sortedRows = useMemo(() => {
    let rows = [...groupList];
    if (applies === 'item') rows = rows.filter((g) => g.forItem);
    else if (applies === 'product') rows = rows.filter((g) => g.forProduct);
    if (status === 'active') rows = rows.filter((g) => g.isActive);
    else if (status === 'inactive') rows = rows.filter((g) => !g.isActive);
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
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'category')
        return (
          (a.category?.name ?? '').localeCompare(b.category?.name ?? '') ||
          a.code.localeCompare(b.code)
        );
      return a.code.localeCompare(b.code); // hierarchical order
    });
    return rows;
  }, [groupList, sort, applies, status, primaryFilter, parentFilter]);

  const availabilityText = (g: Group) =>
    g.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  const appliesTo = (g: Group) => {
    if (g.forItem && g.forProduct) return 'Item + Product';
    if (g.forItem) return 'Item';
    if (g.forProduct) return 'Product';
    return '-';
  };

  const columns: Column<Group>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Name',
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
      render: (r) => (
        <Badge color={r.level === 1 ? 'blue' : 'slate'}>L{r.level}</Badge>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
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
    },
    {
      key: 'parent',
      header: 'Parent',
      accessor: (r) => r.parent?.name ?? '—',
    },
    {
      key: 'availability',
      header: 'Availability',
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
      key: 'appliesTo',
      header: 'Applies To',
      render: (r) => (
        <Badge color={r.forItem && r.forProduct ? 'green' : 'slate'}>
          {appliesTo(r)}
        </Badge>
      ),
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

  const title = view ? 'View Group' : editing ? 'Edit Group' : 'New Group';
  const effectiveCategoryName = categoryList.find(
    (c) => c.id === effectiveCategoryId,
  )?.name;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Group Master"
        description="Multilayer groups under a category (up to 5 levels) — for Items and Products, with auto-generated codes"
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
        rows={sortedRows}
        key={`${applies}|${status}|${primaryFilter}|${parentFilter}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search groups..."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={applies}
              onChange={(e) => setApplies(e.target.value)}
              wrapClassName="w-40"
              placeholder="Applies to: All"
              options={[
                { value: 'item', label: 'Item-wise' },
                { value: 'product', label: 'Product-wise' },
              ]}
            />
            <Select
              value={primaryFilter}
              onChange={(e) => setPrimaryFilter(e.target.value)}
              wrapClassName="w-48"
              placeholder="All primary groups"
              options={primaryGroups.map((g) => ({
                value: String(g.id),
                label: g.name,
              }))}
            />
            <Select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              wrapClassName="w-48"
              placeholder="Any parent group"
              options={parentCandidates.map((g) => ({
                value: String(g.id),
                label: `${'· '.repeat(g.level - 1)}${g.name}`,
              }))}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapClassName="w-36"
              placeholder="All statuses"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <span className="ml-1 text-sm text-slate-500 dark:text-slate-400">
              Sort by
            </span>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              wrapClassName="w-32"
              options={[
                { value: 'code', label: 'Code (tree)' },
                { value: 'name', label: 'Name' },
                { value: 'category', label: 'Category' },
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
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No groups found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Group details"
        icon={<Layers className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={() => save(false)}
              onSaveNew={editing ? undefined : () => save(true)}
              saving={saving}
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
                  label="Parent group"
                  value={editing.parent?.name ?? '— None (primary group) —'}
                  disabled
                  wrapClassName="sm:col-span-2"
                />
                <Input
                  label="Category"
                  value={editing.category?.name ?? ''}
                  disabled
                  wrapClassName="sm:col-span-2"
                />
              </>
            ) : (
              <>
                <Select
                  label="Parent group"
                  value={form.parentGroupId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      parentGroupId: e.target.value,
                      // When a parent is chosen the category comes from it.
                      categoryId: e.target.value ? '' : f.categoryId,
                    }))
                  }
                  placeholder="— None (primary group) —"
                  wrapClassName="sm:col-span-2"
                  options={parentCandidates
                    .filter((g) => g.isActive)
                    .map((g) => ({
                      value: String(g.id),
                      label: `${'· '.repeat(g.level - 1)}${g.name}  (${
                        g.category?.name ?? ''
                      })`,
                    }))}
                />
                {selectedParent ? (
                  <Input
                    label="Category"
                    value={effectiveCategoryName ?? ''}
                    disabled
                    wrapClassName="sm:col-span-2"
                  />
                ) : (
                  <Select
                    label="Category"
                    required
                    value={form.categoryId}
                    onChange={(e) =>
                      setForm({ ...form, categoryId: e.target.value })
                    }
                    placeholder="Select a category"
                    wrapClassName="sm:col-span-2"
                    options={categoryList
                      .filter((c) => c.isActive)
                      .map((c) => ({ value: c.id, label: c.name }))}
                  />
                )}
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
              placeholder="e.g. Steel"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
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
                  ? 'Items/products cannot be added here — only sub-groups.'
                  : 'Leaf group — items and products are created directly under it.'}
                {!canBeContainer &&
                  ` Level ${MAX_LEVEL} is the deepest, so it can’t hold sub-groups.`}
              </p>
            </div>

            {/* Applies to */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Applies to</span>
              <div className="flex items-center gap-5">
                <Checkbox
                  label="Item"
                  checked={form.forItem}
                  onChange={(e) =>
                    setForm({ ...form, forItem: e.target.checked })
                  }
                />
                <Checkbox
                  label="Product"
                  checked={form.forProduct}
                  onChange={(e) =>
                    setForm({ ...form, forProduct: e.target.checked })
                  }
                />
              </div>
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
                    <p className="text-sm text-slate-400">No companies found.</p>
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
                  {form.companyIds.length} selected — the group is available only
                  in these companies.
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
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
