'use client';

import { useState } from 'react';
import { Plus, Layers, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Module } from '@/lib/types';

const ROUTE = '/cpanel/modules';

const empty = {
  code: '',
  name: '',
  description: '',
  icon: '',
  sortOrder: 0,
  isActive: true,
  isCore: false,
};

export default function ModulesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Module[]>('/modules');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Module | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  const openAdd = () => {
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (m: Module) => {
    setEditing(m);
    setForm({
      code: m.code,
      name: m.name,
      description: m.description ?? '',
      icon: m.icon ?? '',
      sortOrder: m.sortOrder ?? 0,
      isActive: m.isActive,
      isCore: m.isCore,
    });
    setOpen(true);
  };

  const save = async (again = false) => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and Name are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editing) {
        await api.patch(`/modules/${editing.id}`, payload);
        toast.success('Module updated.');
      } else {
        await api.post('/modules', payload);
        toast.success('Module created.');
      }
      await refetch();
      if (again) {
        setEditing(null);
        setForm({ ...empty });
      } else {
        setOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save module.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: Module) => {
    try {
      await api.patch(`/modules/${m.id}`, { isActive: !m.isActive });
      toast.success(`Module ${m.isActive ? 'deactivated' : 'activated'}.`);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
    }
  };

  const remove = async (m: Module) => {
    if (m.isCore) {
      toast.error('Core modules cannot be deleted.');
      return;
    }
    const ok = await confirm({
      title: 'Delete module',
      message: `Delete "${m.name}"? This cannot be undone.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/modules/${m.id}`);
      toast.success('Module deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<Module>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          {r.name}
          {r.isCore && (
            <Badge color="violet">
              <Lock className="mr-1 h-3 w-3" /> Core
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      accessor: (r) => r.description,
    },
    { key: 'sortOrder', header: 'Sort', accessor: (r) => r.sortOrder ?? 0 },
    {
      key: 'isActive',
      header: 'Status',
      render: (r) => (
        <button
          onClick={() => canEdit && toggleActive(r)}
          disabled={!canEdit}
          className="disabled:cursor-default"
        >
          <Badge color={r.isActive ? 'green' : 'slate'}>
            {r.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Module Master"
        description="Manage the ERP modules available in the system"
        icon={<Layers className="h-5 w-5" />}
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
        searchPlaceholder="Search modules..."
        onEdit={openEdit}
        onDelete={remove}
        canEdit={canEdit}
        canDelete={canDelete}
        emptyMessage="No modules found"
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Module' : 'New Module'}
        subtitle="Module configuration"
        icon={<Layers className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={() => save(false)}
            onSaveNew={editing ? undefined : () => save(true)}
            saving={saving}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Code"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="e.g. CPANEL"
          />
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Control Panel"
          />
          <Input
            label="Icon"
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
            placeholder="e.g. settings"
          />
          <Input
            label="Sort Order"
            type="number"
            value={form.sortOrder}
            onChange={(e) =>
              setForm({ ...form, sortOrder: Number(e.target.value) })
            }
          />
          <Textarea
            label="Description"
            wrapClassName="sm:col-span-2"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
          />
          <div className="flex items-center gap-6 sm:col-span-2">
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={(e) =>
                setForm({ ...form, isActive: e.target.checked })
              }
            />
            <Checkbox
              label="Core module"
              checked={form.isCore}
              onChange={(e) => setForm({ ...form, isCore: e.target.checked })}
            />
          </div>
        </div>
      </Drawer>
    </div>
  );
}
