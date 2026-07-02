'use client';

import { useEffect, useState } from 'react';
import { Plus, Percent } from 'lucide-react';
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
import type { HsnCode } from '@/lib/types';

const ROUTE = '/inventory/hsn-codes';

const empty = {
  code: '',
  description: '',
  cgst: '0',
  sgst: '0',
  igst: '0',
  isActive: true,
};

const pct = (n: number) => `${(n ?? 0).toLocaleString()}%`;

export default function HsnCodesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<HsnCode[]>('/hsn-codes');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<HsnCode>({
    endpoint: '/hsn-codes',
    route: ROUTE,
    noun: 'HSN code',
    nameOf: (h) => h.code,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HsnCode | null>(null);
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

  const formFrom = (h: HsnCode) => ({
    code: h.code,
    description: h.description,
    cgst: String(h.cgst ?? 0),
    sgst: String(h.sgst ?? 0),
    igst: String(h.igst ?? 0),
    isActive: h.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (h: HsnCode) => {
    setEditing(h);
    setView(false);
    setForm(formFrom(h));
    setOpen(true);
  };

  const openView = (h: HsnCode) => {
    setEditing(h);
    setView(true);
    setForm(formFrom(h));
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

  // Editing CGST or SGST auto-fills IGST with their sum (still editable), which
  // is the usual GST relationship (intra-state CGST+SGST = inter-state IGST).
  const setHalf = (key: 'cgst' | 'sgst', value: string) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      const c = Number(key === 'cgst' ? value : f.cgst) || 0;
      const s = Number(key === 'sgst' ? value : f.sgst) || 0;
      return { ...next, igst: String(c + s) };
    });
  };

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.code.trim() || !form.description.trim()) {
      toast.error('Code and Description are required.');
      return;
    }
    const nums = { cgst: Number(form.cgst), sgst: Number(form.sgst), igst: Number(form.igst) };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        toast.error(`${k.toUpperCase()} must be between 0 and 100.`);
        return;
      }
    }

    const payload = {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      ...nums,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: HsnCode;
      if (editing) {
        saved = await api.patch<HsnCode>(`/hsn-codes/${editing.id}`, payload);
        toast.success('HSN code updated.');
      } else {
        saved = await api.post<HsnCode>('/hsn-codes', payload);
        toast.success('HSN code created.');
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

  const remove = async (h: HsnCode) => {
    const ok = await confirm({
      title: 'Delete HSN code',
      message: `Delete "${h.code}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/hsn-codes/${h.id}`);
      toast.success('HSN code deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<HsnCode>[] = [
    { key: 'code', header: 'HSN Code', accessor: (r) => r.code },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.description}
        </span>
      ),
    },
    { key: 'cgst', header: 'CGST', accessor: (r) => pct(r.cgst) },
    { key: 'sgst', header: 'SGST', accessor: (r) => pct(r.sgst) },
    { key: 'igst', header: 'IGST', accessor: (r) => pct(r.igst) },
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
    ? 'View HSN Code'
    : editing
      ? 'Edit HSN Code'
      : 'New HSN Code';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="HSN Code Master"
        description="HSN codes with their GST rates (CGST, SGST, IGST) — shared by all companies"
        icon={<Percent className="h-5 w-5" />}
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
        searchPlaceholder="Search HSN codes..."
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
        emptyMessage="No HSN codes found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="HSN code & GST rates"
        icon={<Percent className="h-5 w-5" />}
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
              label="HSN Code"
              required
              maxLength={20}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="e.g. 1905"
            />
            <Input
              label="Description"
              required
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="e.g. Bread, pastry, cakes"
            />
            <Input
              label="CGST %"
              type="number"
              min={0}
              max={100}
              step="any"
              value={form.cgst}
              onChange={(e) => setHalf('cgst', e.target.value)}
            />
            <Input
              label="SGST %"
              type="number"
              min={0}
              max={100}
              step="any"
              value={form.sgst}
              onChange={(e) => setHalf('sgst', e.target.value)}
            />
            <Input
              label="IGST %"
              type="number"
              min={0}
              max={100}
              step="any"
              value={form.igst}
              onChange={(e) => setForm({ ...form, igst: e.target.value })}
              wrapClassName="sm:col-span-2"
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
