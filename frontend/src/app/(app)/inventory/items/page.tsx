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
import { StatusToggle } from '@/components/ui/StatusToggle';
import { Drawer, DrawerFooter, CloseFooter, type SaveMode } from '@/components/ui/Drawer';
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
  lastPurchasePrice: '0',
  lastPurchaseDate: '',
  boxQty: '0',
  boxUnitId: '',
  hsnCodeId: '',
  minimumStock: '0',
  maximumStock: '0',
  reorderLevel: '0',
  leadTime: '0',
  shelfLife: '0',
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
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Item>({
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
  // List filters (empty string = no filter). Group choices cascade from the
  // selected category.
  const [categoryFilter, setCategoryFilter] = useState('');
  const [primaryFilter, setPrimaryFilter] = useState('');
  const [parentFilter, setParentFilter] = useState('');
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const codeRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const unitList = units ?? [];
  const companyNameById = new Map(companyList.map((c) => [c.id, c.name]));
  // Items attach to LEAF groups only (no sub-groups) that apply to items,
  // within the chosen category.
  const groupOptions = (groups ?? []).filter(
    (g) =>
      !g.subGroupApplicable &&
      g.forItem &&
      g.isActive &&
      (!form.categoryId || String(g.categoryId) === form.categoryId),
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
    lastPurchasePrice: String(i.lastPurchasePrice ?? 0),
    lastPurchaseDate: i.lastPurchaseDate ? i.lastPurchaseDate.slice(0, 10) : '',
    boxQty: String(i.boxQty ?? 0),
    boxUnitId: i.boxUnitId != null ? String(i.boxUnitId) : '',
    hsnCodeId: i.hsnCodeId != null ? String(i.hsnCodeId) : '',
    minimumStock: String(i.minimumStock ?? 0),
    maximumStock: String(i.maximumStock ?? 0),
    reorderLevel: String(i.reorderLevel ?? 0),
    leadTime: String(i.leadTime ?? 0),
    shelfLife: String(i.shelfLife ?? 0),
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

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!form.groupId) {
      toast.error('Select a group — every item belongs to a leaf group.');
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
      // code + category are derived server-side from the group.
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      groupId: Number(form.groupId),
      unitId: Number(form.unitId),
      lastPurchasePrice: num(form.lastPurchasePrice),
      lastPurchaseDate: form.lastPurchaseDate || null,
      boxQty: num(form.boxQty),
      boxUnitId: idOrNull(form.boxUnitId),
      hsnCodeId: idOrNull(form.hsnCodeId),
      minimumStock: num(form.minimumStock),
      maximumStock: num(form.maximumStock),
      reorderLevel: num(form.reorderLevel),
      leadTime: num(form.leadTime),
      shelfLife: num(form.shelfLife),
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: Item;
      if (editing) {
        saved = await api.patch<Item>(`/items/${editing.id}`, payload);
        toast.success('Item updated.');
      } else {
        saved = await api.post<Item>('/items', payload);
        toast.success('Item created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        // Fast entry: keep the context (category, group, unit, HSN, pricing,
        // stock levels, availability), clear only the identity fields and
        // refocus Name.
        setEditing(null);
        setForm((f) => ({ ...f, name: '', description: '' }));
        setTimeout(() => codeRef.current?.focus(), 0);
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

  // Retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (i: Item) =>
    guardEdit(i, async () => {
      try {
        await api.patch(`/items/${i.id}`, { isActive: !i.isActive });
        toast.success(i.isActive ? 'Item set inactive.' : 'Item set active.');
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
      }
    });

  // Group lookups for the primary/parent list filters (rows attach to a leaf
  // group via r.groupId; resolve it to apply the same subtree/child predicates
  // as the Group Master).
  const groupById = useMemo(
    () => new Map((groups ?? []).map((g) => [g.id, g])),
    [groups],
  );
  // This master is items-only, so the group filters list item groups only.
  const primaryGroups = useMemo(
    () => (groups ?? []).filter((g) => g.level === 1 && g.forItem),
    [groups],
  );
  const primaryGroupCode = primaryFilter
    ? (groups ?? []).find((g) => String(g.id) === primaryFilter)?.code
    : undefined;

  // Rows after filters; column ordering is handled by the table's sortable
  // headers (default: Code ascending).
  const visibleRows = useMemo(() => {
    let rows = [...(data ?? [])];
    if (categoryFilter)
      rows = rows.filter((r) => String(r.categoryId) === categoryFilter);
    if (primaryFilter) {
      const primary = (groups ?? []).find((g) => String(g.id) === primaryFilter);
      if (primary) {
        const prefix = primary.code.slice(0, 4);
        rows = rows.filter((r) => groupById.get(r.groupId ?? -1)?.code.startsWith(prefix));
      }
    }
    if (parentFilter) {
      // The parent-group filter lists leaf groups (what items attach to), so
      // match the item's own leaf group.
      rows = rows.filter((r) => String(r.groupId ?? '') === parentFilter);
    }
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows;
  }, [data, categoryFilter, status, primaryFilter, parentFilter, groups, groupById]);

  const availabilityText = (i: Item) =>
    i.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  const columns: Column<Item>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    { key: 'group', header: 'Group', accessor: (r) => r.group?.name ?? '-' },
    {
      key: 'name',
      header: 'Item',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'unit', header: 'Unit', accessor: (r) => r.unit?.code ?? '-' },
    {
      key: 'lastPurchasePrice',
      header: 'Last Purchase Price',
      accessor: (r) => (r.lastPurchasePrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.lastPurchasePrice ?? 0,
    },
    {
      key: 'lastPurchaseDate',
      header: 'Last Purchase Date',
      accessor: (r) =>
        r.lastPurchaseDate
          ? new Date(r.lastPurchaseDate).toLocaleDateString()
          : '-',
      sortAccessor: (r) => r.lastPurchaseDate ?? '',
    },
    { key: 'hsn', header: 'HSN', accessor: (r) => r.hsnCode?.code ?? '-' },
    {
      key: 'reorderLevel',
      header: 'Reorder',
      accessor: (r) => (r.reorderLevel ?? 0).toLocaleString(),
      sortAccessor: (r) => r.reorderLevel ?? 0,
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
        rows={visibleRows}
        defaultSort={{ key: 'code', dir: 'asc' }}
        // Remount when the filters change so pagination jumps back to page 1.
        key={`${categoryFilter}|${primaryFilter}|${parentFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search items..."
        toolbar={
          <div className="flex flex-nowrap items-center gap-2">
            <Select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPrimaryFilter('');
                setParentFilter('');
              }}
              wrapClassName="w-40"
              placeholder="All categories"
              options={(categories ?? [])
                .filter((c) => c.forItem)
                .map((c) => ({
                  value: String(c.id),
                  label: c.name,
                }))}
            />
            <Select
              value={primaryFilter}
              onChange={(e) => {
                setPrimaryFilter(e.target.value);
                setParentFilter('');
              }}
              wrapClassName="w-36"
              placeholder="All primary groups"
              options={primaryGroups
                .filter(
                  (g) => !categoryFilter || String(g.categoryId) === categoryFilter,
                )
                .map((g) => ({ value: String(g.id), label: g.name }))}
            />
            <Select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              wrapClassName="w-36"
              placeholder="Any parent group"
              options={(groups ?? [])
                .filter(
                  (g) =>
                    !g.subGroupApplicable &&
                    g.isActive &&
                    g.forItem &&
                    (!categoryFilter ||
                      String(g.categoryId) === categoryFilter) &&
                    (!primaryGroupCode ||
                      g.code.startsWith(primaryGroupCode.slice(0, 4))),
                )
                .map((g) => ({ value: String(g.id), label: g.name }))}
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

            {/* Classification — immutable after creation (the code encodes it),
                so it's read-only when editing. To move an item, inactivate it
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
                    // changing category clears a now-invalid group
                    setForm({ ...form, categoryId: e.target.value, groupId: '' })
                  }
                  placeholder="— None —"
                  options={(categories ?? [])
                    .filter((c) => c.isActive && c.forItem)
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

            <Input
              ref={codeRef}
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Wheat Flour 1kg"
            />

            {/* Tax & unit */}
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
            <Select
              label="Stock Unit"
              required
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              placeholder="Select a unit"
              options={unitList.map((u) => ({
                value: u.id,
                label: u.name,
              }))}
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
                label: u.name,
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

            {/* Purchase — date + price share a row */}
            <Input
              label="Last Purchase Date"
              type="date"
              value={form.lastPurchaseDate}
              onChange={(e) =>
                setForm({ ...form, lastPurchaseDate: e.target.value })
              }
            />
            <Input
              label="Last Purchase Price"
              type="number"
              min={0}
              step="any"
              value={form.lastPurchasePrice}
              onChange={(e) =>
                setForm({ ...form, lastPurchasePrice: e.target.value })
              }
            />

            {/* Shelf Life on its own row below the purchase pair */}
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
