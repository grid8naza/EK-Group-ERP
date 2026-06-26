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
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Group, Category, Company } from '@/lib/types';

const ROUTE = '/inventory/groups';

const empty = {
  categoryId: '',
  code: '',
  name: '',
  description: '',
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
  const { canToggle, toggleLock, guardEdit, guardDelete } = useLock<Group>({
    endpoint: '/groups',
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
  const codeRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const categoryList = categories ?? [];
  const companyList = companies ?? [];
  const companyNameById = new Map(companyList.map((c) => [c.id, c.name]));

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (g: Group) => ({
    categoryId: String(g.categoryId),
    code: g.code,
    name: g.name,
    description: g.description ?? '',
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
    if (!form.categoryId) {
      toast.error('Select a parent category.');
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and Name are required.');
      return;
    }
    if (!form.forItem && !form.forProduct) {
      toast.error('Select Item, Product, or both.');
      return;
    }
    if (!form.allCompanies && form.companyIds.length === 0) {
      toast.error('Select at least one company, or choose "All companies".');
      return;
    }

    const payload = {
      categoryId: Number(form.categoryId),
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      forItem: form.forItem,
      forProduct: form.forProduct,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/groups/${editing.id}`, payload);
        toast.success('Group updated.');
      } else {
        await api.post('/groups', payload);
        toast.success('Group created.');
      }
      await refetch();
      if (again) {
        // Fast entry: keep the context (category, applies-to, availability),
        // clear only the per-record fields and refocus Code.
        setEditing(null);
        setForm((f) => ({ ...f, code: '', name: '', description: '' }));
        setTimeout(() => codeRef.current?.focus(), 0);
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

  const sortedRows = useMemo(() => {
    const rows = [...(data ?? [])];
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'category')
        return (
          (a.category?.name ?? '').localeCompare(b.category?.name ?? '') ||
          a.name.localeCompare(b.name)
        );
      return a.code.localeCompare(b.code);
    });
    return rows;
  }, [data, sort]);

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

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Group Master"
        description="Groups under a category — for Items and Products, available to all or selected companies"
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
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={refetch}
        searchPlaceholder="Search groups..."
        toolbar={
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Sort by
            </span>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              wrapClassName="w-36"
              options={[
                { value: 'code', label: 'Code' },
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
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canToggle={canToggle}
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
            <Select
              label="Category"
              required
              value={form.categoryId}
              onChange={(e) =>
                setForm({ ...form, categoryId: e.target.value })
              }
              placeholder="Select a category"
              wrapClassName="sm:col-span-2"
              options={categoryList.map((c) => ({
                value: c.id,
                label: `${c.code} — ${c.name}`,
              }))}
            />
            <Input
              ref={codeRef}
              label="Code"
              required
              maxLength={30}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. FLOUR"
            />
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Flours"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
            />

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
