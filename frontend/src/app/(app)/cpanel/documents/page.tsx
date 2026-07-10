'use client';

import { useEffect, useState } from 'react';
import { Plus, FileText } from 'lucide-react';
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
import type { DocumentMaster } from '@/lib/types';

const ROUTE = '/cpanel/documents';
const empty = { name: '', description: '', isActive: true };

export default function DocumentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<DocumentMaster[]>('/documents');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<DocumentMaster>({
      endpoint: '/documents',
      route: ROUTE,
      noun: 'document',
      nameOf: (d) => d.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentMaster | null>(null);
  const [view, setView] = useState(false);
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
  const formFrom = (d: DocumentMaster) => ({
    name: d.name,
    description: d.description ?? '',
    isActive: d.isActive,
  });
  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (d: DocumentMaster) => {
    setEditing(d);
    setView(false);
    setForm(formFrom(d));
    setOpen(true);
  };
  const openView = (d: DocumentMaster) => {
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

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Document name is required.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      isActive: form.isActive,
    };
    setSaving(true);
    try {
      let saved: DocumentMaster;
      if (editing) {
        saved = await api.patch<DocumentMaster>(`/documents/${editing.id}`, payload);
        toast.success('Document updated.');
      } else {
        saved = await api.post<DocumentMaster>('/documents', payload);
        toast.success('Document created.');
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

  const remove = async (d: DocumentMaster) => {
    const ok = await confirm({
      title: 'Delete document',
      message: `Delete "${d.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/documents/${d.id}`);
      toast.success('Document deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<DocumentMaster>[] = [
    {
      key: 'name',
      header: 'Document',
      sortable: true,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          {r.name}
          {r.isSystem && <Badge color="blue">System</Badge>}
        </span>
      ),
    },
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    { key: 'description', header: 'Description', accessor: (r) => r.description ?? '—' },
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

  const title = view ? 'View Document' : editing ? 'Edit Document' : 'New Document';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Document Master"
        description="The list of document types used across the app (and by document numbering)"
        icon={<FileText className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">Alt+A</span>
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
        searchPlaceholder="Search documents..."
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
        emptyMessage="No documents yet"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Document type"
        icon={<FileText className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter onCancel={closeDrawer} onSave={save} saving={saving} dataEntry />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4">
            {editing && (
              <Input label="Code" value={editing.code} disabled />
            )}
            <Input
              label="Document name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Pre-Payment Voucher"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
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
