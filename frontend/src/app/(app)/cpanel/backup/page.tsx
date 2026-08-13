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
  Table2,
  Search,
} from 'lucide-react';
import { api, ApiError, API_URL, getToken } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field';
import type { Backup, BackupTableInfo, TableDump } from '@/lib/types';

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
  | { kind: 'restore-upload'; file: File }
  | { kind: 'backup-tables'; tables: string[] }
  | {
      kind: 'restore-table-file';
      table: string;
      tableLabel: string;
      fileName: string;
    }
  | {
      kind: 'restore-table-upload';
      table: string;
      tableLabel: string;
      file: File;
    };

const isTableRestore = (a: PendingAction | null) =>
  a?.kind === 'restore-table-file' || a?.kind === 'restore-table-upload';

export default function BackupPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Backup[]>('/backup');

  // Table-wise backup/restore.
  const { data: tables, refetch: refetchTables } =
    useFetch<BackupTableInfo[]>('/backup/tables');
  const {
    data: tableDumps,
    loading: dumpsLoading,
    refetch: refetchDumps,
  } = useFetch<TableDump[]>('/backup/tables/dumps');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  // Restore-a-table-from-upload picker.
  const tableFileInput = useRef<HTMLInputElement>(null);
  const [tableUploadFile, setTableUploadFile] = useState<File | null>(null);
  const [restoreTarget, setRestoreTarget] = useState('');

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

  // ---- Table-wise actions ----
  const toggleTable = (name: string) =>
    setSelectedTables((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );

  const startBackupTables = () => {
    if (selectedTables.length === 0) {
      toast.error('Select at least one table to back up.');
      return;
    }
    openPrompt({ kind: 'backup-tables', tables: selectedTables });
  };

  const startRestoreTableFile = async (d: TableDump) => {
    const ok = await confirm({
      title: `Restore table “${d.tableLabel}”`,
      message: `This will REPLACE all rows in the "${d.table}" table with the contents of "${d.fileName}". Other tables are untouched. Continue?`,
      danger: true,
      confirmText: 'Restore',
    });
    if (ok)
      openPrompt({
        kind: 'restore-table-file',
        table: d.table,
        tableLabel: d.tableLabel,
        fileName: d.fileName,
      });
  };

  const startRestoreTableUpload = async () => {
    if (!restoreTarget) {
      toast.error('Choose the table to restore into.');
      return;
    }
    if (!tableUploadFile) {
      toast.error('Choose a table dump (.dump) file to restore.');
      return;
    }
    const label =
      tables?.find((t) => t.name === restoreTarget)?.label ?? restoreTarget;
    const ok = await confirm({
      title: `Restore table “${label}”`,
      message: `This will REPLACE all rows in the "${restoreTarget}" table with the uploaded file "${tableUploadFile.name}". The file must be a dump of that table. Continue?`,
      danger: true,
      confirmText: 'Restore',
    });
    if (ok)
      openPrompt({
        kind: 'restore-table-upload',
        table: restoreTarget,
        tableLabel: label,
        file: tableUploadFile,
      });
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
      } else if (pending.kind === 'restore-upload') {
        const fd = new FormData();
        fd.append('file', pending.file);
        fd.append('highSecurityPassword', password);
        await api.post('/backup/restore/upload', fd);
        toast.success('Database restored from uploaded file.');
        setUploadFile(null);
        if (fileInput.current) fileInput.current.value = '';
        await refetch();
      } else if (pending.kind === 'backup-tables') {
        await api.post('/backup/tables', {
          highSecurityPassword: password,
          tables: pending.tables,
          note,
        });
        toast.success(
          `Backed up ${pending.tables.length} table${
            pending.tables.length === 1 ? '' : 's'
          }.`,
        );
        setSelectedTables([]);
        await Promise.all([refetchDumps(), refetchTables()]);
      } else if (pending.kind === 'restore-table-file') {
        await api.post('/backup/tables/restore', {
          highSecurityPassword: password,
          table: pending.table,
          fileName: pending.fileName,
        });
        toast.success(`Table “${pending.tableLabel}” restored.`);
        await refetchTables();
      } else {
        const fd = new FormData();
        fd.append('file', pending.file);
        fd.append('highSecurityPassword', password);
        fd.append('table', pending.table);
        await api.post('/backup/tables/restore/upload', fd);
        toast.success(
          `Table “${pending.tableLabel}” restored from uploaded file.`,
        );
        setTableUploadFile(null);
        setRestoreTarget('');
        if (tableFileInput.current) tableFileInput.current.value = '';
        await refetchTables();
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

  const downloadTableDump = async (d: TableDump) => {
    try {
      const res = await fetch(
        `${API_URL}/backup/tables/${encodeURIComponent(d.fileName)}/download`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed.');
    }
  };

  const removeTableDump = async (d: TableDump) => {
    const ok = await confirm({
      title: 'Delete table dump',
      message: `Delete the dump file "${d.fileName}"? The table data is not affected.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/backup/tables/${encodeURIComponent(d.fileName)}`);
      toast.success('Dump deleted.');
      refetchDumps();
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
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to change password.',
      );
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
    {
      key: 'sizeBytes',
      header: 'Size',
      accessor: (r) => formatBytes(r.sizeBytes),
    },
    {
      key: 'createdAt',
      header: 'Created',
      accessor: (r) => formatDate(r.createdAt),
    },
    { key: 'createdBy', header: 'By', accessor: (r) => r.createdBy ?? '-' },
    { key: 'note', header: 'Note', accessor: (r) => r.note ?? '-' },
  ];

  const isBackupKind =
    pending?.kind === 'backup' || pending?.kind === 'backup-tables';
  const promptTitle =
    pending?.kind === 'backup'
      ? 'Create Backup'
      : pending?.kind === 'backup-tables'
        ? 'Back Up Tables'
        : 'Confirm Restore';

  // Dump files for the table currently chosen in the upload-restore picker —
  // surfaced as a hint so the user grabs a matching dump.
  const matchingDumps = restoreTarget
    ? (tableDumps ?? []).filter((d) => d.table === restoreTarget)
    : [];

  const filteredTables = (tables ?? []).filter((t) =>
    (t.label + ' ' + t.name)
      .toLowerCase()
      .includes(tableSearch.trim().toLowerCase()),
  );

  const dumpColumns: Column<TableDump>[] = [
    {
      key: 'tableLabel',
      header: 'Table',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.tableLabel}
        </span>
      ),
    },
    {
      key: 'fileName',
      header: 'File',
      accessor: (r) => r.fileName,
    },
    {
      key: 'sizeBytes',
      header: 'Size',
      accessor: (r) => formatBytes(r.sizeBytes),
    },
    {
      key: 'createdAt',
      header: 'Created',
      accessor: (r) => formatDate(r.createdAt),
    },
    { key: 'createdBy', header: 'By', accessor: (r) => r.createdBy ?? '-' },
    { key: 'note', header: 'Note', accessor: (r) => r.note ?? '-' },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col">
      <PageHeader
        title="Backup & Restore"
        description="Create database backups and restore from them. Protected by the high security password."
        icon={<DatabaseBackup className="h-5 w-5" />}
        actions={
          <>
            <button
              className="btn-secondary"
              onClick={() => setPwMgrOpen(true)}
            >
              <KeyRound className="h-4 w-4" /> Security Password
            </button>
            <button className="btn-primary" onClick={startBackup}>
              <Plus className="h-4 w-4" /> Create Backup
            </button>
          </>
        }
      />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Full database
      </h2>

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
        fillHeight={false}
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

      {/* ---------------- Table-wise backup & restore ---------------- */}
      <h2 className="mb-3 mt-10 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Table2 className="h-4 w-4" /> Table backups
      </h2>

      {/* Pick tables to back up — each becomes its own dump file. */}
      <div className="card mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <DatabaseBackup className="h-4 w-4 text-brand-600" /> Back up tables
            <span className="font-normal text-slate-400">
              ({selectedTables.length} selected)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search tables..."
                className="input-base w-48 pl-8"
              />
            </div>
            <button
              className="btn-primary shrink-0"
              onClick={startBackupTables}
              disabled={selectedTables.length === 0}
            >
              <Plus className="h-4 w-4" /> Back Up Selected
            </button>
          </div>
        </div>

        <div className="mb-3 flex gap-3 text-xs">
          <button
            className="text-brand-600 hover:underline"
            onClick={() => setSelectedTables(filteredTables.map((t) => t.name))}
          >
            Select all
          </button>
          <button
            className="text-slate-500 hover:underline"
            onClick={() => setSelectedTables([])}
          >
            Clear
          </button>
        </div>

        <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {filteredTables.map((t) => (
            <label
              key={t.name}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <Checkbox
                checked={selectedTables.includes(t.name)}
                onChange={() => toggleTable(t.name)}
              />
              <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                {t.label}
              </span>
              <span className="text-xs tabular-nums text-slate-400">
                {t.rowCount}
              </span>
            </label>
          ))}
          {filteredTables.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-slate-400">
              No tables match.
            </p>
          )}
        </div>
      </div>

      {/* Restore a single table from an uploaded dump. */}
      <div className="card mb-6 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Upload className="h-4 w-4 text-brand-600" /> Restore a table from a
          file
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Select
            label="Target table"
            value={restoreTarget}
            onChange={(e) => setRestoreTarget(e.target.value)}
            placeholder="Select a table"
            wrapClassName="sm:w-56"
            options={(tables ?? []).map((t) => ({
              value: t.name,
              label: t.label,
            }))}
          />
          <input
            ref={tableFileInput}
            type="file"
            accept=".dump"
            onChange={(e) => setTableUploadFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200 sm:max-w-xs"
          />
          <button
            className="btn-danger shrink-0"
            onClick={startRestoreTableUpload}
            disabled={!restoreTarget || !tableUploadFile}
          >
            <RotateCcw className="h-4 w-4" /> Restore Table
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The file must be a dump of the selected table — a mismatched file is
          rejected. Only that table’s rows are replaced.
        </p>
        {restoreTarget && (
          <p className="mt-1 text-xs text-slate-400">
            {matchingDumps.length} server dump
            {matchingDumps.length === 1 ? '' : 's'} available for this table
            below.
          </p>
        )}
      </div>

      <DataTable
        columns={dumpColumns}
        rows={tableDumps ?? []}
        rowKey={(r) => r.fileName}
        loading={dumpsLoading}
        fillHeight={false}
        onRefresh={refetchDumps}
        searchPlaceholder="Search table dumps..."
        onDelete={removeTableDump}
        rowActions={(r) => (
          <>
            <button
              onClick={() => downloadTableDump(r)}
              title="Download"
              className={`${ICON_BTN} ${BRAND}`}
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={() => startRestoreTableFile(r)}
              title={`Restore into ${r.table}`}
              className={`${ICON_BTN} ${BRAND}`}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </>
        )}
        emptyMessage="No table dumps yet"
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
            saveLabel={isBackupKind ? 'Create Backup' : 'Restore'}
          />
        }
      >
        <div className="space-y-4">
          {pending && !isBackupKind && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {isTableRestore(pending) ? (
                  <>
                    This will <strong>replace all rows</strong> in the{' '}
                    <strong>
                      {pending.kind === 'restore-table-file' ||
                      pending.kind === 'restore-table-upload'
                        ? pending.tableLabel
                        : ''}
                    </strong>{' '}
                    table. This action cannot be undone.
                  </>
                ) : (
                  <>
                    This will{' '}
                    <strong>overwrite the entire current database</strong>. This
                    action cannot be undone.
                  </>
                )}
              </span>
            </div>
          )}
          {isBackupKind && (
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
