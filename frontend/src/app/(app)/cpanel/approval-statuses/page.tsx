'use client';

import { useState } from 'react';
import { Plus, BadgeCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { Input, Checkbox } from '@/components/ui/Field';
import { IconPicker } from '@/components/ui/IconPicker';
import { Badge } from '@/components/ui/Badge';
import { resolveIcon } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { WorkflowStatus } from '@/lib/types';

const ROUTE = '/cpanel/approval-statuses';

const empty = { name: '', icon: '', color: '', sortOrder: '', isActive: true };

// Preset colours that read well in both light and dark themes.
const COLOR_PRESETS = [
  { name: 'Slate', hex: '#64748b' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Orange', hex: '#ea580c' },
];

export default function ApprovalStatusesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } =
    useFetch<WorkflowStatus[]>('/workflow-statuses');

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowStatus | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const close = () => {
    setOpen(false);
    setView(false);
  };

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openRow = (s: WorkflowStatus, viewMode: boolean) => {
    setEditing(s);
    setView(viewMode);
    setForm({
      name: s.name,
      icon: s.icon ?? '',
      color: s.color ?? '',
      sortOrder: String(s.sortOrder ?? 0),
      isActive: s.isActive,
    });
    setOpen(true);
  };

  const del = async (s: WorkflowStatus) => {
    const ok = await confirm({
      title: 'Delete status',
      message: `Delete "${s.name}"? Steps using it will show no icon.`,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/workflow-statuses/${s.id}`);
      toast.success('Status deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const save = async (mode: SaveMode) => {
    if (!form.name.trim()) {
      toast.error('A status name is required.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      icon: form.icon || null,
      color: form.color || null,
      sortOrder: form.sortOrder === '' ? 0 : Number(form.sortOrder),
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await api.patch(`/workflow-statuses/${editing.id}`, payload);
        toast.success('Status updated.');
      } else {
        await api.post('/workflow-statuses', payload);
        toast.success('Status created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...empty });
      } else if (mode === 'saveClose') {
        close();
      } else if (!editing) {
        // After a first "Save" on a new row, keep the drawer open for edits.
        close();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<WorkflowStatus>[] = [
    {
      key: 'icon',
      header: 'Icon',
      render: (r) => {
        const Icon = resolveIcon(r.icon);
        return (
          <span title={r.name} className="inline-flex">
            <Icon className="h-5 w-5" style={{ color: r.color || undefined }} />
          </span>
        );
      },
      className: 'w-16 text-center',
      headerClassName: 'text-center',
    },
    { key: 'name', header: 'Status', accessor: (r) => r.name },
    {
      key: 'sortOrder',
      header: 'Order',
      accessor: (r) => r.sortOrder,
      className: 'text-center tabular-nums',
      headerClassName: 'text-center',
    },
    {
      key: 'active',
      header: 'Active',
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title="Approval Statuses"
        description="The status vocabulary shown on workflow documents — a name and an icon"
        icon={<BadgeCheck className="h-5 w-5" />}
        actions={
          canAdd ? (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> New Status
            </button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search statuses..."
        onView={canView ? (r) => openRow(r, true) : undefined}
        canView={canView}
        onEdit={canEdit ? (r) => openRow(r, false) : undefined}
        canEdit={canEdit}
        onDelete={canDelete ? del : undefined}
        canDelete={canDelete}
        emptyMessage="No statuses yet — add one to use in workflow steps"
      />

      <Drawer
        open={open}
        onClose={close}
        title={editing ? (view ? 'Status' : 'Edit status') : 'New status'}
        subtitle="Shown on workflow documents"
        icon={<BadgeCheck className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={close} />
          ) : (
            <DrawerFooter
              onCancel={close}
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <div className="space-y-4">
          <Input
            label="Status name"
            required
            disabled={view}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Forwarded to CRM, Under review, Approved"
          />
          <IconPicker
            label="Icon"
            value={form.icon}
            onChange={(icon) => setForm({ ...form, icon })}
          />

          {/* Colour: presets + a custom picker; the chosen icon previews live. */}
          <div>
            <span className="label !mb-1 block">Icon colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const Preview = resolveIcon(form.icon);
                return (
                  <span className="mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700">
                    <Preview
                      className="h-5 w-5"
                      style={{ color: form.color || undefined }}
                    />
                  </span>
                );
              })()}
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.name}
                  disabled={view}
                  onClick={() => setForm({ ...form, color: c.hex })}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition',
                    form.color === c.hex
                      ? 'border-slate-800 dark:border-white'
                      : 'border-transparent hover:scale-110',
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <input
                type="color"
                disabled={view}
                value={form.color || '#64748b'}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-transparent dark:border-slate-700"
                title="Custom colour"
              />
              {form.color && !view && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, color: '' })}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <Input
            label="Sort order"
            type="number"
            min={0}
            disabled={view}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            placeholder="0"
          />
          <Checkbox
            label="Active"
            checked={form.isActive}
            disabled={view}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
        </div>
      </Drawer>
    </div>
  );
}
