'use client';

import { useEffect, useMemo, useState } from 'react';
import { Boxes, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  BatchNumberingRow,
  BatchDateFormat,
  BatchRenumber,
} from '@/lib/types';

const ROUTE = '/cpanel/batch-numbering';
const YESNO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const DATE_FORMAT = [
  { value: 'YYMMDD', label: 'YYMMDD (26-07-10 → 260710)' },
  { value: 'YYYYMMDD', label: 'YYYYMMDD (2026-07-10 → 20260710)' },
];
const RENUMBER = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
];

type Mode = 'add' | 'edit' | 'view';
const emptyForm = {
  prefixEnabled: 'yes',
  prefixValue: '',
  dateFormat: 'YYMMDD' as BatchDateFormat,
  paddingLength: '4',
  startingNo: '1',
  renumber: 'DAILY' as BatchRenumber,
};

/** Path segment for a rule's branch (null = the company-level rule). */
const branchKey = (branchId: number | null) =>
  branchId == null ? 'company' : String(branchId);

export default function BatchNumberingPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } =
    useFetch<BatchNumberingRow[]>('/batch-numbering');

  const canAdd = can(ROUTE, 'add');
  const canEditPriv = can(ROUTE, 'edit');
  const canDeletePriv = can(ROUTE, 'delete');
  const canViewPriv = can(ROUTE, 'view');
  const canLock = can(ROUTE, 'lock');
  const canUnlock = can(ROUTE, 'unlock');

  const toggleLock = async (r: BatchNumberingRow) => {
    const locking = !r.isLocked;
    if (locking) {
      const ok = await confirm({
        title: 'Lock batch numbering rule',
        message: `Lock "${r.branchName}"? It can't be edited or removed until unlocked.`,
        confirmText: 'Lock',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/batch-numbering/${branchKey(r.branchId)}/lock`, {
        locked: locking,
      });
      toast.success(locking ? 'Rule locked.' : 'Rule unlocked.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };
  const guardLocked = (r: BatchNumberingRow, fn: () => void) => {
    if (r.isLocked) {
      toast.error('This rule is locked. Unlock it first.');
      return;
    }
    fn();
  };

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('add');
  const [saving, setSaving] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [form, setForm] = useState({ ...emptyForm });
  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const branchName = (key: string) =>
    (data ?? []).find((r) => branchKey(r.branchId) === key)?.branchName ?? '';
  const branchOptions = useMemo(
    () =>
      (data ?? []).map((r) => ({
        value: branchKey(r.branchId),
        label: r.branchName,
      })),
    [data],
  );

  const formFrom = (r: BatchNumberingRow) => ({
    prefixEnabled: r.prefixEnabled ? 'yes' : 'no',
    prefixValue: r.prefixValue ?? '',
    dateFormat: r.dateFormat,
    paddingLength: String(r.paddingLength),
    startingNo: String(r.startingNo),
    renumber: r.renumber,
  });

  const openNew = () => {
    setMode('add');
    setBranchId('');
    setForm({ ...emptyForm });
    setOpen(true);
  };
  const openEdit = (r: BatchNumberingRow) => {
    setMode('edit');
    setBranchId(branchKey(r.branchId));
    setForm(formFrom(r));
    setOpen(true);
  };
  const openView = (r: BatchNumberingRow) => {
    setMode('view');
    setBranchId(branchKey(r.branchId));
    setForm(formFrom(r));
    setOpen(true);
  };
  const closeDrawer = () => setOpen(false);

  // In add mode, choosing a branch loads its current rule into the form.
  const onPickBranch = (key: string) => {
    setBranchId(key);
    const row = (data ?? []).find((r) => branchKey(r.branchId) === key);
    if (row) setForm(formFrom(row));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'a' && canAdd && !open) {
        e.preventDefault();
        openNew();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdd, open]);

  const save = async () => {
    if (!branchId) {
      toast.error('Select a branch.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/batch-numbering', {
        branchId: branchId === 'company' ? null : Number(branchId),
        prefixEnabled: form.prefixEnabled === 'yes',
        prefixValue: form.prefixValue.trim() || null,
        dateFormat: form.dateFormat,
        paddingLength: Number(form.paddingLength) || 4,
        startingNo: Number(form.startingNo) || 1,
        renumber: form.renumber,
      });
      toast.success('Batch numbering rule saved.');
      await refetch();
      closeDrawer();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (r: BatchNumberingRow) => {
    if (!r.configured) {
      toast.info('This branch has no custom rule to remove.');
      return;
    }
    const ok = await confirm({
      title: 'Remove batch numbering rule',
      message: `Remove the batch numbering rule for "${r.branchName}"? It reverts to the default scheme.`,
      danger: true,
      confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/batch-numbering/${branchKey(r.branchId)}`);
      toast.success('Rule removed.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  const view = mode === 'view';
  const title =
    mode === 'view'
      ? `View — ${branchName(branchId)}`
      : mode === 'edit'
        ? `Edit — ${branchName(branchId)}`
        : 'New Batch Numbering Rule';

  const columns: Column<BatchNumberingRow>[] = [
    {
      key: 'branchName',
      header: 'Branch',
      sortable: true,
      sortAccessor: (r) => r.branchName,
      render: (r) => (
        <span className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
          {r.branchName}
          {!r.configured && <Badge color="slate">Default</Badge>}
        </span>
      ),
    },
    {
      key: 'prefix',
      header: 'Prefix',
      accessor: (r) => (r.prefixEnabled ? 'Yes' : 'No'),
    },
    {
      key: 'prefixValue',
      header: 'Prefix Val',
      accessor: (r) => r.prefixValue ?? '—',
    },
    { key: 'dateFormat', header: 'Date', accessor: (r) => r.dateFormat },
    {
      key: 'startingNo',
      header: 'Starting No',
      accessor: (r) => r.startingNo,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'paddingLength',
      header: 'Padding',
      accessor: (r) => r.paddingLength,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    { key: 'renumber', header: 'Renumber', accessor: (r) => cap(r.renumber) },
    {
      key: 'preview',
      header: 'Next (example)',
      render: (r) => (
        <span className="font-mono text-xs text-slate-500">{r.preview}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-[1500px] flex-col">
      <PageHeader
        title="Batch Numbering"
        description="Per-company & branch sequencer for stock batch numbers — prefix, date, padding & renumber period"
        icon={<Boxes className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openNew}>
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
        rowKey={(r) => branchKey(r.branchId)}
        loading={loading}
        fillHeight
        bordered
        onRefresh={refetch}
        searchPlaceholder="Search branches..."
        onView={openView}
        onEdit={
          canEditPriv ? (r) => guardLocked(r, () => openEdit(r)) : undefined
        }
        onDelete={
          canDeletePriv ? (r) => guardLocked(r, () => removeRule(r)) : undefined
        }
        canView={canViewPriv}
        canEdit={canEditPriv}
        canDelete={canDeletePriv}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No branches found"
      />

      {/* Overlay rule editor */}
      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Batch numbering rule"
        icon={<Boxes className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={save}
              saving={saving}
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mode === 'add' ? (
              <Select
                label="Branch"
                required
                wrapClassName="sm:col-span-2"
                value={branchId}
                onChange={(e) => onPickBranch(e.target.value)}
                placeholder="Select a branch"
                options={branchOptions}
              />
            ) : (
              <Input
                label="Branch"
                wrapClassName="sm:col-span-2"
                value={branchName(branchId)}
                disabled
              />
            )}
            <Select
              label="Prefix"
              value={form.prefixEnabled}
              onChange={(e) => patch({ prefixEnabled: e.target.value })}
              options={YESNO}
            />
            <Input
              label="Prefix value"
              value={form.prefixValue}
              disabled={form.prefixEnabled !== 'yes'}
              onChange={(e) => patch({ prefixValue: e.target.value })}
              placeholder="e.g. EKF-"
            />
            <Select
              label="Date format"
              wrapClassName="sm:col-span-2"
              value={form.dateFormat}
              onChange={(e) =>
                patch({ dateFormat: e.target.value as BatchDateFormat })
              }
              options={DATE_FORMAT}
            />
            <Input
              label="Starting no"
              type="number"
              min={1}
              value={form.startingNo}
              onChange={(e) => patch({ startingNo: e.target.value })}
            />
            <Input
              label="Padding length"
              type="number"
              min={1}
              max={15}
              value={form.paddingLength}
              onChange={(e) => patch({ paddingLength: e.target.value })}
            />
            <Select
              label="Renumber"
              wrapClassName="sm:col-span-2"
              value={form.renumber}
              onChange={(e) =>
                patch({ renumber: e.target.value as BatchRenumber })
              }
              options={RENUMBER}
            />
          </div>
        </ReadOnlyFieldset>
        <p className="mt-3 text-xs text-slate-400">
          Batch number = prefix + date + counter, e.g.{' '}
          <span className="font-mono">
            {form.prefixEnabled === 'yes' ? form.prefixValue || '' : ''}
            {form.dateFormat === 'YYYYMMDD' ? '20260710' : '260710'}-
            {String(Number(form.startingNo) || 1).padStart(
              Number(form.paddingLength) || 4,
              '0',
            )}
          </span>
          . The counter resets {cap(form.renumber).toLowerCase()}.
        </p>
      </Drawer>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
