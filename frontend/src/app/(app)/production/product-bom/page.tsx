'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListTree } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Product, Category, Group } from '@/lib/types';

const ROUTE = '/production/product-bom';

export default function ProductBomPage() {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');

  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [recipeFilter, setRecipeFilter] = useState(''); // '' | 'with' | 'without'

  const filterCategories = (categories ?? []).filter((c) => c.forProduct);
  const filterGroups = (groups ?? []).filter(
    (g) =>
      g.forProduct && (!categoryFilter || String(g.categoryId) === categoryFilter),
  );

  const visibleRows = useMemo(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((p) => String(p.categoryId) === categoryFilter);
    if (groupFilter)
      rows = rows.filter((p) => String(p.groupId) === groupFilter);
    if (recipeFilter === 'with') rows = rows.filter((p) => p.recipe.length > 0);
    else if (recipeFilter === 'without')
      rows = rows.filter((p) => p.recipe.length === 0);
    return rows;
  }, [data, categoryFilter, groupFilter, recipeFilter]);

  const canEdit = can(ROUTE, 'edit');
  const canView = can(ROUTE, 'view');
  // The BOM lock is the product's lock (governed by the Product Master screen),
  // so locking here also blocks editing the product under Inventory.
  const { canLock, canUnlock, toggleLock, guardEdit, bulkLock } = useLock<Product>({
    endpoint: '/products',
    route: '/inventory/products',
    noun: 'BOM',
    nameOf: (p) => p.name,
    reload: refetch,
  });

  // The BOM is edited/viewed on a dedicated full-screen page.
  const openBom = (p: Product, view: boolean) =>
    router.push(`${ROUTE}/${p.id}${view ? '?view=1' : ''}`);
  const editBom = (p: Product) => {
    if (p.isLocked) {
      toast.error('This product is locked. Unlock it first (Inventory) to edit the BOM.');
      return;
    }
    openBom(p, false);
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
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    {
      key: 'productQty',
      header: 'Product Qty',
      accessor: (r) =>
        `${(r.yieldQty ?? 1).toLocaleString()} ${r.unit?.code ?? ''}`.trim(),
    },
    {
      key: 'recipe',
      header: 'Recipe',
      render: (r) =>
        r.recipe.length ? (
          <Badge color="blue">{r.recipe.length}</Badge>
        ) : (
          <Badge color="amber">No recipe</Badge>
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
    {
      key: 'packing',
      header: 'Packing',
      render: (r) => (
        <Badge color={r.packing.length ? 'violet' : 'slate'}>
          {r.packing.length}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Product BOM"
        description="Define each product's ingredients, process flow and costing"
        icon={<ListTree className="h-5 w-5" />}
      />

      <DataTable
        columns={columns}
        rows={visibleRows}
        key={`${categoryFilter}|${groupFilter}|${recipeFilter}`}
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
              value={recipeFilter}
              onChange={(e) => setRecipeFilter(e.target.value)}
              wrapClassName="w-44"
              placeholder="Recipe: All"
              options={[
                { value: 'with', label: 'With recipe' },
                { value: 'without', label: 'Without recipe' },
              ]}
            />
          </div>
        }
        onView={canView ? (r) => openBom(r, true) : undefined}
        onEdit={canEdit ? (r) => guardEdit(r, () => editBom(r)) : undefined}
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
        emptyMessage="No products found — create products under Inventory → Product Master"
      />
    </div>
  );
}
