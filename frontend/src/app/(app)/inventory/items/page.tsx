'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Box } from 'lucide-react';
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
import type { Item, Category, Group, Unit, HsnCode, Company } from '@/lib/types';

const ROUTE = '/inventory/items';

const empty = {
  code: '',
  name: '',
  description: '',
  categoryId: '',
  groupId: '',
  unitId: '',
  unitPrice: '0',
  boxQty: '0',
  boxUnitId: '',
  hsnCodeId: '',
  minimumStock: '0',
  maximumStock: '0',
  reorderLevel: '0',
  leadTime: '0',
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

export default function ItemsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Item[]>('/items');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: hsnCodes } = useFetch<HsnCode[]>('/hsn-codes');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete } = useLock<Item>({
    endpoint: '/items',
    route: ROUTE,
    noun: 'item',
    nameOf: (i) => i.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<'code' | 'name' | 'category'>('code');
  const codeRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const unitList = units ?? [];
  const companyNameById = new Map(companyList.map((c) => [c.id, c.name]));
  // Groups are restricted to the chosen category (a group lives under one).
  const groupOptions = (groups ?? []).filter(
    (g) => !form.categoryId || String(g.categoryId) === form.categoryId,
  );

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (i: Item) => ({
    code: i.code,
    name: i.name,
    description: i.description ?? '',
    categoryId: i.categoryId != null ? String(i.categoryId) : '',
    groupId: i.groupId != null ? String(i.groupId) : '',
    unitId: String(i.unitId),
    unitPrice: String(i.unitPrice ?? 0),
    boxQty: String(i.boxQty ?? 0),
    boxUnitId: i.boxUnitId != null ? String(i.boxUnitId) : '',
    hsnCodeId: i.hsnCodeId != null ? String(i.hsnCodeId) : '',
    minimumStock: String(i.minimumStock ?? 0),
    maximumStock: String(i.maximumStock ?? 0),
    reorderLevel: String(i.reorderLevel ?? 0),
    leadTime: String(i.leadTime ?? 0),
    allCompanies: i.allCompanies,
    companyIds: i.companyIds ?? [],
    isActive: i.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (i: Item) => {
    setEditing(i);
    setView(false);
    setForm(formFrom(i));
    setOpen(true);
  };
  const openView = (i: Item) => {
    setEditing(i);
    setView(true);
    setForm(formFrom(i));
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

  const save = async (again = false) => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and Name are required.');
      return;
    }
    if (!form.unitId) {
      toast.error('Select a stock unit.');
      return;
    }
    if (!form.allCompanies && form.companyIds.length === 0) {
      toast.error('Select at least one company, or choose "All companies".');
      return;
    }

    const num = (s: string) => Number(s) || 0;
    const idOrNull = (s: string) => (s ? Number(s) : null);
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      categoryId: idOrNull(form.categoryId),
      groupId: idOrNull(form.groupId),
      unitId: Number(form.unitId),
      unitPrice: num(form.unitPrice),
      boxQty: num(form.boxQty),
      boxUnitId: idOrNull(form.boxUnitId),
      hsnCodeId: idOrNull(form.hsnCodeId),
      minimumStock: num(form.minimumStock),
      maximumStock: num(form.maximumStock),
      reorderLevel: num(form.reorderLevel),
      leadTime: num(form.leadTime),
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/items/${editing.id}`, payload);
        toast.success('Item updated.');
      } else {
        await api.post('/items', payload);
        toast.success('Item created.');
      }
      await refetch();
      if (again) {
        // Fast entry: keep the context (category, group, unit, HSN, pricing,
        // stock levels, availability), clear only the identity fields and
        // refocus Code.
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

  const remove = async (i: Item) => {
    const ok = await confirm({
      title: 'Delete item',
      message: `Delete "${i.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/items/${i.id}`);
      toast.success('Item deleted.');
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

  const availabilityText = (i: Item) =>
    i.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  const columns: Column<Item>[] = [
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
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    { key: 'unit', header: 'Unit', accessor: (r) => r.unit?.code ?? '-' },
    {
      key: 'unitPrice',
      header: 'Unit Price',
      accessor: (r) => (r.unitPrice ?? 0).toLocaleString(),
    },
    { key: 'hsn', header: 'HSN', accessor: (r) => r.hsnCode?.code ?? '-' },
    {
      key: 'reorderLevel',
      header: 'Reorder',
      accessor: (r) => (r.reorderLevel ?? 0).toLocaleString(),
    },
    {
      key: 'availability',
      header: 'Availability',
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
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const title = view ? 'View Item' : editing ? 'Edit Item' : 'New Item';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Item Master"
        description="Items with unit, pricing, packing, HSN/GST and stock-control levels"
        icon={<Box className="h-5 w-5" />}
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
        searchPlaceholder="Search items..."
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
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No items found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Item details"
        icon={<Box className="h-5 w-5" />}
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
              ref={codeRef}
              label="Code"
              required
              maxLength={40}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. ITM-0001"
            />
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Wheat Flour 1kg"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
            />

            {/* Classification */}
            <Select
              label="Category"
              value={form.categoryId}
              onChange={(e) =>
                // changing category clears a now-invalid group
                setForm({ ...form, categoryId: e.target.value, groupId: '' })
              }
              placeholder="— None —"
              options={(categories ?? []).map((c) => ({
                value: c.id,
                label: `${c.code} — ${c.name}`,
              }))}
            />
            <Select
              label="Group"
              value={form.groupId}
              onChange={(e) => setForm({ ...form, groupId: e.target.value })}
              placeholder="— None —"
              options={groupOptions.map((g) => ({
                value: g.id,
                label: `${g.code} — ${g.name}`,
              }))}
            />

            {/* Unit & pricing */}
            <Select
              label="Stock Unit"
              required
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              placeholder="Select a unit"
              options={unitList.map((u) => ({
                value: u.id,
                label: `${u.code} — ${u.name}`,
              }))}
            />
            <Input
              label="Unit Price"
              type="number"
              min={0}
              step="any"
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
            />

            {/* Packing */}
            <Input
              label="Box Qty"
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
                label: `${u.code} — ${u.name}`,
              }))}
            />

            {/* Tax */}
            <Select
              label="HSN Code"
              value={form.hsnCodeId}
              onChange={(e) => setForm({ ...form, hsnCodeId: e.target.value })}
              placeholder="— None —"
              wrapClassName="sm:col-span-2"
              options={(hsnCodes ?? []).map((h) => ({
                value: h.id,
                label: `${h.code} — ${h.description} (IGST ${h.igst}%)`,
              }))}
            />

            {/* Stock control */}
            <Input
              label="Minimum Stock"
              type="number"
              min={0}
              step="any"
              value={form.minimumStock}
              onChange={(e) =>
                setForm({ ...form, minimumStock: e.target.value })
              }
            />
            <Input
              label="Maximum Stock"
              type="number"
              min={0}
              step="any"
              value={form.maximumStock}
              onChange={(e) =>
                setForm({ ...form, maximumStock: e.target.value })
              }
            />
            <Input
              label="Reorder Level"
              type="number"
              min={0}
              step="any"
              value={form.reorderLevel}
              onChange={(e) =>
                setForm({ ...form, reorderLevel: e.target.value })
              }
            />
            <Input
              label="Lead Time (days)"
              type="number"
              min={0}
              value={form.leadTime}
              onChange={(e) => setForm({ ...form, leadTime: e.target.value })}
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
