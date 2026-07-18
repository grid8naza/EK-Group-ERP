'use client';

import { useMemo, useState } from 'react';
import { Plus, Box, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { Select } from '@/components/ui/Field';
import type { Packing, Product, Unit } from '@/lib/types';

const ROUTE = '/production/packing';

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';

type DraftLine = { productId: string; quantity: string };

export default function PackingPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, refetch } = useFetch<Packing[]>('/packing');
  const { data: products } = useFetch<Product[]>('/products');
  const { data: units } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, bulkLock } = useLock<Packing>({
    endpoint: '/packing',
    route: ROUTE,
    noun: 'packing',
    nameOf: (p) => p.packingNo,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'view' | 'new'>('view');
  const [current, setCurrent] = useState<Packing | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantity: '' }]);
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canView = can(ROUTE, 'view');

  const packedProducts = useMemo(
    () =>
      (products ?? [])
        .filter((p) => p.packed)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const unitById = useMemo(
    () => new Map((units ?? []).map((u) => [u.id, u])),
    [units],
  );
  const unitLabel = (id: number) => {
    const u = unitById.get(id);
    return u?.symbol ?? u?.code ?? '';
  };

  const openNew = () => {
    setMode('new');
    setCurrent(null);
    setLines([{ productId: '', quantity: '' }]);
    setOpen(true);
  };
  const openView = async (row: Packing) => {
    try {
      const full = await api.get<Packing>(`/packing/${row.id}`);
      setMode('view');
      setCurrent(full);
      setOpen(true);
    } catch {
      toast.error('Failed to open the packing.');
    }
  };

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, { productId: '', quantity: '' }]);
  const removeLine = (i: number) =>
    setLines((ls) => ls.filter((_, idx) => idx !== i));

  const save = async () => {
    const clean = lines.filter(
      (l) => l.productId && Number(l.quantity) > 0,
    );
    if (!clean.length) {
      toast.error('Add at least one packed product with a quantity.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<Packing>('/packing', {
        lines: clean.map((l) => ({
          productId: Number(l.productId),
          quantity: Number(l.quantity),
        })),
      });
      toast.success(`Packing ${created.packingNo} recorded.`);
      await refetch();
      setMode('view');
      setCurrent(created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to pack.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Packing>[] = [
    { key: 'packingNo', header: 'Packing', accessor: (r) => r.packingNo },
    { key: 'store', header: 'Store', accessor: (r) => r.storeName ?? '—' },
    {
      key: 'products',
      header: 'Products',
      accessor: (r) => String(r.lines.length),
    },
    { key: 'date', header: 'Packed', accessor: (r) => fmtDate(r.packingDate) },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Packing"
        description="Pack unpacked products into packed ones — consumes the source, banks the packed batch"
        icon={<Box className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New Packing
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search packing..."
        onView={openView}
        canView={canView}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No packing operations yet"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          mode === 'new'
            ? 'New Packing'
            : current
              ? current.packingNo
              : 'Packing'
        }
        subtitle="Packing operation"
        icon={<Box className="h-5 w-5" />}
        footer={
          mode === 'new' ? (
            <DrawerFooter
              onCancel={() => setOpen(false)}
              onSave={save}
              saving={saving}
              dataEntry
            />
          ) : (
            <CloseFooter onClose={() => setOpen(false)} />
          )
        }
      >
        {mode === 'new' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-500">
              Choose the packed products to make. Each consumes its unpacked
              source and packing materials from the default store.
            </p>
            {lines.map((l, i) => (
              <div key={i} className="flex items-end gap-2">
                <Select
                  label={i === 0 ? 'Packed product' : undefined}
                  value={l.productId}
                  onChange={(e) => setLine(i, { productId: e.target.value })}
                  placeholder="Select a packed product"
                  wrapClassName="flex-1"
                  options={packedProducts.map((p) => ({
                    value: String(p.id),
                    label: p.name,
                  }))}
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input-base w-28 text-right"
                  placeholder="Qty"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <button
                  className="btn-ghost px-2 text-slate-500"
                  onClick={() => removeLine(i)}
                  disabled={lines.length === 1}
                  title="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button className="btn-ghost self-start" onClick={addLine}>
              <Plus className="h-4 w-4" /> Add product
            </button>
          </div>
        ) : (
          current && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Field label="Store" value={current.storeName ?? '—'} />
                <Field label="Packed" value={fmt(current.packingDate)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                      <th className="py-2 pr-2">Packed product</th>
                      <th className="w-20 py-2 text-right">Qty</th>
                      <th className="w-12 py-2 pl-2">Unit</th>
                      <th className="py-2 pl-2">Batch</th>
                      <th className="w-28 py-2 pl-2">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.lines.map((l) => (
                      <tr
                        key={l.id}
                        className="border-b border-slate-100 dark:border-slate-800/60"
                      >
                        <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">
                          {l.productName}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {l.quantity.toLocaleString()}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500">
                          {unitLabel(l.unitId)}
                        </td>
                        <td className="py-1.5 pl-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                          {l.batchNo ?? '—'}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500">
                          {fmtDate(l.expiryDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}
