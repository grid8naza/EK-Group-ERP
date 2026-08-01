'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Layers, ChevronDown, ChevronRight } from 'lucide-react';
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
import { Drawer, DrawerFooter, CloseFooter, type SaveMode } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { CATEGORY_KIND_LABEL, type Group, type Category, type Company } from '@/lib/types';

const ROUTE = '/inventory/groups';
const MAX_LEVEL = 5;

const empty = {
  parentGroupId: '', // '' = primary group
  // Categories this group serves. A list, because one group is shared: "Bakery"
  // names both the semi-finished and the finished category rather than being
  // typed out under each.
  categoryIds: [] as number[],
  name: '',
  description: '',
  subGroupApplicable: false,
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

export default function GroupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Group[]>('/groups');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Group>({
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
  const [applies, setApplies] = useState(''); // '' | 'item' | 'product'
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const [categoryFilter, setCategoryFilter] = useState('');
  const [primaryFilter, setPrimaryFilter] = useState('');
  const [parentFilter, setParentFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
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
  const effectiveLevel = selectedParent ? selectedParent.level + 1 : 1;
  const canBeContainer = effectiveLevel < MAX_LEVEL;

  // Categories lead: pick what the group serves, and the parent list narrows to
  // the groups that can hold it. A sub-group may only serve categories its
  // parent serves, so a candidate parent must serve every category ticked.
  const formParentOptions = parentCandidates.filter(
    (g) =>
      g.isActive && form.categoryIds.every((id) => g.categoryIds.includes(id)),
  );

  // On an existing group the parent is immutable, so there the dependency still
  // runs the other way: the categories on offer are the parent's own.
  const parentForCategories = editing
    ? groupList.find((g) => g.id === editing.parentGroupId)
    : undefined;
  const formCategoryOptions = categoryList.filter(
    (c) =>
      (c.isActive || form.categoryIds.includes(c.id)) &&
      (!parentForCategories || parentForCategories.categoryIds.includes(c.id)),
  );

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (g: Group) => ({
    parentGroupId: g.parentGroupId ? String(g.parentGroupId) : '',
    categoryIds: g.categoryIds ?? [],
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

  const toggleCategory = (id: number) =>
    setForm((f) => {
      const categoryIds = f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id];
      // The parent list is driven by these, so a parent that no longer serves
      // every ticked category drops out rather than being silently kept.
      const parent = f.parentGroupId
        ? groupList.find((g) => String(g.id) === f.parentGroupId)
        : undefined;
      const parentStillFits =
        !parent || categoryIds.every((c) => parent.categoryIds.includes(c));
      return {
        ...f,
        categoryIds,
        parentGroupId: parentStillFits ? f.parentGroupId : '',
      };
    });

  const save = async (mode: SaveMode = 'saveClose') => {
    if (form.categoryIds.length === 0) {
      toast.error('Select at least one category.');
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
      let saved: Group;
      if (editing) {
        // Placement (parent/code/level) is immutable — but the CATEGORIES are a
        // link table rather than part of the code, so they stay editable; the
        // server rejects a set that would strand a sub-group, item or product.
        saved = await api.patch<Group>(`/groups/${editing.id}`, {
          categoryIds: form.categoryIds,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          subGroupApplicable: form.subGroupApplicable,
          allCompanies: form.allCompanies,
          companyIds: form.allCompanies ? [] : form.companyIds,
          isActive: form.isActive,
        });
        toast.success('Group updated.');
      } else {
        saved = await api.post<Group>('/groups', {
          categoryIds: form.categoryIds,
          parentGroupId: selectedParent ? selectedParent.id : undefined,
          subGroupApplicable: form.subGroupApplicable,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          allCompanies: form.allCompanies,
          companyIds: form.allCompanies ? [] : form.companyIds,
          isActive: form.isActive,
        });
        toast.success('Group created.');
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

  // Rows after the filters; column ordering is handled by the table's sortable
  // headers (default: Code ascending = hierarchical tree order).
  const filteredRows = useMemo(() => {
    let rows = [...groupList];
    if (applies === 'item') rows = rows.filter((g) => g.forItem);
    else if (applies === 'product') rows = rows.filter((g) => g.forProduct);
    if (status === 'active') rows = rows.filter((g) => g.isActive);
    else if (status === 'inactive') rows = rows.filter((g) => !g.isActive);
    if (categoryFilter)
      rows = rows.filter((g) => g.categoryIds.includes(Number(categoryFilter)));
    // Primary group filter → the primary and its whole subtree (shared L1 code
    // prefix). Parent group filter → direct children only.
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
  }, [groupList, applies, status, categoryFilter, primaryFilter, parentFilter]);

  // Collapsed parents (by id). The listing is one long tree, so a group can be
  // folded away to get its sub-groups out of the way; nothing is collapsed until
  // asked, so the default view is unchanged.
  const groupById = useMemo(
    () => new Map(groupList.map((g) => [g.id, g])),
    [groupList],
  );
  // Which rows have children *within the current filters* — a chevron on a row
  // whose children are filtered out would fold nothing.
  const parentIds = useMemo(
    () =>
      new Set(
        filteredRows
          .map((g) => g.parentGroupId)
          .filter((id): id is number => id != null),
      ),
    [filteredRows],
  );
  const visibleRows = useMemo(() => {
    if (collapsed.size === 0) return filteredRows;
    return filteredRows.filter((g) => {
      // Hidden when any ancestor is folded, however deep the row sits.
      let node = g.parentGroupId ? groupById.get(g.parentGroupId) : undefined;
      while (node) {
        if (collapsed.has(node.id)) return false;
        node = node.parentGroupId ? groupById.get(node.parentGroupId) : undefined;
      }
      return true;
    });
  }, [filteredRows, collapsed, groupById]);

  const toggleCollapsed = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allCollapsed = parentIds.size > 0 && collapsed.size >= parentIds.size;

  const availabilityText = (g: Group) =>
    g.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  // A group serves several categories, so this is a list, not a single name.
  const categoryNames = (g: Group) =>
    (g.categories ?? [])
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b))
      .join(', ');

  const appliesTo = (g: Group) => {
    if (g.forItem && g.forProduct) return 'Item + Product';
    if (g.forItem) return 'Item';
    if (g.forProduct) return 'Product';
    return '-';
  };

  const columns: Column<Group>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code, sortable: true },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortAccessor: (r) => r.name,
      render: (r) => {
        const hasChildren = parentIds.has(r.id);
        const isCollapsed = collapsed.has(r.id);
        return (
          <span
            className="flex items-center font-medium text-slate-800 dark:text-slate-100"
            style={{ paddingLeft: (r.level - 1) * 18 }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(r.id);
                }}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? 'Expand' : 'Collapse'}
                className="mr-1 flex-none rounded p-0.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-600 dark:hover:bg-slate-700"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            ) : (
              // Keeps the names on one line whether or not a row folds.
              <span className="mr-1 inline-block h-5 w-5 flex-none" />
            )}
            {r.level > 1 && <span className="mr-1 text-slate-400">↳</span>}
            {r.name}
          </span>
        );
      },
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
      header: 'Categories',
      sortable: true,
      sortAccessor: (r) => categoryNames(r),
      render: (r) => (
        <span title={categoryNames(r)}>{categoryNames(r) || '-'}</span>
      ),
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
      key: 'appliesTo',
      header: 'Applies To',
      sortable: true,
      sortAccessor: (r) => appliesTo(r),
      render: (r) => (
        <Badge color={r.forItem && r.forProduct ? 'green' : 'slate'}>
          {appliesTo(r)}
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

  const title = view ? 'View Group' : editing ? 'Edit Group' : 'New Group';
  // Code of the primary group chosen in the filter (used to scope the parent
  // filter to that primary's subtree).
  const primaryGroupCode = primaryFilter
    ? groupList.find((g) => String(g.id) === primaryFilter)?.code
    : undefined;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Group Master"
        description="One shared group tree (up to 5 levels) — each group serves one or more categories, so the same sub-groups are entered once"
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
        rows={visibleRows}
        defaultSort={{ key: 'code', dir: 'asc' }}
        key={`${applies}|${status}|${categoryFilter}|${primaryFilter}|${parentFilter}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search groups..."
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
                    !categoryFilter ||
                    g.categoryIds.includes(Number(categoryFilter)),
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
                      g.categoryIds.includes(Number(categoryFilter))) &&
                    // When a primary group is chosen, only parents within its
                    // subtree (sharing the primary's L1 code prefix).
                    (!primaryGroupCode ||
                      g.code.startsWith(primaryGroupCode.slice(0, 4))),
                )
                .map((g) => ({
                  value: String(g.id),
                  label: `${'· '.repeat(g.level - 1)}${g.name}`,
                }))}
            />
            <Select
              value={applies}
              onChange={(e) => setApplies(e.target.value)}
              wrapClassName="w-36"
              placeholder="Applies to: All"
              options={[
                { value: 'item', label: 'Item-wise' },
                { value: 'product', label: 'Product-wise' },
              ]}
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
            {parentIds.size > 0 && (
              <button
                type="button"
                className="btn-secondary whitespace-nowrap"
                onClick={() =>
                  setCollapsed(allCollapsed ? new Set() : new Set(parentIds))
                }
              >
                {allCollapsed ? (
                  <>
                    <ChevronDown className="h-4 w-4" /> Expand all
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-4 w-4" /> Collapse all
                  </>
                )}
              </button>
            )}
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
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Categories first — they decide the rest. A group is SHARED, so
                it can serve more than one: that is what stops the same
                sub-groups being re-entered under every category ("Bakery" is
                one group in both the semi-finished and the finished category),
                and it is what the parent list below is drawn from. */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">
                Categories <span className="text-rose-500">*</span>
              </span>
              <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {formCategoryOptions.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {parentForCategories
                      ? 'The parent group belongs to no category.'
                      : 'No categories found.'}
                  </p>
                ) : (
                  formCategoryOptions.map((c) => (
                    <Checkbox
                      key={c.id}
                      label={`${c.name} — ${CATEGORY_KIND_LABEL[c.kind]}`}
                      checked={form.categoryIds.includes(c.id)}
                      onChange={() => toggleCategory(c.id)}
                    />
                  ))
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {form.categoryIds.length} selected
                {parentForCategories
                  ? ' — limited to the parent group’s categories.'
                  : '. Pick every category this group should appear under.'}
              </p>
            </div>

            {/* Placement: primary (top of a tree) vs sub-group (under a parent).
                Immutable once created, so it's read-only when editing. To
                reposition, inactivate this group and create a new one. */}
            {editing ? (
              <Input
                label="Parent group"
                value={editing.parent?.name ?? '— None (primary group) —'}
                disabled
                wrapClassName="sm:col-span-2"
              />
            ) : (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Select
                  label="Parent group"
                  value={form.parentGroupId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, parentGroupId: e.target.value }))
                  }
                  placeholder="— None (primary group) —"
                  options={formParentOptions.map((g) => ({
                    value: String(g.id),
                    label: `${'· '.repeat(g.level - 1)}${g.name}`,
                  }))}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {form.categoryIds.length === 0
                    ? 'Leave empty for a primary group. Pick the categories above to narrow this list.'
                    : `Only groups serving ${
                        form.categoryIds.length === 1
                          ? 'that category'
                          : 'all those categories'
                      } can hold this one — leave empty for a primary group.`}
                </p>
              </div>
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

            {/* "Applies to" is no longer entered here: it follows from the
                kinds of the categories ticked above (Ingredients / Packing
                Materials ⇒ items, Semifinished / Finished ⇒ products). */}

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
