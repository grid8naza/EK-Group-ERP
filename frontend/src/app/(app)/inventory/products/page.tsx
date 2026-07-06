'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PackageOpen, Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { mediaUrl } from '@/lib/login-screen';
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
import type { Product, Group, Unit, HsnCode, Company } from '@/lib/types';

const ROUTE = '/inventory/products';

const empty = {
  code: '',
  name: '',
  description: '',
  imageUrl: '',
  categoryId: '',
  groupId: '',
  unitId: '',
  unpacked: false,
  packed: false,
  canSell: true,
  costPrice: '0',
  wholesalePrice: '0',
  wholesaleProfitPct: '',
  intercompanyPrice: '0',
  intercompanyProfitPct: '',
  retailPrice: '0',
  retailProfitPct: '',
  boxQty: '0',
  boxUnitId: '',
  hsnCodeId: '',
  shelfLife: '0',
  hasRecipe: false,
  hasPacking: false,
  isIngredient: false,
  allCompanies: true,
  companyIds: [] as number[],
  isActive: true,
};

// Profit % is a markup over cost: pct = (price - cost) / cost * 100, and the
// inverse price = cost * (1 + pct/100). Both are stored; the form keeps the
// matching price/% pair in sync as either side is edited.
const round2 = (v: number) => Math.round(v * 100) / 100;
const toN = (s: string) => Number(s) || 0;
const pctFromPrice = (price: number, cost: number) =>
  cost > 0 ? round2(((price - cost) / cost) * 100) : 0;
const priceFromPct = (pct: number, cost: number) =>
  cost > 0 ? round2(cost * (1 + pct / 100)) : 0;

// Percentage shown for a price: blank when the price is null/empty/0 (no sale
// price → no margin to show) or when the margin would be negative (below cost);
// otherwise the margin over cost. When cost is 0 the margin can't be derived,
// so the current value is kept.
const pctDisplay = (priceStr: string, cost: number, current = '') => {
  const price = toN(priceStr);
  if (priceStr === '' || price === 0) return '';
  if (cost <= 0) return current;
  const pct = pctFromPrice(price, cost);
  return pct < 0 ? '' : String(pct);
};

