'use client';

import { useRef, useState } from 'react';
import {
  DatabaseBackup,
  Download,
  Upload,
  RotateCcw,
  KeyRound,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import { api, ApiError, API_URL, getToken } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea } from '@/components/ui/Field';
import type { Backup } from '@/lib/types';

const ICON_BTN = 'rounded-lg p-1.5 text-slate-500 transition';
const BRAND = 'hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// The action the high security password drawer is gating.
type PendingAction =
  | { kind: 'backup' }
  | { kind: 'restore-file'; fileName: string }
  | { kind: 'restore-upload'; file: File };

export default function BackupPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Backup[]>('/backup');

  // High security password prompt (shared by backup + restore).
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Restore-from-upload file picker.
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Change high security password drawer.
  const [pwMgrOpen, setPwMgrOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const openPrompt = (action: PendingAction) => {
    setPending(action);
    setPassword('');
    setNote('');
  };
  const closePrompt = () => {
    setPending(null);
    setPassword('');
    setNote('');
  };

  const startBackup = () => openPrompt({ kind: 'backup' });

  const startRestoreFile = async (b: Backup) => {
    const ok = await confirm({
      title: 'Restore database',
      message: `This will OVERWRITE the entire current database with the contents of "${b.fileName}". This cannot be undone. Continue?`,
      danger: true,
      confirmText: 'Restore',
    });
    if (ok) openPrompt({ kind: 'restore-file', fileName: b.fileName });
  };

  const startRestoreUpload = async () => {
    if (!uploadFile) {
      toast.error('Choose a backup (.dump) file to restore.');
      return;
    }
    const ok = await confirm({
      title: 'Restore database',
      message: `This will OVERWRITE the entire current database with the uploaded file "${uploadFile.name}". This cannot be undone. Continue?`,
      danger: true,
      confirmText: 'Restore',
    });
    if (ok) openPrompt({ kind: 'restore-upload', file: uploadFile });
  };

  // Runs the gated action with the entered high security password.
  const execute = async () => {
    if (!pending) return;
    if (!password) {
      toast.error('Enter the high security password.');
      return;
    }
    setBusy(true);
    try {
      if (pending.kind === 'backup') {
        await api.post('/backup', { highSecurityPassword: password, note });
        toast.success('Backup created.');
        await refetch();
      } else if (pending.kind === 'restore-file') {
        await api.post('/backup/restore', {
          highSecurityPassword: password,
          fileName: pending.fileName,
        });
        toast.success('Database restored.');
        await refetch();
      } else {
        const fd = new FormData();
        fd.append('file', pending.file);
        fd.append('highSecurityPassword', password);
        await api.post('/backup/restore/upload', fd);
        toast.success('Database restored from uploaded file.');
        setUploadFile(null);
        if (fileInput.current) fileInput.current.value = '';
        await refetch();
      }
      closePrompt();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (b: Backup) => {
    try {
      const res = await fetch(
        `${API_URL}/backup/${encodeURIComponent(b.fileName)}/download`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = b.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed.');
    }
  };

  const remove = async (b: Backup) => {
    const ok = await confirm({
      title: 'Delete backup',
      message: `Delete the backup file "${b.fileName}"? The database is not affected.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/backup/${encodeURIComponent(b.fileName)}`);
      toast.success('Backup deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const changePassword = async () => {
    if (!curPw || !newPw) {
      toast.error('Enter the current and new password.');
      return;
    }
    if (newPw.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    setSavingPw(true);
    try {
      await api.patch('/backup/security/password', {
        currentPassword: curPw,
        newPassword: newPw,
      });
      toast.success('High security password changed.');
      setPwMgrOpen(false);
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to change password.');
    } finally {
      setSavingPw(false);
    }
  };

  const columns: Column<Backup>[] = [
    {
      key: 'fileName',
      header: 'File',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.fileName}
        </span>
      ),
    },
    { key: 'sizeBytes', header: 'Size', accessor: (r) => formatBytes(r.sizeBytes) },
    { key: 'createdAt', header: 'Created', accessor: (r) => formatDate(r.createdAt) },
    { key: 'createdBy', header: 'By', accessor: (r) => r.createdBy ?? '-' },
    { key: 'note', header: 'Note', accessor: (r) => r.note ?? '-' },
  ];

  const promptTitle =
    pending?.kind === 'backup' ? 'Create Backup' : 'Confirm Restore';

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Backup & Restore"
        description="Create database backups and restore from them. Protected by the high security password."
        icon={<DatabaseBackup className="h-5 w-5" />}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setPwMgrOpen(true)}>
              <KeyRound className="h-4 w-4" /> Security Password
            </button>
            <button className="btn-primary" onClick={startBackup}>
              <Plus className="h-4 w-4" /> Create Backup
            </button>
          </>
        }
      />

      {/* Restore from an uploaded file */}
      <div className="card mb-6 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Upload className="h-4 w-4 text-brand-600" /> Restore from a file
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInput}
            type="file"
            accept=".dump"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200 sm:max-w-md"
          />
          <button
            className="btn-danger shrink-0"
            onClick={startRestoreUpload}
            disabled={!uploadFile}
          >
            <RotateCcw className="h-4 w-4" /> Restore Uploaded File
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Restoring overwrites the entire current database. Take a backup first.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.fileName}
        loading={loading}
        onRefresh={refetch}
        searchPlaceholder="Search backups..."
        onDelete={remove}
        rowActions={(r) => (
          <>
            <button
              onClick={() => download(r)}
              title="Download"
              className={`${ICON_BTN} ${BRAND}`}
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={() => startRestoreFile(r)}
              title="Restore"
              className={`${ICON_BTN} ${BRAND}`}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </>
        )}
        emptyMessage="No backups yet"
      />

      {/* High security password prompt (backup + restore) */}
      <Drawer
        open={!!pending}
        onClose={closePrompt}
        title={promptTitle}
        subtitle="Enter the high security password to continue"
        icon={<DatabaseBackup className="h-5 w-5" />}
        width="sm"
        footer={
          <DrawerFooter
            onCancel={closePrompt}
            onSave={execute}
            saving={busy}
            saveLabel={pending?.kind === 'backup' ? 'Create Backup' : 'Restore'}
          />
        }
      >
        <div className="space-y-4">
          {pending && pending.kind !== 'backup' && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This will <strong>overwrite the entire current database</strong>.
                This action cannot be undone.
              </span>
            </div>
          )}
          {pending?.kind === 'backup' && (
            <Textarea
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. before year-end close"
              maxLength={200}
            />
          )}
          <Input
            label="High Security Password"
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) execute();
            }}
            placeholder="••••••••"
          />
        </div>
      </Drawer>

      {/* Change high security password */}
      <Drawer
        open={pwMgrOpen}
        onClose={() => setPwMgrOpen(false)}
        title="High Security Password"
        subtitle="Change the password that gates backup and restore"
        icon={<KeyRound className="h-5 w-5" />}
        width="sm"
        footer={
          <DrawerFooter
            onCancel={() => setPwMgrOpen(false)}
            onSave={changePassword}
            saving={savingPw}
            saveLabel="Change Password"
          />
        }
      >
        <div className="space-y-4">
          <Input
            label="Current Password"
            type="password"
            required
            value={curPw}
            onChange={(e) => setCurPw(e.target.value)}
          />
          <Input
            label="New Password"
            type="password"
            required
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="At least 6 characters"
          />
          <Input
            label="Confirm New Password"
            type="password"
            required
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
        </div>
      </Drawer>
    </div>
  );
}
