'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Columns3 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Checkbox, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Rack, Store } from '@/lib/types';

const ROUTE = '/inventory/racks';

const empty = {
  storeId: '',
  name: '',
  isDefault: false,
  isActive: true,
};

export default function RacksPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Rack[]>('/racks');
  const { data: stores } = useFetch<Store[]>('/stores');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<Rack>({
      endpoint: '/racks',
      route: ROUTE,
      noun: 'rack',
      nameOf: (r) => r.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rack | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const storeById = useMemo(
    () => new Map((stores ?? []).map((s) => [s.id, s])),
    [stores],
  );
  const storeName = (id: number) => storeById.get(id)?.name ?? `#${id}`;

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (r: Rack) => ({
    storeId: String(r.storeId),
    name: r.name,
    isDefault: r.isDefault ?? false,
    isActive: r.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (r: Rack) => {
    setEditing(r);
    setView(false);
    setForm(formFrom(r));
    setOpen(true);
  };
  const openView = (r: Rack) => {
    setEditing(r);
    setView(true);
    setForm(formFrom(r));
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

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.storeId) {
      toast.error('Select a store for the rack.');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Rack name is required.');
      return;
    }
    const payload = {
      storeId: Number(form.storeId),
      name: form.name.trim(),
      isDefault: form.isDefault,
      isActive: form.isActive,
    };
    setSaving(true);
    try {
      let saved: Rack;
      if (editing) {
        saved = await api.patch<Rack>(`/racks/${editing.id}`, payload);
        toast.success('Rack updated.');
      } else {
        saved = await api.post<Rack>('/racks', payload);
        toast.success('Rack created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...empty, storeId: form.storeId });
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

  const remove = async (r: Rack) => {
    const ok = await confirm({
      title: 'Delete rack',
      message: `Delete "${r.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/racks/${r.id}`);
      toast.success('Rack deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Rack>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Rack',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'store', header: 'Store', accessor: (r) => storeName(r.storeId) },
    {
      key: 'isDefault',
      header: 'Default',
      render: (r) =>
        r.isDefault ? (
          <Badge color="blue">Default</Badge>
        ) : (
          <span className="text-slate-400">—</span>
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

  const title = view ? 'View Rack' : editing ? 'Edit Rack' : 'New Rack';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Rack Master"
        description="Racks / shelves / bins inside a store — a product's default put-away location"
        icon={<Columns3 className="h-5 w-5" />}
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
        searchPlaceholder="Search racks..."
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
        emptyMessage="No racks yet"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Stock sub-location"
        icon={<Columns3 className="h-5 w-5" />}
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
            {editing && (
              <Input
                label="Code"
                value={editing.code}
                disabled
                wrapClassName="sm:col-span-2"
              />
            )}
            <Select
              label="Store"
              required
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              placeholder="Select a store"
              wrapClassName="sm:col-span-2"
              options={(stores ?? [])
                .filter((s) => s.isActive || String(s.id) === form.storeId)
                .map((s) => ({ value: String(s.id), label: s.name }))}
            />
            <Input
              label="Rack name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Rack A1"
              wrapClassName="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <Checkbox
                label="Default rack (auto-selected for this store in stock forms)"
                checked={form.isDefault}
                onChange={(e) =>
                  setForm({ ...form, isDefault: e.target.checked })
                }
              />
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
