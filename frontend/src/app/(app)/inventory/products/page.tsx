'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PackageOpen } from 'lucide-react';
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
import type { Product, Category, Group, Unit, HsnCode, Company } from '@/lib/types';

const ROUTE = '/inventory/products';

const empty = {
  code: '',
  name: '',
  description: '',
  categoryId: '',
  groupId: '',
  unitId: '',
  wholesalePrice: '0',
  intercompanyPrice: '0',
  retailPrice: '0',
  boxQty: '0',
  boxUnitId: '',
  hsnCodeId: '',
  shelfLife: '0',
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

export default function ProductsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: hsnCodes } = useFetch<HsnCode[]>('/hsn-codes');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete } = useLock<Product>({
    endpoint: '/products',
    route: ROUTE,
    noun: 'product',
    nameOf: (p) => p.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const codeRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const unitList = units ?? [];
  // Products use product categories/groups only.
  const productCategories = (categories ?? []).filter((c) => c.forProduct);
  const productGroups = (groups ?? []).filter((g) => g.forProduct);
  // Form: products attach to LEAF groups only (no sub-groups), restricted to
  // the chosen category.
  const groupOptions = productGroups.filter(
    (g) =>
      !g.subGroupApplicable &&
      g.isActive &&
      (!form.categoryId || String(g.categoryId) === form.categoryId),
  );
  // List filter: groups cascade from the category filter.
  const filterGroups = productGroups.filter(
    (g) => !categoryFilter || String(g.categoryId) === categoryFilter,
  );

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (p: Product) => ({
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    categoryId: p.categoryId != null ? String(p.categoryId) : '',
    groupId: p.groupId != null ? String(p.groupId) : '',
    unitId: String(p.unitId),
    wholesalePrice: String(p.wholesalePrice ?? 0),
    intercompanyPrice: String(p.intercompanyPrice ?? 0),
    retailPrice: String(p.retailPrice ?? 0),
    boxQty: String(p.boxQty ?? 0),
    boxUnitId: p.boxUnitId != null ? String(p.boxUnitId) : '',
    hsnCodeId: p.hsnCodeId != null ? String(p.hsnCodeId) : '',
    shelfLife: String(p.shelfLife ?? 0),
    allCompanies: p.allCompanies,
    companyIds: p.companyIds ?? [],
    isActive: p.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setView(false);
    setForm(formFrom(p));
    setOpen(true);
  };
  const openView = (p: Product) => {
    setEditing(p);
    setView(true);
    setForm(formFrom(p));
    setOpen(true);
  };

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

  const save = async (again = false) => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!form.groupId) {
      toast.error('Select a group — every product belongs to a leaf group.');
      return;
    }
    if (!form.unitId) {
      toast.error('Select a unit.');
      return;
    }
    if (!form.allCompanies && form.companyIds.length === 0) {
      toast.error('Select at least one company, or choose "All companies".');
      return;
    }

    const num = (s: string) => Number(s) || 0;
    const idOrNull = (s: string) => (s ? Number(s) : null);
    // Note: recipe/packing are intentionally omitted — the BOM is edited under
    // Production, and omitting them leaves the saved BOM untouched.
    const payload = {
      // code + category are derived server-side from the group.
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      groupId: Number(form.groupId),
      unitId: Number(form.unitId),
      wholesalePrice: num(form.wholesalePrice),
      intercompanyPrice: num(form.intercompanyPrice),
      retailPrice: num(form.retailPrice),
      boxQty: num(form.boxQty),
      boxUnitId: idOrNull(form.boxUnitId),
      hsnCodeId: idOrNull(form.hsnCodeId),
      shelfLife: num(form.shelfLife),
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        toast.success('Product updated.');
      } else {
        await api.post('/products', payload);
        toast.success('Product created.');
      }
      await refetch();
      if (again) {
        setEditing(null);
        setForm((f) => ({ ...f, name: '', description: '' }));
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

  const remove = async (p: Product) => {
    const ok = await confirm({
      title: 'Delete product',
      message: `Delete "${p.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success('Product deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (p: Product) =>
    guardEdit(p, async () => {
      try {
        await api.patch(`/products/${p.id}`, { isActive: !p.isActive });
        toast.success(
          p.isActive ? 'Product set inactive.' : 'Product set active.',
        );
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
      }
    });

  const visibleRows = useMemo(() => {
    let rows = [...(data ?? [])];
    if (categoryFilter)
      rows = rows.filter((r) => String(r.categoryId) === categoryFilter);
    if (groupFilter)
      rows = rows.filter((r) => String(r.groupId) === groupFilter);
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }, [data, categoryFilter, groupFilter, status]);

  const columns: Column<Product>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    { key: 'group', header: 'Group', accessor: (r) => r.group?.name ?? '-' },
    {
      key: 'name',
      header: 'Product',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'unit', header: 'Unit', accessor: (r) => r.unit?.code ?? '-' },
    {
      key: 'intercompanyPrice',
      header: 'Inter-Co',
      accessor: (r) => (r.intercompanyPrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.intercompanyPrice ?? 0,
    },
    {
      key: 'wholesalePrice',
      header: 'Wholesale',
      accessor: (r) => (r.wholesalePrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.wholesalePrice ?? 0,
    },
    {
      key: 'retailPrice',
      header: 'Retail',
      accessor: (r) => (r.retailPrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.retailPrice ?? 0,
    },
    { key: 'hsn', header: 'HSN', accessor: (r) => r.hsnCode?.code ?? '-' },
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

  const title = view ? 'View Product' : editing ? 'Edit Product' : 'New Product';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Product Master"
        description="Finished products — recipe & packing BOM are set under Production"
        icon={<PackageOpen className="h-5 w-5" />}
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
        key={`${categoryFilter}|${groupFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search products..."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setGroupFilter('');
              }}
              wrapClassName="w-44"
              placeholder="All categories"
              options={productCategories.map((c) => ({
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
              wrapClassName="w-36"
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
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No products found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Product details"
        icon={<PackageOpen className="h-5 w-5" />}
        width="lg"
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
              label="Code (auto)"
              value={editing ? editing.code : 'Generated from the group'}
              disabled
            />
            <Input
              ref={codeRef}
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Butter Bun"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
            />

            {/* Classification — immutable after creation (the code encodes it),
                so it's read-only when editing. To move a product, inactivate it
                and create a new one under the right group. */}
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
                    setForm({ ...form, categoryId: e.target.value, groupId: '' })
                  }
                  placeholder="— None —"
                  options={productCategories
                    .filter((c) => c.isActive)
                    .map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  label="Group"
                  required
                  value={form.groupId}
                  onChange={(e) => setForm({ ...form, groupId: e.target.value })}
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

            <Select
              label="Unit"
              required
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              placeholder="Select a unit"
              options={unitList.map((u) => ({
                value: u.id,
                label: u.name,
              }))}
            />
            <Input
              label="Intercompany Price"
              type="number"
              min={0}
              step="any"
              value={form.intercompanyPrice}
              onChange={(e) =>
                setForm({ ...form, intercompanyPrice: e.target.value })
              }
            />
            <Input
              label="Wholesale Price"
              type="number"
              min={0}
              step="any"
              value={form.wholesalePrice}
              onChange={(e) =>
                setForm({ ...form, wholesalePrice: e.target.value })
              }
            />
            <Input
              label="Retail Price"
              type="number"
              min={0}
              step="any"
              value={form.retailPrice}
              onChange={(e) =>
                setForm({ ...form, retailPrice: e.target.value })
              }
            />

            {/* Pack content */}
            <Input
              label="Box Quantity"
              type="number"
              min={0}
              step="any"
              value={form.boxQty}
              onChange={(e) => setForm({ ...form, boxQty: e.target.value })}
            />
            <Select
              label="Box Unit"
              value={form.boxUnitId}
              onChange={(e) => setForm({ ...form, boxUnitId: e.target.value })}
              placeholder="— None —"
              options={unitList.map((u) => ({
                value: u.id,
                label: u.name,
              }))}
            />

            <Select
              label="HSN Code"
              value={form.hsnCodeId}
              onChange={(e) => setForm({ ...form, hsnCodeId: e.target.value })}
              placeholder="— None —"
              options={(hsnCodes ?? []).map((h) => ({
                value: h.id,
                label: `${h.code} — ${h.description} (IGST ${h.igst}%)`,
              }))}
            />
            <Input
              label="Shelf Life (days)"
              type="number"
              min={0}
              value={form.shelfLife}
              onChange={(e) => setForm({ ...form, shelfLife: e.target.value })}
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
