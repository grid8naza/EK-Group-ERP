'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Factory } from 'lucide-react';
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
import { Input, Checkbox, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { ProductionDivision, Group } from '@/lib/types';

const ROUTE = '/production/divisions';

const empty = {
  name: '',
  description: '',
  isActive: true,
  primaryGroupIds: [] as number[],
};

export default function ProductionDivisionsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<ProductionDivision[]>(
    '/production-divisions',
  );
  const { data: groups } = useFetch<Group[]>('/groups');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<ProductionDivision>({
      endpoint: '/production-divisions',
      route: ROUTE,
      noun: 'production division',
      nameOf: (d) => d.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionDivision | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  // Only PRIMARY (level-1) product groups can be assigned to a division.
  const primaryGroups = useMemo(
    () =>
      (groups ?? [])
        .filter((g) => g.level === 1 && g.forProduct)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  );
  const groupName = (id: number) =>
    (groups ?? []).find((g) => g.id === id)?.name ?? `#${id}`;

  // Primary groups already taken by OTHER divisions — shown disabled so a group
  // is never assigned twice (the backend enforces the same rule).
  const takenElsewhere = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of data ?? []) {
      if (editing && d.id === editing.id) continue;
      for (const g of d.groups ?? []) map.set(g.primaryGroupId, d.name);
    }
    return map;
  }, [data, editing]);

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (d: ProductionDivision) => ({
    name: d.name,
    description: d.description ?? '',
    isActive: d.isActive,
    primaryGroupIds: (d.groups ?? []).map((g) => g.primaryGroupId),
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (d: ProductionDivision) => {
    setEditing(d);
    setView(false);
    setForm(formFrom(d));
    setOpen(true);
  };
  const openView = (d: ProductionDivision) => {
    setEditing(d);
    setView(true);
    setForm(formFrom(d));
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

  const toggleGroup = (id: number) =>
    setForm((f) => ({
      ...f,
      primaryGroupIds: f.primaryGroupIds.includes(id)
        ? f.primaryGroupIds.filter((g) => g !== id)
        : [...f.primaryGroupIds, id],
    }));

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Division name is required.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      isActive: form.isActive,
      primaryGroupIds: form.primaryGroupIds,
    };
    setSaving(true);
    try {
      let saved: ProductionDivision;
      if (editing) {
        saved = await api.patch<ProductionDivision>(
          `/production-divisions/${editing.id}`,
          payload,
        );
        toast.success('Division updated.');
      } else {
        saved = await api.post<ProductionDivision>(
          '/production-divisions',
          payload,
        );
        toast.success('Division created.');
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

  const remove = async (d: ProductionDivision) => {
    const ok = await confirm({
      title: 'Delete division',
      message: `Delete "${d.name}"? Its group assignments are removed.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/production-divisions/${d.id}`);
      toast.success('Division deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<ProductionDivision>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Division',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'groups',
      header: 'Primary groups',
      render: (r) =>
        r.groups && r.groups.length ? (
          <span className="text-slate-600 dark:text-slate-300">
            {r.groups.map((g) => groupName(g.primaryGroupId)).join(', ')}
          </span>
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

  const title = view
    ? 'View Division'
    : editing
      ? 'Edit Division'
      : 'New Division';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Production Division"
        description="Org units (Bakery, Pastry, …) that produce the primary product groups assigned to them"
        icon={<Factory className="h-5 w-5" />}
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
        searchPlaceholder="Search divisions..."
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
        emptyMessage="No production divisions yet"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Production division"
        icon={<Factory className="h-5 w-5" />}
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
          <div className="grid grid-cols-1 gap-4">
            {editing && (
              <Input label="Code" value={editing.code} disabled />
            )}
            <Input
              label="Division name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Bakery, Pastry, Sweets"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                Primary product groups
              </p>
              <p className="mb-2 text-xs text-slate-500">
                The primary (level-1) groups this division produces. A group can
                belong to only one division.
              </p>
              {primaryGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-400 dark:border-slate-700">
                  No primary product groups exist yet.
                </p>
              ) : (
                <div className="space-y-1 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {primaryGroups.map((g) => {
                    const taken = takenElsewhere.get(g.id);
                    const checked = form.primaryGroupIds.includes(g.id);
                    return (
                      <div key={g.id} className="flex items-center justify-between">
                        <Checkbox
                          label={g.name}
                          checked={checked}
                          disabled={!!taken && !checked}
                          onChange={() => toggleGroup(g.id)}
                        />
                        {taken && !checked && (
                          <span className="text-xs text-slate-400">
                            in {taken}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
