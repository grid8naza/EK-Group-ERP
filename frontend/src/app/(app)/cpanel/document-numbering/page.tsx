'use client';

import { useEffect, useMemo, useState } from 'react';
import { Hash, Plus } from 'lucide-react';
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
  DocumentNumberingRow,
  NumberingPeriodPosition,
  NumberingRenumber,
} from '@/lib/types';

const ROUTE = '/cpanel/document-numbering';
const YESNO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const RENUMBER = [
  { value: 'NEVER', label: 'Never' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
];
const POSITION = [
  { value: 'BEFORE_SUFFIX', label: 'Before suffix' },
  { value: 'AFTER_SUFFIX', label: 'After suffix' },
];

type Mode = 'add' | 'edit' | 'view';
const emptyForm = {
  prefixEnabled: 'yes',
  prefixValue: '',
  startingNo: '1',
  suffixEnabled: 'no',
  suffixValue: '',
  paddingLength: '5',
  renumber: 'NEVER' as NumberingRenumber,
  periodPosition: 'BEFORE_SUFFIX' as NumberingPeriodPosition,
};

export default function DocumentNumberingPage() {
  const { can, activeBranchId, activeBranch } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  // Re-read when the branch switches: the rule is the company's, but the running
  // number and the preview belong to whichever branch is active.
  const { data, loading, refetch } = useFetch<DocumentNumberingRow[]>(
    '/document-numbering',
    [activeBranchId],
  );
  const branchCode = data?.[0]?.branchCode ?? '';

  const canAdd = can(ROUTE, 'add');
  const canEditPriv = can(ROUTE, 'edit');
  const canDeletePriv = can(ROUTE, 'delete');
  const canViewPriv = can(ROUTE, 'view');
  const canLock = can(ROUTE, 'lock');
  const canUnlock = can(ROUTE, 'unlock');

  const toggleLock = async (r: DocumentNumberingRow) => {
    const locking = !r.isLocked;
    if (locking) {
      const ok = await confirm({
        title: 'Lock numbering rule',
        message: `Lock "${r.documentName}"? It can't be edited or removed until unlocked.`,
        confirmText: 'Lock',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/document-numbering/${r.documentId}/lock`, { locked: locking });
      toast.success(locking ? 'Rule locked.' : 'Rule unlocked.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };
  const guardLocked = (r: DocumentNumberingRow, fn: () => void) => {
    if (r.isLocked) {
      toast.error('This rule is locked. Unlock it first.');
      return;
    }
    fn();
  };

  // Bulk lock/unlock across the current (filtered) rows.
  const bulkLockRows = async (rows: DocumentNumberingRow[], locked: boolean) => {
    const targets = rows.filter((r) => !!r.isLocked !== locked);
    if (targets.length === 0) {
      toast.info(locked ? 'No unlocked rules to lock.' : 'No locked rules to unlock.');
      return;
    }
    const ok = await confirm({
      title: locked ? 'Lock all rules' : 'Unlock all rules',
      message: `${locked ? 'Lock' : 'Unlock'} ${targets.length} rule${targets.length === 1 ? '' : 's'}?${locked ? " They can't be edited or removed until unlocked." : ''}`,
      confirmText: locked ? 'Lock all' : 'Unlock all',
    });
    if (!ok) return;
    const results = await Promise.allSettled(
      targets.map((r) =>
        api.patch(`/document-numbering/${r.documentId}/lock`, { locked }),
      ),
    );
    const failed = results.filter((x) => x.status === 'rejected').length;
    const done = targets.length - failed;
    if (done > 0)
      toast.success(`${done} rule${done === 1 ? '' : 's'} ${locked ? 'locked' : 'unlocked'}.`);
    if (failed > 0)
      toast.error(`${failed} could not be ${locked ? 'locked' : 'unlocked'}.`);
    refetch();
  };

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('add');
  const [saving, setSaving] = useState(false);
  const [docId, setDocId] = useState('');
  const [form, setForm] = useState({ ...emptyForm });
  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const docName = (id: string) =>
    (data ?? []).find((r) => String(r.documentId) === id)?.documentName ?? '';
  const docOptions = useMemo(
    () => (data ?? []).map((r) => ({ value: r.documentId, label: r.documentName })),
    [data],
  );

  const formFrom = (r: DocumentNumberingRow) => ({
    prefixEnabled: r.prefixEnabled ? 'yes' : 'no',
    prefixValue: r.prefixValue ?? '',
    startingNo: String(r.startingNo),
    suffixEnabled: r.suffixEnabled ? 'yes' : 'no',
    suffixValue: r.suffixValue ?? '',
    paddingLength: String(r.paddingLength),
    renumber: r.renumber,
    periodPosition: r.periodPosition,
  });

  const openNew = () => {
    setMode('add');
    setDocId('');
    setForm({ ...emptyForm });
    setOpen(true);
  };
  const openEdit = (r: DocumentNumberingRow) => {
    setMode('edit');
    setDocId(String(r.documentId));
    setForm(formFrom(r));
    setOpen(true);
  };
  const openView = (r: DocumentNumberingRow) => {
    setMode('view');
    setDocId(String(r.documentId));
    setForm(formFrom(r));
    setOpen(true);
  };
  const closeDrawer = () => setOpen(false);

  // In add mode, choosing a document loads its current rule into the form.
  const onPickDocument = (id: string) => {
    setDocId(id);
    const row = (data ?? []).find((r) => String(r.documentId) === id);
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
    if (!docId) {
      toast.error('Select a document.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/document-numbering', {
        documentId: Number(docId),
        prefixEnabled: form.prefixEnabled === 'yes',
        prefixValue: form.prefixValue.trim() || null,
        startingNo: Number(form.startingNo) || 1,
        suffixEnabled: form.suffixEnabled === 'yes',
        suffixValue: form.suffixValue.trim() || null,
        paddingLength: Number(form.paddingLength) || 5,
        renumber: form.renumber,
        periodPosition: form.periodPosition,
      });
      toast.success('Numbering rule saved.');
      await refetch();
      closeDrawer();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (r: DocumentNumberingRow) => {
    if (!r.configured) {
      toast.info('This document has no custom rule to remove.');
      return;
    }
    const ok = await confirm({
      title: 'Remove numbering rule',
      message: `Remove the numbering rule for "${r.documentName}"? It reverts to the default scheme.`,
      danger: true,
      confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/document-numbering/${r.documentId}`);
      toast.success('Rule removed.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  const view = mode === 'view';
  const showPeriod = form.renumber !== 'NEVER';
  const title =
    mode === 'view'
      ? `View — ${docName(docId)}`
      : mode === 'edit'
        ? `Edit — ${docName(docId)}`
        : 'New Numbering Rule';

  const columns: Column<DocumentNumberingRow>[] = [
    {
      key: 'documentName',
      header: 'Document',
      sortable: true,
      sortAccessor: (r) => r.documentName,
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          {r.documentName}
          {!r.configured && <Badge color="slate">Default</Badge>}
        </span>
      ),
    },
    { key: 'prefix', header: 'Prefix', accessor: (r) => (r.prefixEnabled ? 'Yes' : 'No') },
    { key: 'prefixValue', header: 'Prefix Val', accessor: (r) => r.prefixValue ?? '—' },
    { key: 'suffix', header: 'Suffix', accessor: (r) => (r.suffixEnabled ? 'Yes' : 'No') },
    { key: 'suffixValue', header: 'Suffix Val', accessor: (r) => r.suffixValue ?? '—' },
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
      header: branchCode ? `Next (${branchCode})` : 'Next (example)',
      render: (r) => (
        <span className="font-mono text-xs text-slate-500">{r.preview}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-[1500px] flex-col">
      <PageHeader
        title="Document Numbering"
        description={
          branchCode
            ? `Sequencer for each document — prefix, suffix, padding & renumber period. The rule is the company's; the running number is ${activeBranch?.name ?? 'this branch'}'s own, and its code (${branchCode}) leads every number it issues.`
            : 'Per-company sequencer for each document — prefix, suffix, padding & renumber period'
        }
        icon={<Hash className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add New
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">Alt+A</span>
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.documentId}
        loading={loading}
        fillHeight
        bordered
        onRefresh={refetch}
        searchPlaceholder="Search documents..."
        onView={openView}
        onEdit={canEditPriv ? (r) => guardLocked(r, () => openEdit(r)) : undefined}
        onDelete={canDeletePriv ? (r) => guardLocked(r, () => removeRule(r)) : undefined}
        canView={canViewPriv}
        canEdit={canEditPriv}
        canDelete={canDeletePriv}
        bulkLock={{
          canLock,
          canUnlock,
          onLockAll: (rows) => bulkLockRows(rows, true),
          onUnlockAll: (rows) => bulkLockRows(rows, false),
        }}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No documents found"
      />

      {/* Overlay rule editor */}
      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Document numbering rule"
        icon={<Hash className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter onCancel={closeDrawer} onSave={save} saving={saving} />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mode === 'add' ? (
              <Select
                label="Document"
                required
                wrapClassName="sm:col-span-2"
                value={docId}
                onChange={(e) => onPickDocument(e.target.value)}
                placeholder="Select a document"
                options={docOptions}
              />
            ) : (
              <Input
                label="Document"
                wrapClassName="sm:col-span-2"
                value={docName(docId)}
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
              placeholder="e.g. PPV-"
            />
            <Select
              label="Suffix"
              value={form.suffixEnabled}
              onChange={(e) => patch({ suffixEnabled: e.target.value })}
              options={YESNO}
            />
            <Input
              label="Suffix value"
              value={form.suffixValue}
              disabled={form.suffixEnabled !== 'yes'}
              onChange={(e) => patch({ suffixValue: e.target.value })}
              placeholder="e.g. /NMC"
            />
            <Input
              label="Starting no"
              type="number"
              min={0}
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
              value={form.renumber}
              onChange={(e) => patch({ renumber: e.target.value as NumberingRenumber })}
              options={RENUMBER}
            />
            {showPeriod && (
              <Select
                label="Month-year position"
                value={form.periodPosition}
                onChange={(e) =>
                  patch({ periodPosition: e.target.value as NumberingPeriodPosition })
                }
                options={POSITION}
              />
            )}
          </div>
        </ReadOnlyFieldset>
        {showPeriod && (
          <p className="mt-3 text-xs text-slate-400">
            {form.renumber === 'MONTHLY'
              ? 'Counter resets each month and appends the month-year (e.g. /07-2026).'
              : 'Counter resets each year and appends the year (e.g. /2026).'}
          </p>
        )}
      </Drawer>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
