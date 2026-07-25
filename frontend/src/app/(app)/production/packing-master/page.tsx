'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageCheck, Plus } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Product, Category, Group } from '@/lib/types';

const ROUTE = '/production/packing-master';

export default function PackingMasterPage() {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');

  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [packingFilter, setPackingFilter] = useState(''); // '' | 'with' | 'without'

  const filterCategories = (categories ?? []).filter((c) => c.forProduct);
  const productGroups = (groups ?? []).filter(
    (g) =>
      g.forProduct && (!categoryFilter || String(g.categoryId) === categoryFilter),
  );
  const groupById = useMemo(
    () => new Map((groups ?? []).map((g) => [g.id, g])),
    [groups],
  );
  // Packing is defined for FINISHED goods only, so the primary group is fixed to
  // the one tagged that stage (Group Master) rather than picked — no primary
  // filter here. Its CC+L1 code prefix (2+2 digits) is shared by the whole
  // subtree, so it scopes both the rows and the leaf-group list. Until a group
  // carries the tag the scope is dropped, rather than blanking the screen.
  const stagePrimary = useMemo(
    () =>
      (groups ?? []).find((g) => g.level === 1 && g.productStage === 'FINISHED'),
    [groups],
  );
  const primaryPrefix = stagePrimary?.code.slice(0, 4);
  const leafGroups = productGroups.filter(
    (g) =>
      !g.subGroupApplicable &&
      g.isActive &&
      (!primaryPrefix || g.code.startsWith(primaryPrefix)),
  );

  // Resolve a packed product's source (unpacked) product name for display.
  const productById = useMemo(
    () => new Map((data ?? []).map((p) => [p.id, p])),
    [data],
  );

  const visibleRows = useMemo(() => {
    // Two conditions: the product carries a packing BOM (Has Packing), and it
    // sits under the FINISHED primary group — packing is a finished-goods step.
    let rows = (data ?? []).filter((p) => p.hasPacking);
    if (categoryFilter)
      rows = rows.filter((p) => String(p.categoryId) === categoryFilter);
    if (primaryPrefix)
      rows = rows.filter((p) =>
        groupById.get(p.groupId ?? -1)?.code.startsWith(primaryPrefix),
      );
    if (groupFilter)
      rows = rows.filter((p) => String(p.groupId) === groupFilter);
    if (packingFilter === 'with') rows = rows.filter((p) => p.packing.length > 0);
    else if (packingFilter === 'without')
      rows = rows.filter((p) => p.packing.length === 0);
    return rows;
  }, [
    data,
    categoryFilter,
    primaryPrefix,
    groupFilter,
    packingFilter,
    groupById,
  ]);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canView = can(ROUTE, 'view');
  // The packing lock is the product's lock (governed by the Products - Packed
  // screen), so locking here also blocks editing the product under Inventory.
  const { canLock, canUnlock, toggleLock, guardEdit, bulkLock } = useLock<Product>({
    endpoint: '/products',
    route: '/inventory/products-packed',
    noun: 'Packing',
    nameOf: (p) => p.name,
    reload: refetch,
  });

  // The packing is edited/viewed on a dedicated full-screen page.
  const openPacking = (p: Product, view: boolean) =>
    router.push(`${ROUTE}/${p.id}${view ? '?view=1' : ''}`);
  const editPacking = (p: Product) => {
    if (p.isLocked) {
      toast.error('This product is locked. Unlock it first (Inventory) to edit the packing.');
      return;
    }
    openPacking(p, false);
  };

  // "Add New Packing" — pick a packed product, then open the full-screen editor.
  // Products themselves are created under Inventory.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickCategory, setPickCategory] = useState('');
  const [pickGroup, setPickGroup] = useState('');
  const [pickProduct, setPickProduct] = useState('');
  // Scoped to the FINISHED subtree like the listing, so the picker can only
  // offer what this screen manages.
  const pickerLeaves = (groups ?? []).filter(
    (g) =>
      g.forProduct &&
      !g.subGroupApplicable &&
      g.isActive &&
      (!pickCategory || String(g.categoryId) === pickCategory) &&
      (!primaryPrefix || g.code.startsWith(primaryPrefix)),
  );
  const pickerProducts = (data ?? []).filter(
    (p) =>
      p.hasPacking &&
      (!pickCategory || String(p.categoryId) === pickCategory) &&
      (!primaryPrefix ||
        groupById.get(p.groupId ?? -1)?.code.startsWith(primaryPrefix)) &&
      (!pickGroup || String(p.groupId) === pickGroup),
  );
  const openPicker = () => {
    setPickCategory('');
    setPickGroup('');
    setPickProduct('');
    setPickerOpen(true);
  };
  const confirmPick = () => {
    const p = (data ?? []).find((x) => String(x.id) === pickProduct);
    if (!p) {
      toast.error('Select a product to define its packing.');
      return;
    }
    setPickerOpen(false);
    editPacking(p);
  };

  const columns: Column<Product>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Product',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'packedFrom',
      header: 'Packed From',
      accessor: (r) =>
        r.packSources && r.packSources.length
          ? r.packSources
              .map((s) => productById.get(s.sourceProductId)?.name ?? '?')
              .join(', ')
          : '-',
    },
    {
      key: 'productQty',
      header: 'Product Qty',
      accessor: (r) =>
        `${(r.yieldQty ?? 1).toLocaleString()} ${r.unit?.symbol ?? r.unit?.code ?? ''}`.trim(),
    },
    {
      key: 'packing',
      header: 'Materials',
      render: (r) =>
        r.packing.length ? (
          <Badge color="blue">{r.packing.length}</Badge>
        ) : (
          <Badge color="amber">No packing</Badge>
        ),
    },
    {
      key: 'processes',
      header: 'Process',
      render: (r) => (
        <Badge color={r.processes.length ? 'green' : 'slate'}>
          {r.processes.length}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Packing Master"
        description="Define each packed product's source, packing materials, process flow and costing"
        icon={<PackageCheck className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openPicker}>
              <Plus className="h-4 w-4" /> Add New
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={visibleRows}
        key={`${categoryFilter}|${groupFilter}|${packingFilter}`}
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
              options={filterCategories.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
            {/* No primary-group filter: this screen is fixed to the FINISHED
                primary group, so its leaves are the only ones on offer. */}
            <Select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              wrapClassName="w-44"
              placeholder="All groups"
              options={leafGroups.map((g) => ({
                value: String(g.id),
                label: g.name,
              }))}
            />
            <Select
              value={packingFilter}
              onChange={(e) => setPackingFilter(e.target.value)}
              wrapClassName="w-44"
              placeholder="Packing: All"
              options={[
                { value: 'with', label: 'With packing' },
                { value: 'without', label: 'Without packing' },
              ]}
            />
          </div>
        }
        onView={canView ? (r) => openPacking(r, true) : undefined}
        onEdit={canEdit ? (r) => guardEdit(r, () => editPacking(r)) : undefined}
        canView={canView}
        canEdit={canEdit}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No packed products found — mark a product “Packed” under Inventory → Products - Finished"
      />

      <Drawer
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="New Packing"
        subtitle="Pick the packed product to define packing for"
        icon={<PackageCheck className="h-5 w-5" />}
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setPickerOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={confirmPick}>
              Open Packing
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Packing belongs to a packed product. Choose the product below to open
            its full-screen packing (source product, materials, process flow
            &amp; costing). New products are created under Inventory → Products -
            Packed.
          </p>
          <Select
            label="Category"
            value={pickCategory}
            onChange={(e) => {
              setPickCategory(e.target.value);
              setPickGroup('');
              setPickProduct('');
            }}
            placeholder="All categories"
            options={filterCategories.map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
          {/* Primary group is fixed to the FINISHED one — shown, not picked. */}
          <Input
            label="Primary Group"
            value={
              stagePrimary?.name ?? 'Not set — tag a primary group “Finished”'
            }
            disabled
          />
          <Select
            label="Group"
            value={pickGroup}
            onChange={(e) => {
              setPickGroup(e.target.value);
              setPickProduct('');
            }}
            placeholder="All groups"
            options={pickerLeaves.map((g) => ({
              value: String(g.id),
              label: g.name,
            }))}
          />
          <Select
            label="Product"
            value={pickProduct}
            onChange={(e) => setPickProduct(e.target.value)}
            placeholder="Select a packed product"
            options={pickerProducts.map((p) => ({
              value: String(p.id),
              label: `${p.name} (${p.code})`,
            }))}
          />
        </div>
      </Drawer>
    </div>
  );
}
