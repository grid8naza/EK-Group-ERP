'use client';

import { useEffect, useState } from 'react';
import { Plus, Warehouse } from 'lucide-react';
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
import { Input, Checkbox, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Store, Branch } from '@/lib/types';

const ROUTE = '/inventory/stores';

const empty = {
  name: '',
  address: '',
  isDefault: false,
  isActive: true,
};

export default function StoresPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Store[]>('/stores');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<Store>({
      endpoint: '/stores',
      route: ROUTE,
      noun: 'store',
      nameOf: (s) => s.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const branchName = (id?: number | null) =>
    id ? ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`) : '—';

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (s: Store) => ({
    name: s.name,
    address: s.address ?? '',
    isDefault: s.isDefault ?? false,
    isActive: s.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (s: Store) => {
    setEditing(s);
    setView(false);
    setForm(formFrom(s));
    setOpen(true);
  };
  const openView = (s: Store) => {
    setEditing(s);
    setView(true);
    setForm(formFrom(s));
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
    if (!form.name.trim()) {
      toast.error('Store name is required.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      isDefault: form.isDefault,
      isActive: form.isActive,
    };
    setSaving(true);
    try {
      let saved: Store;
      if (editing) {
        saved = await api.patch<Store>(`/stores/${editing.id}`, payload);
        toast.success('Store updated.');
      } else {
        saved = await api.post<Store>('/stores', payload);
        toast.success('Store created.');
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

  const remove = async (s: Store) => {
    const ok = await confirm({
      title: 'Delete store',
      message: `Delete "${s.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/stores/${s.id}`);
      toast.success('Store deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Store>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Store',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      accessor: (r) => branchName(r.branchId),
    },
    { key: 'address', header: 'Address', accessor: (r) => r.address ?? '—' },
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

  const title = view ? 'View Store' : editing ? 'Edit Store' : 'New Store';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Store Master"
        description="Stock locations (stores / warehouses) for the active company & branch"
        icon={<Warehouse className="h-5 w-5" />}
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
        searchPlaceholder="Search stores..."
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
        emptyMessage="No stores yet"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Stock location"
        icon={<Warehouse className="h-5 w-5" />}
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
            <Input
              label="Store name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Main Warehouse"
              wrapClassName="sm:col-span-2"
            />
            <Textarea
              label="Address"
              wrapClassName="sm:col-span-2"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <div className="sm:col-span-2">
              <Checkbox
                label="Default store (auto-selected for this branch in stock forms)"
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
