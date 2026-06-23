'use client';

import { useEffect, useState } from 'react';
import { Plus, Layers, Building2, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { IconPicker } from '@/components/ui/IconPicker';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { Module, Company } from '@/lib/types';

const ROUTE = '/cpanel/modules';

const empty = {
  code: '',
  name: '',
  description: '',
  icon: '',
  sortOrder: 0,
  isActive: true,
  isCore: false,
  companyIds: [] as number[],
};

export default function ModulesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Module[]>('/modules');
  const { canToggle, toggleLock, guardEdit, guardDelete } = useLock<Module>({
    endpoint: '/modules',
    noun: 'module',
    nameOf: (m) => m.name,
    reload: refetch,
  });
  const [companies, setCompanies] = useState<Company[]>([]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Module | null>(null);
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

  useEffect(() => {
    api
      .get<Company[]>('/companies')
      .then((c) => setCompanies(c ?? []))
      .catch(() => {});
  }, []);

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty, companyIds: [] });
    setOpen(true);
  };

  const openEdit = (m: Module) => {
    setEditing(m);
    setView(false);
    setForm({
      code: m.code,
      name: m.name,
      description: m.description ?? '',
      icon: m.icon ?? '',
      sortOrder: m.sortOrder ?? 0,
      isActive: m.isActive,
      isCore: m.isCore,
      companyIds: m.companyIds ?? [],
    });
    setOpen(true);
  };

  // Read-only view — works for locked records without unlocking them.
  const openView = (m: Module) => {
    setEditing(m);
    setView(true);
    setForm({
      code: m.code,
      name: m.name,
      description: m.description ?? '',
      icon: m.icon ?? '',
      sortOrder: m.sortOrder ?? 0,
      isActive: m.isActive,
      isCore: m.isCore,
      companyIds: m.companyIds ?? [],
    });
    setOpen(true);
  };

  const toggleCompany = (id: number) =>
    setForm((f) => ({
      ...f,
      companyIds: f.companyIds.includes(id)
        ? f.companyIds.filter((c) => c !== id)
        : [...f.companyIds, id],
    }));

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
        setForm({ ...empty, companyIds: [] });
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
        emptyMessage="No modules found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View Module' : editing ? 'Edit Module' : 'New Module'}
        subtitle="Module configuration"
        icon={<Layers className="h-5 w-5" />}
        footer={
          view ? (
            <div className="flex items-center justify-end">
              <button type="button" className="btn-secondary" onClick={closeDrawer}>
                Close
              </button>
            </div>
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
        {/* Disabled fieldset = read-only: it cascades `disabled` to every input
            below without changing the layout. */}
        <fieldset disabled={view} className="m-0 min-w-0 border-0 p-0">
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
          <IconPicker
            label="Icon"
            value={form.icon}
            onChange={(icon) => setForm({ ...form, icon })}
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
          <div className="sm:col-span-2">
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={(e) =>
                setForm({ ...form, isActive: e.target.checked })
              }
            />
          </div>

          {/* Module type — Core (universal, super-admin only) vs User
              (available only to the selected companies). Mutually exclusive. */}
          <div className="sm:col-span-2">
            <label className="label">Module type</label>
            <div className="flex items-center gap-6">
              <Checkbox
                label="Core module"
                checked={form.isCore}
                onChange={() => setForm({ ...form, isCore: true })}
              />
              <Checkbox
                label="User module"
                checked={!form.isCore}
                onChange={() => setForm({ ...form, isCore: false })}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {form.isCore
                ? 'Core modules are available to all companies and accessible only to super admins.'
                : 'User modules are available only to the companies selected below.'}
            </p>
          </div>

          {!form.isCore && (
            <div className="sm:col-span-2">
              <label className="label flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-slate-400" /> Companies
              </label>
              <p className="mb-2 text-xs text-slate-400">
                This module will be available only for the selected companies.
              </p>
              {companies.length === 0 ? (
                <p className="text-sm text-slate-400">No companies available</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {companies.map((c) => {
                    const active = form.companyIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCompany(c.id)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                          active
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                        )}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          </div>
        </fieldset>
      </Drawer>
    </div>
  );
}
