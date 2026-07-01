'use client';

import { useState } from 'react';
import { Plus, Coins } from 'lucide-react';
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
import { Input, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Currency } from '@/lib/types';

const ROUTE = '/cpanel/currencies';

const empty = {
  code: '',
  name: '',
  symbol: '',
  fractionalUnit: '',
  isActive: true,
};

export default function CurrenciesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Currency[]>('/currencies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete } = useLock<Currency>({
    endpoint: '/currencies',
    route: ROUTE,
    noun: 'currency',
    nameOf: (c) => c.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Currency | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (c: Currency) => ({
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    fractionalUnit: c.fractionalUnit,
    isActive: c.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (c: Currency) => {
    setEditing(c);
    setView(false);
    setForm(formFrom(c));
    setOpen(true);
  };

  // Read-only view — works for locked records without unlocking them.
  const openView = (c: Currency) => {
    setEditing(c);
    setView(true);
    setForm(formFrom(c));
    setOpen(true);
  };

  const save = async (mode: SaveMode = 'saveClose') => {
    if (
      !form.code.trim() ||
      !form.name.trim() ||
      !form.symbol.trim() ||
      !form.fractionalUnit.trim()
    ) {
      toast.error('Code, Name, Symbol and Fractional Unit are required.');
      return;
    }
    setSaving(true);
    try {
      let saved: Currency;
      if (editing) {
        saved = await api.patch<Currency>(`/currencies/${editing.id}`, form);
        toast.success('Currency updated.');
      } else {
        saved = await api.post<Currency>('/currencies', form);
        toast.success('Currency created.');
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

  const remove = async (c: Currency) => {
    const ok = await confirm({
      title: 'Delete currency',
      message: `Delete "${c.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/currencies/${c.id}`);
      toast.success('Currency deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Currency>[] = [
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
    { key: 'symbol', header: 'Symbol', accessor: (r) => r.symbol },
    {
      key: 'fractionalUnit',
      header: 'Fractional Unit',
      accessor: (r) => r.fractionalUnit,
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

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Currency Master"
        description="Manage currencies, symbols and fractional units"
        icon={<Coins className="h-5 w-5" />}
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
        searchPlaceholder="Search currencies..."
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
        emptyMessage="No currencies found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={
          view ? 'View Currency' : editing ? 'Edit Currency' : 'New Currency'
        }
        subtitle="Currency details"
        icon={<Coins className="h-5 w-5" />}
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
              label="Code"
              required
              maxLength={5}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. INR"
            />
            <Input
              label="Symbol"
              required
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              placeholder="e.g. ₹"
            />
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Indian Rupee"
            />
            <Input
              label="Fractional Unit"
              required
              value={form.fractionalUnit}
              onChange={(e) =>
                setForm({ ...form, fractionalUnit: e.target.value })
              }
              placeholder="e.g. Paisa"
            />
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
