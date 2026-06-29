'use client';

import { useState } from 'react';
import { ListTree, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Product, Item, Unit } from '@/lib/types';

const ROUTE = '/production/product-bom';

type Line = { itemId: string; quantity: string; unitId: string };

const toLines = (rows: Product['recipe']): Line[] =>
  rows.map((l) => ({
    itemId: String(l.itemId),
    quantity: String(l.quantity),
    unitId: String(l.unitId),
  }));

export default function ProductBomPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: items } = useFetch<Item[]>('/items');
  const { data: units } = useFetch<Unit[]>('/units');

  const itemList = items ?? [];
  const unitList = units ?? [];

  const canEdit = can(ROUTE, 'edit');
  const canView = can(ROUTE, 'view');
  // The BOM lock is the product's lock (governed by the Product Master screen),
  // so locking here also blocks editing the product under Inventory.
  const { canLock, canUnlock, toggleLock, guardEdit } = useLock<Product>({
    endpoint: '/products',
    route: '/inventory/products',
    noun: 'BOM',
    nameOf: (p) => p.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [productQty, setProductQty] = useState('1');
  const [recipe, setRecipe] = useState<Line[]>([]);
  const [packing, setPacking] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  const openFor = (p: Product, viewOnly: boolean) => {
    if (!viewOnly && p.isLocked) {
      toast.error('This product is locked. Unlock it first (Inventory) to edit the BOM.');
      return;
    }
    setEditing(p);
    setView(viewOnly);
    setProductQty(String(p.yieldQty ?? 1));
    setRecipe(toLines(p.recipe ?? []));
    setPacking(toLines(p.packing ?? []));
    setOpen(true);
  };

  const validLines = (lines: Line[]) =>
    lines.filter((l) => l.itemId && Number(l.quantity) > 0 && l.unitId);

  const save = async () => {
    if (!editing) return;
    // Drop blank rows; require a unit + positive qty on any line that has an item.
    const bad = (lines: Line[]) =>
      lines.some((l) => l.itemId && (!(Number(l.quantity) > 0) || !l.unitId));
    if (bad(recipe) || bad(packing)) {
      toast.error('Each BOM line needs a positive quantity and a unit.');
      return;
    }
    const payload = {
      yieldQty: Number(productQty) || 1, // "product quantity" (units per batch)
      // Yield unit is predefined by the product master (its box unit).
      yieldUnitId: editing.boxUnitId ?? editing.unitId,
      recipe: validLines(recipe).map((l) => ({
        itemId: Number(l.itemId),
        quantity: Number(l.quantity),
        unitId: Number(l.unitId),
      })),
      packing: validLines(packing).map((l) => ({
        itemId: Number(l.itemId),
        quantity: Number(l.quantity),
        unitId: Number(l.unitId),
      })),
    };
    setSaving(true);
    try {
      await api.patch(`/products/${editing.id}`, payload);
      toast.success('BOM saved.');
      await refetch();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save BOM.');
    } finally {
      setSaving(false);
    }
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
      key: 'yield',
      header: 'Yield',
      accessor: (r) =>
        `${((r.yieldQty ?? 1) * (r.boxQty ?? 0)).toLocaleString()} ${r.boxUnit?.code ?? ''}`.trim(),
    },
    {
      key: 'recipe',
      header: 'Recipe',
      render: (r) => <Badge color={r.recipe.length ? 'blue' : 'slate'}>{r.recipe.length}</Badge>,
    },
    {
      key: 'packing',
      header: 'Packing',
      render: (r) => <Badge color={r.packing.length ? 'violet' : 'slate'}>{r.packing.length}</Badge>,
    },
  ];

  const title = view
    ? `BOM — ${editing?.name ?? ''}`
    : `Edit BOM — ${editing?.name ?? ''}`;

  // Units are predefined by the product master and shown read-only here.
  const unitLabel = (u?: { code: string; name: string } | null) =>
    u ? `${u.code} — ${u.name}` : '—';
  const boxQty = editing?.boxQty ?? 0;
  const yieldValue = (Number(productQty) || 0) * boxQty; // product qty × box qty

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Product BOM"
        description="Define each product's recipe and packing bill of materials"
        icon={<ListTree className="h-5 w-5" />}
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search products..."
        onView={canView ? (r) => openFor(r, true) : undefined}
        onEdit={canEdit ? (r) => guardEdit(r, () => openFor(r, false)) : undefined}
        canView={canView}
        canEdit={canEdit}
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

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={editing ? `Product code ${editing.code}` : undefined}
        icon={<ListTree className="h-5 w-5" />}
        width="lg"
        footer={
          view ? (
            <CloseFooter onClose={() => setOpen(false)} />
          ) : (
            <DrawerFooter
              onCancel={() => setOpen(false)}
              onSave={save}
              saving={saving}
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="space-y-6">
            {/* Batch quantities — units are predefined in the product master. */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Input
                label="Product Quantity (one recipe batch makes)"
                type="number"
                min={0}
                step="any"
                value={productQty}
                onChange={(e) => setProductQty(e.target.value)}
              />
              <Input label="Product Unit" value={unitLabel(editing?.unit)} disabled readOnly />

              <Input label="Box Quantity" value={String(boxQty)} disabled readOnly />
              <Input label="Box Unit" value={unitLabel(editing?.boxUnit)} disabled readOnly />

              <Input
                label="Yield Quantity (Product Qty × Box Qty)"
                value={yieldValue.toLocaleString()}
                disabled
                readOnly
              />
              <Input label="Yield Unit" value={unitLabel(editing?.boxUnit)} disabled readOnly />
            </div>

            <BomLineEditor
              label="Recipe BOM"
              hint="Ingredients (items) and quantities to make one batch."
              lines={recipe}
              setLines={setRecipe}
              items={itemList}
              units={unitList}
              view={view}
            />
            <BomLineEditor
              label="Packing BOM"
              hint="Packing materials (items) and quantities for the batch."
              lines={packing}
              setLines={setPacking}
              items={itemList}
              units={unitList}
              view={view}
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}

function BomLineEditor({
  label,
  hint,
  lines,
  setLines,
  items,
  units,
  view,
}: {
  label: string;
  hint: string;
  lines: Line[];
  setLines: (l: Line[]) => void;
  items: Item[];
  units: Unit[];
  view: boolean;
}) {
  const add = () => setLines([...lines, { itemId: '', quantity: '', unitId: '' }]);
  const remove = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  // Selecting an item defaults the row's unit to that item's stock unit.
  const onItem = (i: number, itemId: string) => {
    const it = items.find((x) => String(x.id) === itemId);
    set(i, {
      itemId,
      ...(lines[i].unitId ? {} : { unitId: it ? String(it.unitId) : '' }),
    });
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </span>
        {!view && (
          <button type="button" className="btn-secondary text-xs" onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        )}
      </div>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-600">
          No lines yet — add one.
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-end gap-2">
              <Select
                value={line.itemId}
                onChange={(e) => onItem(i, e.target.value)}
                placeholder="Select item"
                options={items.map((it) => ({
                  value: it.id,
                  label: `${it.code} — ${it.name}`,
                }))}
                wrapClassName="flex-1"
              />
              <Input
                type="number"
                min={0}
                step="any"
                value={line.quantity}
                onChange={(e) => set(i, { quantity: e.target.value })}
                placeholder="qty"
                wrapClassName="w-24"
              />
              <Select
                value={line.unitId}
                onChange={(e) => set(i, { unitId: e.target.value })}
                placeholder="Unit"
                options={units.map((u) => ({ value: u.id, label: u.code }))}
                wrapClassName="w-28"
              />
              {!view && (
                <button
                  type="button"
                  className="mb-1 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                  onClick={() => remove(i)}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
