'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Cpu } from 'lucide-react';
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
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  Asset,
  AssetCategory,
  AssetGroup,
  Unit,
  Company,
  Lookup,
  LookupValue,
} from '@/lib/types';

const ROUTE = '/asset/assets';

// Lookup that backs the Brand dropdown (kept in sync with the backend
// ASSET_BRANDS_LOOKUP_CODE seed). Admins manage the list in Cpanel → Lookups.
const ASSET_BRANDS_LOOKUP_CODE = 'ASSET_BRANDS';

const empty = {
  code: '',
  name: '',
  categoryId: '',
  groupId: '',
  capacity: '0',
  capacityUnitId: '',
  perUnitId: '',
  brand: '',
  model: '',
  serialNumber: '',
  lifeSpanYears: '0',
  purchasedFrom: '',
  purchaseDate: '',
  purchasePrice: '0',
  warrantyPeriod: '',
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

export default function AssetsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Asset[]>('/assets');
  const { data: categories } = useFetch<AssetCategory[]>('/asset-categories');
  const { data: groups } = useFetch<AssetGroup[]>('/asset-groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: lookups } = useFetch<Lookup[]>('/lookups');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Asset>({
    endpoint: '/assets',
    route: ROUTE,
    noun: 'asset',
    nameOf: (a) => a.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  // List filters (empty string = no filter). Group choices cascade from the
  // selected category.
  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const [brands, setBrands] = useState<LookupValue[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  // Load the Asset Brands lookup values for the Brand dropdown: find the lookup
  // by code, then fetch its values. Runs once the lookup catalog is available.
  useEffect(() => {
    const brandLookup = (lookups ?? []).find(
      (l) => l.code === ASSET_BRANDS_LOOKUP_CODE,
    );
    if (!brandLookup) {
      setBrands([]);
      return;
    }
    let cancelled = false;
    api
      .get<LookupValue[]>(`/lookups/${brandLookup.id}/values`)
      .then((vals) => {
        if (!cancelled) setBrands(vals ?? []);
      })
      .catch(() => {
        if (!cancelled) setBrands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lookups]);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const unitList = units ?? [];
  const companyNameById = new Map(companyList.map((c) => [c.id, c.name]));
  // Resolve unit code/name from the /units fetch — the asset API returns unit
  // ids only, not nested unit objects.
  const unitCodeById = new Map(unitList.map((u) => [u.id, u.code]));
  // Assets attach to LEAF asset groups only (no sub-groups) within the chosen
  // category — exactly like Item/Product master.
  const groupOptions = (groups ?? []).filter(
    (g) =>
      !g.subGroupApplicable &&
      g.isActive &&
      (!form.categoryId || String(g.categoryId) === form.categoryId),
  );

  // Brand choices come from the active Asset Brands lookup values. If the asset
  // being edited has a brand no longer in the list, keep it selectable so the
  // stored value isn't silently lost.
  const brandChoices = brands
    .filter((b) => b.isActive)
    .map((b) => ({ value: b.value, label: b.label }));
  const brandOptions =
    form.brand && !brandChoices.some((o) => o.value === form.brand)
      ? [...brandChoices, { value: form.brand, label: `${form.brand} (not in list)` }]
      : brandChoices;
  // Assets store the lookup value (a stable key); resolve it to the current
  // label for display so a renamed brand shows its new name in the list.
  const brandLabelByValue = new Map(brands.map((b) => [b.value, b.label]));
  const brandLabel = (v?: string | null) =>
    v ? brandLabelByValue.get(v) ?? v : '-';

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (a: Asset) => ({
    code: a.code,
    name: a.name,
    categoryId: a.categoryId != null ? String(a.categoryId) : '',
    groupId: a.groupId != null ? String(a.groupId) : '',
    capacity: String(a.capacity ?? 0),
    capacityUnitId: a.capacityUnitId != null ? String(a.capacityUnitId) : '',
    perUnitId: a.perUnitId != null ? String(a.perUnitId) : '',
    brand: a.brand ?? '',
    model: a.model ?? '',
    serialNumber: a.serialNumber ?? '',
    lifeSpanYears: String(a.lifeSpanYears ?? 0),
    purchasedFrom: a.purchasedFrom ?? '',
    purchaseDate: a.purchaseDate ? a.purchaseDate.slice(0, 10) : '',
    purchasePrice: String(a.purchasePrice ?? 0),
    warrantyPeriod: a.warrantyPeriod ?? '',
    allCompanies: a.allCompanies,
    companyIds: a.companyIds ?? [],
    isActive: a.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (a: Asset) => {
    setEditing(a);
    setView(false);
    setForm(formFrom(a));
    setOpen(true);
  };
  const openView = (a: Asset) => {
    setEditing(a);
    setView(true);
    setForm(formFrom(a));
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
      toast.error('Machine Name is required.');
      return;
    }
    if (!form.groupId) {
      toast.error('Select a group — every asset belongs to a leaf group.');
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
      groupId: Number(form.groupId),
      capacity: num(form.capacity),
      capacityUnitId: idOrNull(form.capacityUnitId),
      perUnitId: idOrNull(form.perUnitId),
      brand: form.brand.trim() || undefined,
      model: form.model.trim() || undefined,
      serialNumber: form.serialNumber.trim() || undefined,
      lifeSpanYears: num(form.lifeSpanYears),
      purchasedFrom: form.purchasedFrom.trim() || undefined,
      purchaseDate: form.purchaseDate || null,
      purchasePrice: num(form.purchasePrice),
      warrantyPeriod: form.warrantyPeriod.trim() || undefined,
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: Asset;
      if (editing) {
        saved = await api.patch<Asset>(`/assets/${editing.id}`, payload);
        toast.success('Asset updated.');
      } else {
        saved = await api.post<Asset>('/assets', payload);
        toast.success('Asset created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        // Fast entry: keep the context (category, group, units, availability),
        // clear only the identity fields and refocus Machine Name.
        setEditing(null);
        setForm((f) => ({ ...f, name: '', serialNumber: '' }));
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

  const remove = async (a: Asset) => {
    const ok = await confirm({
      title: 'Delete asset',
      message: `Delete "${a.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/assets/${a.id}`);
      toast.success('Asset deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (a: Asset) =>
    guardEdit(a, async () => {
      try {
        await api.patch(`/assets/${a.id}`, { isActive: !a.isActive });
        toast.success(a.isActive ? 'Asset set inactive.' : 'Asset set active.');
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

  const availabilityText = (a: Asset) =>
    a.companyIds.map((id) => companyNameById.get(id) ?? `#${id}`).join(', ');

  // Render capacity as "value unitCode / perUnitCode" resolving unit ids from
  // the /units fetch.
  const capacityText = (a: Asset) => {
    const cap = a.capacity ?? 0;
    const capUnit = a.capacityUnitId != null ? unitCodeById.get(a.capacityUnitId) : undefined;
    const perUnit = a.perUnitId != null ? unitCodeById.get(a.perUnitId) : undefined;
    let text = capUnit ? `${cap} ${capUnit}` : String(cap);
    if (perUnit) text += ` / ${perUnit}`;
    return text;
  };

  const columns: Column<Asset>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Machine Name',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    { key: 'group', header: 'Group', accessor: (r) => r.group?.name ?? '-' },
    {
      key: 'capacity',
      header: 'Capacity',
      accessor: (r) => capacityText(r),
      sortAccessor: (r) => r.capacity ?? 0,
    },
    { key: 'brand', header: 'Brand', accessor: (r) => brandLabel(r.brand) },
    { key: 'serialNumber', header: 'Serial Number', accessor: (r) => r.serialNumber ?? '-' },
    {
      key: 'purchaseDate',
      header: 'Purchase Date',
      accessor: (r) =>
        r.purchaseDate ? new Date(r.purchaseDate).toLocaleDateString() : '-',
      sortAccessor: (r) => r.purchaseDate ?? '',
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

  const title = view ? 'View Asset' : editing ? 'Edit Asset' : 'New Asset';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Asset Master"
        description="Individual assets and machines with capacity, warranty and purchase details"
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
        searchPlaceholder="Search assets..."
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
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No assets found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Asset details"
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
              label="Machine Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. CNC Milling Machine"
            />

            {/* Classification — immutable after creation (the code encodes it),
                so it's read-only when editing. To move an asset, inactivate it
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

            {/* Capacity */}
            <Input
              label="Capacity"
              type="number"
              min={0}
              step="any"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Capacity Unit"
                value={form.capacityUnitId}
                onChange={(e) =>
                  setForm({ ...form, capacityUnitId: e.target.value })
                }
                placeholder="— None —"
                options={unitList.map((u) => ({ value: u.id, label: u.name }))}
              />
              <Select
                label="Per Unit"
                value={form.perUnitId}
                onChange={(e) => setForm({ ...form, perUnitId: e.target.value })}
                placeholder="— None —"
                options={unitList.map((u) => ({ value: u.id, label: u.name }))}
              />
            </div>

            {/* Identification */}
            <Select
              label="Brand"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="— None —"
              options={brandOptions}
            />
            <Input
              label="Model"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
            <Input
              label="Serial Number"
              value={form.serialNumber}
              onChange={(e) =>
                setForm({ ...form, serialNumber: e.target.value })
              }
            />
            <Input
              label="Life Span (Years)"
              type="number"
              min={0}
              step={1}
              value={form.lifeSpanYears}
              onChange={(e) =>
                setForm({ ...form, lifeSpanYears: e.target.value })
              }
            />

            {/* Purchase */}
            <Input
              label="Purchased From"
              value={form.purchasedFrom}
              onChange={(e) =>
                setForm({ ...form, purchasedFrom: e.target.value })
              }
            />
            <Input
              label="Purchase Date"
              type="date"
              value={form.purchaseDate}
              onChange={(e) =>
                setForm({ ...form, purchaseDate: e.target.value })
              }
            />
            <Input
              label="Purchase Price"
              type="number"
              min={0}
              step="any"
              value={form.purchasePrice}
              onChange={(e) =>
                setForm({ ...form, purchasePrice: e.target.value })
              }
            />
            <Input
              label="Warranty Period"
              value={form.warrantyPeriod}
              onChange={(e) =>
                setForm({ ...form, warrantyPeriod: e.target.value })
              }
              placeholder="e.g. 12 months"
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
