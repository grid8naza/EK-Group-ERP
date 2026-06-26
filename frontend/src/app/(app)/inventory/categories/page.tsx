'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Tags } from 'lucide-react';
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
import type { Category, Company } from '@/lib/types';

const ROUTE = '/inventory/categories';

const empty = {
  code: '',
  name: '',
  description: '',
  allCompanies: true,
  companyIds: [] as number[],
  forItem: true,
  forProduct: false,
  isActive: true,
};

export default function CategoriesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canToggle, toggleLock, guardEdit, guardDelete } = useLock<Category>({
    endpoint: '/categories',
    noun: 'category',
    nameOf: (c) => c.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<'code' | 'name'>('code');

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const nameById = new Map(companyList.map((c) => [c.id, c.name]));

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (c: Category) => ({
    code: c.code,
    name: c.name,
    description: c.description ?? '',
    allCompanies: c.allCompanies,
    companyIds: c.companyIds ?? [],
    forItem: c.forItem,
    forProduct: c.forProduct,
    isActive: c.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setView(false);
    setForm(formFrom(c));
    setOpen(true);
  };

  const openView = (c: Category) => {
    setEditing(c);
    setView(true);
    setForm(formFrom(c));
    setOpen(true);
  };

  const toggleCompany = (id: number) =>
    setForm((f) => ({
      ...f,
      companyIds: f.companyIds.includes(id)
        ? f.companyIds.filter((x) => x !== id)
        : [...f.companyIds, id],
    }));

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

  const save = async (again = false) => {
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
        await api.patch(`/categories/${editing.id}`, payload);
        toast.success('Category updated.');
      } else {
        await api.post('/categories', payload);
        toast.success('Category created.');
      }
      await refetch();
      if (again) {
        setEditing(null);
        setForm({ ...empty });
      } else {
        setOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Category) => {
    const ok = await confirm({
      title: 'Delete category',
      message: `Delete "${c.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/categories/${c.id}`);
      toast.success('Category deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const sortedRows = useMemo(() => {
    const rows = [...(data ?? [])];
    rows.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : a.code.localeCompare(b.code),
    );
    return rows;
  }, [data, sort]);

  const availabilityText = (c: Category) =>
    c.companyIds.map((id) => nameById.get(id) ?? `#${id}`).join(', ');

  const appliesTo = (c: Category) => {
    if (c.forItem && c.forProduct) return 'Item + Product';
    if (c.forItem) return 'Item';
    if (c.forProduct) return 'Product';
    return '-';
  };

  const columns: Column<Category>[] = [
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

  const title = view
    ? 'View Category'
    : editing
      ? 'Edit Category'
      : 'New Category';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Category Master"
        description="Categories for Items and Products — available to all or to selected companies"
        icon={<Tags className="h-5 w-5" />}
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
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search categories..."
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
        emptyMessage="No categories found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Category details"
        icon={<Tags className="h-5 w-5" />}
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
            <Input
              label="Code"
              required
              maxLength={30}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. RAW"
            />
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Raw Materials"
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
                  {form.companyIds.length} selected — the category is available
                  only in these companies.
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
