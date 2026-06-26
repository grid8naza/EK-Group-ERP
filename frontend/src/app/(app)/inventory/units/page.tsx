'use client';

import { useState } from 'react';
import { Plus, Ruler } from 'lucide-react';
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
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Unit, UnitType } from '@/lib/types';

const ROUTE = '/inventory/units';

const empty = {
  code: '',
  name: '',
  symbol: '',
  type: 'SIMPLE' as UnitType,
  baseUnitId: '',
  conversionFactor: '',
  decimalPlaces: '0',
  isActive: true,
};

export default function UnitsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Unit[]>('/units');
  const { canToggle, toggleLock, guardEdit, guardDelete } = useLock<Unit>({
    endpoint: '/units',
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

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (u: Unit) => ({
    code: u.code,
    name: u.name,
    symbol: u.symbol ?? '',
    type: u.type,
    baseUnitId: u.baseUnitId != null ? String(u.baseUnitId) : '',
    conversionFactor: u.conversionFactor != null ? String(u.conversionFactor) : '',
    decimalPlaces: String(u.decimalPlaces ?? 0),
    isActive: u.isActive,
  });

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

  const save = async (again = false) => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and Name are required.');
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

    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      symbol: form.symbol.trim() || undefined,
      type: form.type,
      decimalPlaces: Number(form.decimalPlaces) || 0,
      isActive: form.isActive,
      ...(form.type === 'COMPOUND'
        ? {
            baseUnitId: Number(form.baseUnitId),
            conversionFactor: Number(form.conversionFactor),
          }
        : { baseUnitId: null, conversionFactor: null }),
    };

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/units/${editing.id}`, payload);
        toast.success('Unit updated.');
      } else {
        await api.post('/units', payload);
        toast.success('Unit created.');
      }
      await refetch();
      if (again) {
        setEditing(null);
        setForm({ ...empty });
      } else {
        setOpen(false);
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
    { key: 'symbol', header: 'Symbol', accessor: (r) => r.symbol ?? '-' },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <Badge color={r.type === 'COMPOUND' ? 'blue' : 'slate'}>
          {r.type === 'COMPOUND' ? 'Compound' : 'Simple'}
        </Badge>
      ),
    },
    {
      key: 'conversion',
      header: 'Conversion',
      render: (r) =>
        r.type === 'COMPOUND' && r.baseUnit ? (
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
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Unit Master"
        description="Units of measure (global) — simple units and compound units derived from them"
        icon={<Ruler className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={refetch}
        searchPlaceholder="Search units..."
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canToggle={canToggle}
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
              label="Code"
              required
              maxLength={20}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. PCS"
            />
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
                    label: `${u.code} — ${u.name}`,
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
                  1 {form.code || 'unit'} ={' '}
                  {form.conversionFactor || '…'}{' '}
                  {simpleUnits.find((u) => String(u.id) === form.baseUnitId)
                    ?.code || 'base unit'}
                </p>
              </>
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