export default function ProductsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: hsnCodes } = useFetch<HsnCode[]>('/hsn-codes');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Product>({
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
  // Drawer group cascade: primary group → parent group → leaf group (the saved
  // `groupId`). Category is fixed to Products, so it is not shown.
  const [drawerPrimary, setDrawerPrimary] = useState('');
  const [drawerParent, setDrawerParent] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const uploadImage = async (file: File) => {
    setImageUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<{ url: string }>('/products/image', fd);
      setForm((f) => ({ ...f, imageUrl: res.url }));
      toast.success('Picture uploaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setImageUploading(false);
    }
  };
  const [primaryFilter, setPrimaryFilter] = useState('');
  const [parentFilter, setParentFilter] = useState('');
  const [formFactor, setFormFactor] = useState(''); // '' | 'packed' | 'unpacked'
  const [sellFilter, setSellFilter] = useState(''); // '' | 'yes' | 'no'
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const codeRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const unitList = units ?? [];
  // Products use product groups only.
  const productGroups = (groups ?? []).filter((g) => g.forProduct);

  // Group lookups for the primary/parent list filters (each product attaches to
  // a leaf group via r.groupId; resolve it to apply the same subtree/child
  // predicates as the Group Master).
  const groupById = useMemo(
    () => new Map((groups ?? []).map((g) => [g.id, g])),
    [groups],
  );
  const primaryGroups = useMemo(
    () => productGroups.filter((g) => g.level === 1),
    [productGroups],
  );
  const parentCandidates = useMemo(
    () => productGroups.filter((g) => g.subGroupApplicable && g.level < 5),
    [productGroups],
  );
  const primaryGroupCode = primaryFilter
    ? productGroups.find((g) => String(g.id) === primaryFilter)?.code
    : undefined;

  // Drawer cascade: the CC+L1 code prefix (2+2 digits) of the chosen primary
  // group scopes the parent + leaf options to that primary's subtree.
  const primaryPrefixOf = (id: string) =>
    primaryGroups.find((p) => String(p.id) === id)?.code.slice(0, 4);
  const drawerParentOptions = parentCandidates.filter((g) => {
    const pref = primaryPrefixOf(drawerPrimary);
    return !pref || g.code.startsWith(pref);
  });
  // Products attach to LEAF groups only (no sub-groups), scoped by the chosen
  // parent (or, failing that, the chosen primary's subtree).
  const drawerLeafOptions = productGroups.filter((g) => {
    if (g.subGroupApplicable || !g.isActive) return false;
    if (drawerParent) return String(g.parentGroupId) === drawerParent;
    const pref = primaryPrefixOf(drawerPrimary);
    return pref ? g.code.startsWith(pref) : true;
  });
  // Resolve a leaf group's primary (level-1) + immediate parent names, for the
  // read-only classification shown when editing.
  const groupAncestry = (leafId: number | null | undefined) => {
    const leaf = leafId != null ? groupById.get(leafId) : undefined;
    if (!leaf) return { primary: '-', parent: '-', leaf: '-' };
    const parent = leaf.parentGroupId
      ? groupById.get(leaf.parentGroupId)
      : undefined;
    let node = leaf;
    while (node.level > 1 && node.parentGroupId) {
      const up = groupById.get(node.parentGroupId);
      if (!up) break;
      node = up;
    }
    return {
      primary: node.level === 1 ? node.name : '-',
      parent: parent?.name ?? '-',
      leaf: leaf.name,
    };
  };

  const editAncestry = editing ? groupAncestry(editing.groupId) : null;

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (p: Product) => ({
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    imageUrl: p.imageUrl ?? '',
    categoryId: p.categoryId != null ? String(p.categoryId) : '',
    groupId: p.groupId != null ? String(p.groupId) : '',
    unitId: String(p.unitId),
    unpacked: p.unpacked ?? false,
    packed: p.packed ?? false,
    canSell: p.canSell ?? true,
    costPrice: String(p.costPrice ?? 0),
    wholesalePrice: String(p.wholesalePrice ?? 0),
    wholesaleProfitPct: pctDisplay(
      String(p.wholesalePrice ?? 0),
      p.costPrice ?? 0,
    ),
    intercompanyPrice: String(p.intercompanyPrice ?? 0),
    intercompanyProfitPct: pctDisplay(
      String(p.intercompanyPrice ?? 0),
      p.costPrice ?? 0,
    ),
    retailPrice: String(p.retailPrice ?? 0),
    retailProfitPct: pctDisplay(String(p.retailPrice ?? 0), p.costPrice ?? 0),
    boxQty: String(p.boxQty ?? 0),
    boxUnitId: p.boxUnitId != null ? String(p.boxUnitId) : '',
    hsnCodeId: p.hsnCodeId != null ? String(p.hsnCodeId) : '',
    shelfLife: String(p.shelfLife ?? 0),
    hasRecipe: p.hasRecipe ?? false,
    hasPacking: p.hasPacking ?? false,
    isIngredient: p.isIngredient ?? false,
    allCompanies: p.allCompanies,
    companyIds: p.companyIds ?? [],
    isActive: p.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setDrawerPrimary('');
    setDrawerParent('');
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

  const save = async (mode: SaveMode = 'saveClose') => {
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
      // Picture is a sellable-product attribute; cleared when not sellable.
      imageUrl: form.canSell ? form.imageUrl || null : null,
      groupId: Number(form.groupId),
      unitId: Number(form.unitId),
      unpacked: form.unpacked,
      packed: form.packed,
      canSell: form.canSell,
      costPrice: num(form.costPrice),
      wholesalePrice: num(form.wholesalePrice),
      wholesaleProfitPct: num(form.wholesaleProfitPct),
      intercompanyPrice: num(form.intercompanyPrice),
      intercompanyProfitPct: num(form.intercompanyProfitPct),
      retailPrice: num(form.retailPrice),
      retailProfitPct: num(form.retailProfitPct),
      boxQty: num(form.boxQty),
      boxUnitId: idOrNull(form.boxUnitId),
      hsnCodeId: idOrNull(form.hsnCodeId),
      shelfLife: num(form.shelfLife),
      hasRecipe: form.hasRecipe,
      hasPacking: form.hasPacking,
      isIngredient: form.isIngredient,
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: Product;
      if (editing) {
        saved = await api.patch<Product>(`/products/${editing.id}`, payload);
        toast.success('Product updated.');
      } else {
        saved = await api.post<Product>('/products', payload);
        toast.success('Product created.');
      }
      await refetch();
      if (mode === 'saveNew') {
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
    if (primaryFilter) {
      const primary = (groups ?? []).find((g) => String(g.id) === primaryFilter);
      if (primary) {
        const prefix = primary.code.slice(0, 4);
        rows = rows.filter((r) => groupById.get(r.groupId ?? -1)?.code.startsWith(prefix));
      }
    }
    if (parentFilter) {
      // The parent-group filter lists leaf groups (what products attach to), so
      // match the product's own leaf group.
      rows = rows.filter((r) => String(r.groupId ?? '') === parentFilter);
    }
    if (formFactor === 'packed') rows = rows.filter((r) => r.packed);
    else if (formFactor === 'unpacked') rows = rows.filter((r) => r.unpacked);
    if (sellFilter === 'yes') rows = rows.filter((r) => r.canSell);
    else if (sellFilter === 'no') rows = rows.filter((r) => !r.canSell);
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }, [data, formFactor, sellFilter, status, primaryFilter, parentFilter, groups, groupById]);

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
        description="Finished products — recipe & packing are set under Production → Recipe Master"
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
        key={`${primaryFilter}|${parentFilter}|${formFactor}|${sellFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search products..."
        toolbar={
          <div className="flex flex-nowrap items-center gap-2">
            <Select
              value={primaryFilter}
              onChange={(e) => {
                setPrimaryFilter(e.target.value);
                setParentFilter('');
              }}
              wrapClassName="w-36"
              placeholder="All primary groups"
              options={primaryGroups.map((g) => ({
                value: String(g.id),
                label: g.name,
              }))}
            />
            <Select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              wrapClassName="w-36"
              placeholder="Any parent group"
              options={productGroups
                .filter(
                  (g) =>
                    !g.subGroupApplicable &&
                    g.isActive &&
                    (!primaryGroupCode ||
                      g.code.startsWith(primaryGroupCode.slice(0, 4))),
                )
                .map((g) => ({ value: String(g.id), label: g.name }))}
            />
            <Select
              value={formFactor}
              onChange={(e) => setFormFactor(e.target.value)}
              wrapClassName="w-36"
              placeholder="Packed / Unpacked"
              options={[
                { value: 'packed', label: 'Packed' },
                { value: 'unpacked', label: 'Unpacked' },
              ]}
            />
            <Select
              value={sellFilter}
              onChange={(e) => setSellFilter(e.target.value)}
              wrapClassName="w-32"
              placeholder="Can sell: All"
              options={[
                { value: 'yes', label: 'Can sell' },
                { value: 'no', label: 'Cannot sell' },
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
                  label="Primary Group"
                  value={editAncestry?.primary ?? '-'}
                  disabled
                />
                <Input
                  label="Parent Group"
                  value={editAncestry?.parent ?? '-'}
                  disabled
                />
                <Input
                  label="Group"
                  value={editing.group?.name ?? editAncestry?.leaf ?? '-'}
                  disabled
                  wrapClassName="sm:col-span-2"
                />
              </>
            ) : (
              // Category is always "Products" for this master, so it's hidden.
              // Drill down primary → parent → leaf group; the server derives the
              // category from the chosen leaf group.
              <>
                <Select
                  label="Primary Group"
                  value={drawerPrimary}
                  onChange={(e) => {
                    setDrawerPrimary(e.target.value);
                    setDrawerParent('');
                    setForm({ ...form, groupId: '' });
                  }}
                  placeholder="— Select —"
                  options={primaryGroups.map((g) => ({
                    value: String(g.id),
                    label: g.name,
                  }))}
                />
                <Select
                  label="Parent Group"
                  value={drawerParent}
                  onChange={(e) => {
                    setDrawerParent(e.target.value);
                    setForm({ ...form, groupId: '' });
                  }}
                  placeholder="— None —"
                  options={drawerParentOptions.map((g) => ({
                    value: String(g.id),
                    label: `${'· '.repeat(g.level - 1)}${g.name}`,
                  }))}
                />
                <Select
                  label="Group"
                  required
                  value={form.groupId}
                  onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                  placeholder="Select a leaf group"
                  wrapClassName="sm:col-span-2"
                  options={drawerLeafOptions.map((g) => ({
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
            {/* Cost — the base for every profit %. Always editable, even for
                non-sellable products (e.g. ingredients). */}
            <Input
              label="Cost Price"
              type="number"
              min={0}
              step="any"
              value={form.costPrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(e.target.value);
                  // Keep the entered prices; refresh each margin against the
                  // new cost (blank when the price is 0 or below cost).
                  return {
                    ...f,
                    costPrice: e.target.value,
                    intercompanyProfitPct: pctDisplay(
                      f.intercompanyPrice,
                      cost,
                      f.intercompanyProfitPct,
                    ),
                    wholesaleProfitPct: pctDisplay(
                      f.wholesalePrice,
                      cost,
                      f.wholesaleProfitPct,
                    ),
                    retailProfitPct: pctDisplay(
                      f.retailPrice,
                      cost,
                      f.retailProfitPct,
                    ),
                  };
                })
              }
            />

            {/* Form factor — unpacked and/or packed. */}
            <div className="flex items-center gap-8 sm:col-span-2">
              <Checkbox
                label="Unpacked"
                checked={form.unpacked}
                onChange={(e) =>
                  setForm({ ...form, unpacked: e.target.checked })
                }
              />
              <Checkbox
                label="Packed"
                checked={form.packed}
                onChange={(e) => setForm({ ...form, packed: e.target.checked })}
              />
            </div>

            {/* Can Sell — gates the selling prices, profit %, and packing. */}
            <div className="sm:col-span-2">
              <Checkbox
                label="Can Sell"
                checked={form.canSell}
                onChange={(e) => {
                  const canSell = e.target.checked;
                  // Unchecking clears the now-disabled selling fields.
                  setForm((f) =>
                    canSell
                      ? { ...f, canSell }
                      : {
                          ...f,
                          canSell,
                          imageUrl: '',
                          intercompanyPrice: '',
                          intercompanyProfitPct: '',
                          wholesalePrice: '',
                          wholesaleProfitPct: '',
                          retailPrice: '',
                          retailProfitPct: '',
                          boxQty: '',
                          boxUnitId: '',
                        },
                  );
                }}
              />
            </div>

            {/* Product picture — only for sellable products. */}
            {form.canSell && (
              <div className="sm:col-span-2">
                <span className="label !mb-1 block">Product Picture</span>
                <div className="flex items-center gap-3">
                  <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                    {form.imageUrl ? (
                      <img
                        src={mediaUrl(form.imageUrl)}
                        alt="Product"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-slate-300" />
                    )}
                  </div>
                  {!view && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-2"
                        onClick={() => imageInput.current?.click()}
                        disabled={imageUploading}
                      >
                        <Upload className="h-4 w-4" />
                        {imageUploading ? 'Uploading…' : 'Upload'}
                      </button>
                      {form.imageUrl && (
                        <button
                          type="button"
                          className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                          onClick={() => setForm({ ...form, imageUrl: '' })}
                        >
                          <Trash2 className="h-4 w-4" /> Remove
                        </button>
                      )}
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadImage(f);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  PNG, JPG, WEBP or GIF — up to 5 MB.
                </p>
              </div>
            )}

            <Input
              label="Intercompany Price"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.intercompanyPrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    intercompanyPrice: e.target.value,
                    intercompanyProfitPct: pctDisplay(
                      e.target.value,
                      cost,
                      f.intercompanyProfitPct,
                    ),
                  };
                })
              }
            />
            <Input
              label="Intercompany Profit %"
              type="number"
              step="any"
              disabled={!form.canSell}
              value={form.intercompanyProfitPct}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    intercompanyProfitPct: e.target.value,
                    intercompanyPrice:
                      e.target.value !== '' && cost > 0
                        ? String(priceFromPct(toN(e.target.value), cost))
                        : f.intercompanyPrice,
                  };
                })
              }
            />
            <Input
              label="Wholesale Price"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.wholesalePrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    wholesalePrice: e.target.value,
                    wholesaleProfitPct: pctDisplay(
                      e.target.value,
                      cost,
                      f.wholesaleProfitPct,
                    ),
                  };
                })
              }
            />
            <Input
              label="Wholesale Profit %"
              type="number"
              step="any"
              disabled={!form.canSell}
              value={form.wholesaleProfitPct}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    wholesaleProfitPct: e.target.value,
                    wholesalePrice:
                      e.target.value !== '' && cost > 0
                        ? String(priceFromPct(toN(e.target.value), cost))
                        : f.wholesalePrice,
                  };
                })
              }
            />
            <Input
              label="Retail Price"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.retailPrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    retailPrice: e.target.value,
                    retailProfitPct: pctDisplay(
                      e.target.value,
                      cost,
                      f.retailProfitPct,
                    ),
                  };
                })
              }
            />
            <Input
              label="Retail Profit %"
              type="number"
              step="any"
              disabled={!form.canSell}
              value={form.retailProfitPct}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    retailProfitPct: e.target.value,
                    retailPrice:
                      e.target.value !== '' && cost > 0
                        ? String(priceFromPct(toN(e.target.value), cost))
                        : f.retailPrice,
                  };
                })
              }
            />

            {/* Pack content */}
            <Input
              label="Box Quantity"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.boxQty}
              onChange={(e) => setForm({ ...form, boxQty: e.target.value })}
            />
            <Select
              label="Box Unit"
              disabled={!form.canSell}
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

            {/* Capabilities — which BOMs may be built for this product, and
                whether it can serve as an ingredient in another product. */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Capabilities</span>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <Checkbox
                  label="Require Recipe"
                  checked={form.hasRecipe}
                  onChange={(e) =>
                    setForm({ ...form, hasRecipe: e.target.checked })
                  }
                />
                <Checkbox
                  label="Require Packing"
                  checked={form.hasPacking}
                  onChange={(e) =>
                    setForm({ ...form, hasPacking: e.target.checked })
                  }
                />
                <Checkbox
                  label="Can be Ingredient"
                  checked={form.isIngredient}
                  onChange={(e) =>
                    setForm({ ...form, isIngredient: e.target.checked })
                  }
                />
              </div>
            </div>

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
