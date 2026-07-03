'use client';

import { useEffect, useState } from 'react';
import { Plus, Ruler, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter, type SaveMode } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Unit, UnitType } from '@/lib/types';

const ROUTE = '/inventory/units';

type ChainRung = { unitId: string; quantity: string };

const empty = {
  name: '',
  symbol: '',
  type: 'SIMPLE' as UnitType,
  baseUnitId: '',
  conversionFactor: '',
  chainLinks: [] as ChainRung[],
  decimalPlaces: '0',
  isActive: true,
};

export default function UnitsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Unit[]>('/units');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Unit>({
    endpoint: '/units',
    route: ROUTE,
    noun: 'unit',
    nameOf: (u) => u.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  // Base unit for a compound must be a SIMPLE unit (and not the row itself).
  const simpleUnits = (data ?? []).filter(
    (u) => u.type === 'SIMPLE' && u.id !== editing?.id,
  );
  // A chaining rung may reference any existing non-chaining unit except itself.
  const linkUnits = (data ?? []).filter(
    (u) => u.type !== 'CHAINING' && u.id !== editing?.id,
  );

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (u: Unit) => ({
    name: u.name,
    symbol: u.symbol ?? '',
    type: u.type,
    baseUnitId: u.baseUnitId != null ? String(u.baseUnitId) : '',
    conversionFactor: u.conversionFactor != null ? String(u.conversionFactor) : '',
    chainLinks: (u.chainLinks ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((l) => ({ unitId: String(l.linkUnitId), quantity: String(l.quantity) })),
    decimalPlaces: String(u.decimalPlaces ?? 0),
    isActive: u.isActive,
  });

  // --- chaining rung editors (mutate form.chainLinks) ---
  const addRung = () =>
    setForm((f) => ({ ...f, chainLinks: [...f.chainLinks, { unitId: '', quantity: '' }] }));
  const removeRung = (i: number) =>
    setForm((f) => ({ ...f, chainLinks: f.chainLinks.filter((_, idx) => idx !== i) }));
  const setRung = (i: number, patch: Partial<ChainRung>) =>
    setForm((f) => ({
      ...f,
      chainLinks: f.chainLinks.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));

  // Resolved factor (product of rung quantities) and the bottom unit, for the
  // live preview — mirrors how the server resolves a chaining unit.
  const chainFactor = form.chainLinks.reduce(
    (acc, r) => acc * (Number(r.quantity) || 0),
    1,
  );
  const chainBase = form.chainLinks.length
    ? linkUnits.find(
        (u) => String(u.id) === form.chainLinks[form.chainLinks.length - 1].unitId,
      )
    : undefined;

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (u: Unit) => {
    setEditing(u);
    setView(false);
    setForm(formFrom(u));
    setOpen(true);
  };

  const openView = (u: Unit) => {
    setEditing(u);
    setView(true);
    setForm(formFrom(u));
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

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.type === 'COMPOUND') {
      if (!form.baseUnitId) {
        toast.error('A compound unit needs a base unit.');
        return;
      }
      if (!form.conversionFactor || Number(form.conversionFactor) <= 0) {
        toast.error('A compound unit needs a positive conversion factor.');
        return;
      }
    }
    if (form.type === 'CHAINING') {
      if (form.chainLinks.length === 0) {
        toast.error('A chaining unit needs at least one rung.');
        return;
      }
      if (form.chainLinks.some((r) => !r.unitId || !(Number(r.quantity) > 0))) {
        toast.error('Each rung needs a unit and a positive quantity.');
        return;
      }
      if (chainBase?.type !== 'SIMPLE') {
        toast.error('The last rung must reference a simple unit.');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      symbol: form.symbol.trim() || undefined,
      type: form.type,
      decimalPlaces: Number(form.decimalPlaces) || 0,
      isActive: form.isActive,
      // Base/factor are explicit for COMPOUND; the server resolves them for
      // CHAINING from the rungs, so we only send chainLinks there.
      ...(form.type === 'COMPOUND'
        ? {
            baseUnitId: Number(form.baseUnitId),
            conversionFactor: Number(form.conversionFactor),
          }
        : { baseUnitId: null, conversionFactor: null }),
      ...(form.type === 'CHAINING'
        ? {
            chainLinks: form.chainLinks.map((r) => ({
              unitId: Number(r.unitId),
              quantity: Number(r.quantity),
            })),
          }
        : {}),
    };

    setSaving(true);
    try {
      let saved: Unit;
      if (editing) {
        saved = await api.patch<Unit>(`/units/${editing.id}`, payload);
        toast.success('Unit updated.');
      } else {
        saved = await api.post<Unit>('/units', payload);
        toast.success('Unit created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...empty });
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

  const remove = async (u: Unit) => {
    const ok = await confirm({
      title: 'Delete unit',
      message: `Delete "${u.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/units/${u.id}`);
      toast.success('Unit deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Unit>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'symbol', header: 'Symbol', accessor: (r) => r.symbol ?? '-' },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <Badge
          color={
            r.type === 'COMPOUND'
              ? 'blue'
              : r.type === 'CHAINING'
                ? 'violet'
                : 'slate'
          }
        >
          {r.type === 'COMPOUND'
            ? 'Compound'
            : r.type === 'CHAINING'
              ? 'Chaining'
              : 'Simple'}
        </Badge>
      ),
    },
    {
      key: 'conversion',
      header: 'Conversion',
      render: (r) =>
        (r.type === 'COMPOUND' || r.type === 'CHAINING') && r.baseUnit ? (
          <span className="text-slate-600 dark:text-slate-300">
            1 {r.code} = {r.conversionFactor} {r.baseUnit.code}
          </span>
        ) : (
          <span className="text-slate-400">-</span>
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

  const title = view ? 'View Unit' : editing ? 'Edit Unit' : 'New Unit';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Unit Master"
        description="Units of measure (global) — simple, compound, and chaining (nested packaging) units"
        icon={<Ruler className="h-5 w-5" />}
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
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search units..."
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No units found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Unit of measure details"
        icon={<Ruler className="h-5 w-5" />}
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
              label="Symbol"
              maxLength={20}
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              placeholder="e.g. Pcs"
            />
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Pieces"
              wrapClassName="sm:col-span-2"
            />
            <Select
              label="Type"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as UnitType })
              }
              options={[
                { value: 'SIMPLE', label: 'Simple' },
                { value: 'COMPOUND', label: 'Compound (derived from a base unit)' },
                { value: 'CHAINING', label: 'Chaining (nested packaging ladder)' },
              ]}
            />
            <Input
              label="Decimal Places"
              type="number"
              min={0}
              max={6}
              value={form.decimalPlaces}
              onChange={(e) =>
                setForm({ ...form, decimalPlaces: e.target.value })
              }
            />

            {form.type === 'COMPOUND' && (
              <>
                <Select
                  label="Base Unit"
                  required
                  value={form.baseUnitId}
                  onChange={(e) =>
                    setForm({ ...form, baseUnitId: e.target.value })
                  }
                  placeholder="Select a simple unit"
                  options={simpleUnits.map((u) => ({
                    value: u.id,
                    label: u.name,
                  }))}
                />
                <Input
                  label="Conversion Factor"
                  required
                  type="number"
                  min={0}
                  step="any"
                  value={form.conversionFactor}
                  onChange={(e) =>
                    setForm({ ...form, conversionFactor: e.target.value })
                  }
                  placeholder="e.g. 12"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
                  1 {form.name || 'unit'} = {form.conversionFactor || '…'}{' '}
                  {simpleUnits.find((u) => String(u.id) === form.baseUnitId)
                    ?.code || 'base unit'}
                </p>
              </>
            )}

            {form.type === 'CHAINING' && (
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Packaging Ladder
                  </span>
                  {!view && (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={addRung}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add rung
                    </button>
                  )}
                </div>
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Each rung: how many of the chosen unit make up one of the level
                  above it. The last rung must be a simple unit.
                </p>

                {form.chainLinks.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-600">
                    No rungs yet — add one to start the ladder.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.chainLinks.map((rung, i) => {
                      const above =
                        i === 0
                          ? form.name || 'unit'
                          : linkUnits.find(
                              (u) =>
                                String(u.id) === form.chainLinks[i - 1].unitId,
                            )?.code || 'level above';
                      return (
                        <div key={i} className="flex items-end gap-2">
                          <span className="pb-2 text-xs text-slate-500 dark:text-slate-400">
                            1 {above} =
                          </span>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={rung.quantity}
                            onChange={(e) =>
                              setRung(i, { quantity: e.target.value })
                            }
                            placeholder="qty"
                            wrapClassName="w-24"
                          />
                          <Select
                            value={rung.unitId}
                            onChange={(e) =>
                              setRung(i, { unitId: e.target.value })
                            }
                            placeholder="Select unit"
                            options={linkUnits.map((u) => ({
                              value: u.id,
                              label: u.name,
                            }))}
                            wrapClassName="flex-1"
                          />
                          {!view && (
                            <button
                              type="button"
                              className="mb-1 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                              onClick={() => removeRung(i)}
                              aria-label="Remove rung"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {form.chainLinks.length > 0 && (
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    1 {form.name || 'unit'} = {chainFactor || '…'}{' '}
                    {chainBase?.code || 'base unit'}
                  </p>
                )}
              </div>
            )}

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
