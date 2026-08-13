'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Box,
  FileText,
  BarChart3,
  Table2,
  History,
  Monitor,
  LayoutDashboard,
  Lock,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  DataTable,
  type Column,
  type SortState,
} from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { IconPicker } from '@/components/ui/IconPicker';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { formatDate } from '@/lib/utils';
import type {
  ErpObject,
  ObjectListResponse,
  Module,
  ObjectType,
  ObjectRevision,
  Lookup,
  LookupValue,
} from '@/lib/types';

// Lookup code for the Developers list that drives the Author dropdown.
const DEVELOPERS_LOOKUP_CODE = 'DEVELOPERS';

const ROUTE = '/cpanel/objects';
const PAGE_SIZE = 15;

const emptyForm = {
  moduleId: '',
  author: '',
  objectType: 'FORM' as ObjectType,
  objectName: '',
  showInMenu: false,
  nameInMenu: '',
  description: '',
  route: '',
  icon: '',
  help: false,
  isSystem: false,
  notes: '',
};

export default function ObjectsPage() {
  const { can, user } = useAuth();
  const isSuperAdmin = !!user?.isSuperAdmin;
  const toast = useToast();
  const confirm = useConfirm();

  const [resp, setResp] = useState<ObjectListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<Module[]>([]);
  // Developers list (lookup values) that the Author field selects from.
  const [developers, setDevelopers] = useState<LookupValue[]>([]);

  const [search, setSearch] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [objectType, setObjectType] = useState('');
  // System/User classification filter (super admin only): '' | 'system' | 'user'.
  const [classFilter, setClassFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({
    key: 'createdAt',
    dir: 'desc',
  });

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  // drawer state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ErpObject | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('object');

  // revisions
  const [revisions, setRevisions] = useState<ObjectRevision[]>([]);
  const [revForm, setRevForm] = useState({
    revisionNumber: '',
    revisedBy: '',
    reason: '',
    changesDone: '',
  });
  const [revSaving, setRevSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (moduleId) params.set('moduleId', moduleId);
      if (objectType) params.set('objectType', objectType);
      if (classFilter) params.set('isSystem', String(classFilter === 'system'));
      params.set('sortBy', sort.key);
      params.set('sortDir', sort.dir);
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      const res = await api.get<ObjectListResponse>(
        `/objects?${params.toString()}`,
      );
      setResp(res);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load objects.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, moduleId, objectType, classFilter, page, sort]);

  useEffect(() => {
    load();
  }, [load]);

  // Shared lock/unlock behavior, gated by the screen's lock/unlock privileges.
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<ErpObject>({
      endpoint: '/objects',
      route: ROUTE,
      noun: 'object',
      nameOf: (o) => o.objectName,
      reload: load,
    });

  // Objects are global, so the Module filter uses the global module catalog
  // (not the active company's enabled modules).
  useEffect(() => {
    api
      .get<Module[]>('/modules')
      .then((m) => setModules(m ?? []))
      .catch(() => {});
  }, []);

  // Load the Developers lookup values (global reference data) for the Author
  // dropdown: find the lookup by code, then fetch its values.
  useEffect(() => {
    let cancelled = false;
    api
      .get<Lookup[]>('/lookups')
      .then((lookups) => {
        const dev = (lookups ?? []).find(
          (l) => l.code === DEVELOPERS_LOOKUP_CODE,
        );
        if (!dev) return [] as LookupValue[];
        return api.get<LookupValue[]>(`/lookups/${dev.id}/values`);
      })
      .then((values) => {
        if (!cancelled) setDevelopers(values ?? []);
      })
      .catch(() => {
        if (!cancelled) setDevelopers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // reset to page 1 on filter or sort change
  useEffect(() => {
    setPage(1);
  }, [search, moduleId, objectType, classFilter, sort]);

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.name }));

  // Author choices come from the active Developers lookup values. If an object
  // being edited has an author no longer in the list, keep it selectable so the
  // value isn't silently lost.
  const developerOptions = developers
    .filter((d) => d.isActive)
    .map((d) => ({ value: d.value, label: d.label }));
  const authorOptions =
    form.author && !developerOptions.some((o) => o.value === form.author)
      ? [
          ...developerOptions,
          { value: form.author, label: `${form.author} (not in list)` },
        ]
      : developerOptions;

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...emptyForm });
    setRevisions([]);
    setTab('object');
    setOpen(true);
  };

  const openEdit = async (o: ErpObject) => {
    setEditing(o);
    setView(false);
    setForm({
      moduleId: String(o.moduleId ?? ''),
      author: o.author ?? '',
      objectType: o.objectType,
      objectName: o.objectName ?? '',
      showInMenu: o.showInMenu,
      nameInMenu: o.nameInMenu ?? '',
      description: o.description ?? '',
      route: o.route ?? '',
      icon: o.icon ?? '',
      help: !!o.help,
      isSystem: !!o.isSystem,
      notes: o.notes ?? '',
    });
    setRevisions([]);
    setTab('object');
    setOpen(true);
    // load full detail (incl. revisions)
    try {
      const detail = await api.get<ErpObject>(`/objects/${o.id}`);
      setRevisions(detail.revisions ?? []);
    } catch {
      /* ignore */
    }
  };

  // Read-only view — works for locked records without unlocking them.
  const openView = async (o: ErpObject) => {
    setEditing(o);
    setView(true);
    setForm({
      moduleId: String(o.moduleId ?? ''),
      author: o.author ?? '',
      objectType: o.objectType,
      objectName: o.objectName ?? '',
      showInMenu: o.showInMenu,
      nameInMenu: o.nameInMenu ?? '',
      description: o.description ?? '',
      route: o.route ?? '',
      icon: o.icon ?? '',
      help: !!o.help,
      isSystem: !!o.isSystem,
      notes: o.notes ?? '',
    });
    setRevisions([]);
    setTab('object');
    setOpen(true);
    // load full detail (incl. revisions)
    try {
      const detail = await api.get<ErpObject>(`/objects/${o.id}`);
      setRevisions(detail.revisions ?? []);
    } catch {
      /* ignore */
    }
  };

  const buildPayload = () => ({
    moduleId: Number(form.moduleId),
    author: form.author,
    objectType: form.objectType,
    objectName: form.objectName,
    showInMenu: form.showInMenu,
    nameInMenu: form.nameInMenu || null,
    description: form.description || null,
    route: form.route || null,
    icon: form.icon || null,
    help: form.help,
    // Only super admins may classify objects; the backend ignores it otherwise.
    isSystem: isSuperAdmin ? form.isSystem : undefined,
    notes: form.notes || null,
  });

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.moduleId || !form.author.trim() || !form.objectName.trim()) {
      toast.error('Module, Author and Object Name are required.');
      return;
    }
    if (form.showInMenu && !form.nameInMenu.trim()) {
      toast.error('Name in Menu is required when "Show in Menu" is checked.');
      return;
    }
    setSaving(true);
    try {
      let saved: ErpObject;
      if (editing) {
        saved = await api.patch<ErpObject>(
          `/objects/${editing.id}`,
          buildPayload(),
        );
        toast.success('Object updated.');
      } else {
        saved = await api.post<ErpObject>('/objects', buildPayload());
        toast.success('Object created.');
      }
      await load();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...emptyForm });
        setTab('object');
      } else if (mode === 'save') {
        setEditing(saved);
        setForm({
          moduleId: String(saved.moduleId ?? ''),
          author: saved.author ?? '',
          objectType: saved.objectType,
          objectName: saved.objectName ?? '',
          showInMenu: saved.showInMenu,
          nameInMenu: saved.nameInMenu ?? '',
          description: saved.description ?? '',
          route: saved.route ?? '',
          icon: saved.icon ?? '',
          help: !!saved.help,
          isSystem: !!saved.isSystem,
          notes: saved.notes ?? '',
        });
      } else {
        setOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o: ErpObject) => {
    const ok = await confirm({
      title: 'Delete object',
      message: `Delete "${o.objectName}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/objects/${o.id}`);
      toast.success('Object deleted.');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const addRevision = async () => {
    if (!editing) return;
    if (!revForm.revisedBy.trim()) {
      toast.error('Revised By is required.');
      return;
    }
    setRevSaving(true);
    try {
      await api.post(`/objects/${editing.id}/revisions`, {
        revisionNumber: Number(revForm.revisionNumber) || undefined,
        revisedBy: revForm.revisedBy,
        reason: revForm.reason || null,
        changesDone: revForm.changesDone || null,
      });
      toast.success('Revision added.');
      const detail = await api.get<ErpObject>(`/objects/${editing.id}`);
      setRevisions(detail.revisions ?? []);
      setRevForm({
        revisionNumber: '',
        revisedBy: '',
        reason: '',
        changesDone: '',
      });
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to add revision.',
      );
    } finally {
      setRevSaving(false);
    }
  };

  const typeBadge = (t: ObjectType) => {
    const map: Record<ObjectType, 'blue' | 'violet' | 'amber' | 'green'> = {
      FORM: 'blue',
      REPORT: 'violet',
      TABLE: 'amber',
      DASHBOARD: 'green',
    };
    const labels: Record<ObjectType, string> = {
      FORM: 'Form',
      REPORT: 'Report',
      TABLE: 'Table',
      DASHBOARD: 'Dashboard',
    };
    return <Badge color={map[t]}>{labels[t]}</Badge>;
  };

  const columns: Column<ErpObject>[] = [
    {
      key: 'createdAt',
      header: 'Date',
      sortable: true,
      render: (r) => (
        <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">
          {formatDate(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      sortable: true,
      // Resolve the stored developer code to its name; fall back to the raw
      // value for legacy free-text authors no longer in the list.
      render: (r) =>
        developers.find((d) => d.value === r.author)?.label ?? r.author,
    },
    {
      key: 'module',
      header: 'Module',
      sortable: true,
      render: (r) =>
        r.module?.name ?? modules.find((m) => m.id === r.moduleId)?.name ?? '-',
    },
    {
      key: 'objectType',
      header: 'Object Type',
      sortable: true,
      render: (r) => typeBadge(r.objectType),
    },
    {
      key: 'objectName',
      header: 'Object Name',
      sortable: true,
      render: (r) => (
        <span className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
          {r.objectName}
          {r.isLocked && (
            <Lock className="h-3.5 w-3.5 text-amber-500" aria-label="Locked" />
          )}
        </span>
      ),
    },
    {
      key: 'isSystem',
      header: 'Type',
      sortable: true,
      render: (r) =>
        r.isSystem ? (
          <Badge color="slate">
            <ShieldCheck className="mr-1 inline h-3 w-3" />
            System
          </Badge>
        ) : (
          <Badge color="blue">
            <UserIcon className="mr-1 inline h-3 w-3" />
            User
          </Badge>
        ),
    },
    {
      key: 'nameInMenu',
      header: 'Menu',
      sortable: true,
      render: (r) =>
        r.showInMenu ? (
          <span>{r.nameInMenu || r.objectName}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Object Master"
        description="Manage forms, reports and tables across modules"
        icon={<Monitor className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
            </button>
          )
        }
      />

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Forms"
          value={resp ? resp.counts.forms.toLocaleString() : '—'}
          icon={<FileText className="h-6 w-6" />}
          accent="blue"
        />
        <StatCard
          label="Reports"
          value={resp ? resp.counts.reports.toLocaleString() : '—'}
          icon={<BarChart3 className="h-6 w-6" />}
          accent="violet"
        />
        <StatCard
          label="Tables"
          value={resp ? resp.counts.tables.toLocaleString() : '—'}
          icon={<Table2 className="h-6 w-6" />}
          accent="amber"
        />
        <StatCard
          label="Dashboards"
          value={resp ? (resp.counts.dashboards ?? 0).toLocaleString() : '—'}
          icon={<LayoutDashboard className="h-6 w-6" />}
          accent="emerald"
        />
      </div>

      <DataTable
        fillHeight
        columns={columns}
        rows={resp?.data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={load}
        search={search}
        onSearchChange={setSearch}
        serverSearch
        searchPlaceholder="Search objects..."
        onView={(r) => openView(r)}
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
        emptyMessage="No objects found"
        serverPagination={{
          page,
          total: resp?.total ?? 0,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
        }}
        serverSort={{ sort, onSortChange: setSort }}
        toolbar={
          <>
            <Select
              wrapClassName="w-44"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              placeholder="All Modules"
              options={moduleOptions}
            />
            <Select
              wrapClassName="w-40"
              value={objectType}
              onChange={(e) => setObjectType(e.target.value)}
              placeholder="All Types"
              options={[
                { value: 'FORM', label: 'Form' },
                { value: 'REPORT', label: 'Report' },
                { value: 'TABLE', label: 'Table' },
                { value: 'DASHBOARD', label: 'Dashboard' },
              ]}
            />
            {isSuperAdmin && (
              <Select
                wrapClassName="w-36"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                placeholder="System & User"
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'user', label: 'User' },
                ]}
              />
            )}
          </>
        }
      />

      {/* Drawer */}
      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View Object' : editing ? 'Edit Object' : 'New Object'}
        subtitle={editing ? editing.objectName : 'Object Master'}
        icon={<Monitor className="h-5 w-5" />}
        width="lg"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : tab === 'object' ? (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={save}
              saving={saving}
              dataEntry
            />
          ) : undefined
        }
      >
        <Tabs
          tabs={[
            {
              key: 'object',
              label: 'Object',
              icon: <Monitor className="h-4 w-4" />,
            },
            {
              key: 'revisions',
              label: 'Revision History',
              icon: <History className="h-4 w-4" />,
              disabled: !editing,
            },
          ]}
          active={tab}
          onChange={setTab}
          className="mb-5"
        />

        {/* Tab navigation stays outside the read-only wrapper so tabs remain
            switchable in view mode. */}
        <ReadOnlyFieldset readOnly={view}>
          {tab === 'object' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Module"
                required
                value={form.moduleId}
                onChange={(e) => setForm({ ...form, moduleId: e.target.value })}
                placeholder="Select"
                options={moduleOptions}
              />
              <Select
                label="Author"
                required
                value={form.author}
                onChange={(e) => setForm({ ...form, author: e.target.value })}
                placeholder="Select developer"
                options={authorOptions}
              />
              <Select
                label="Object Type"
                required
                value={form.objectType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    objectType: e.target.value as ObjectType,
                  })
                }
                options={[
                  { value: 'FORM', label: 'Form' },
                  { value: 'REPORT', label: 'Report' },
                  { value: 'TABLE', label: 'Table' },
                  { value: 'DASHBOARD', label: 'Dashboard' },
                ]}
              />
              <Input
                label="Object Name"
                required
                value={form.objectName}
                onChange={(e) =>
                  setForm({ ...form, objectName: e.target.value })
                }
              />
              <div className="flex items-end pb-2">
                <Checkbox
                  label="Show in Menu"
                  checked={form.showInMenu}
                  onChange={(e) =>
                    setForm({ ...form, showInMenu: e.target.checked })
                  }
                />
              </div>
              <Input
                label="Name in Menu"
                required={form.showInMenu}
                value={form.nameInMenu}
                onChange={(e) =>
                  setForm({ ...form, nameInMenu: e.target.value })
                }
                disabled={!form.showInMenu}
                placeholder={form.showInMenu ? '' : 'Enable "Show in Menu"'}
              />
              {isSuperAdmin && (
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2">
                  <Checkbox
                    label="System object"
                    checked={form.isSystem}
                    onChange={(e) =>
                      setForm({ ...form, isSystem: e.target.checked })
                    }
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    System objects (Cpanel core) are visible only to super
                    admins. New system objects are locked by default; unlock
                    them to edit or delete.
                  </p>
                </div>
              )}
              <Input
                label="Route"
                wrapClassName="sm:col-span-2"
                value={form.route}
                onChange={(e) => setForm({ ...form, route: e.target.value })}
                placeholder="e.g. /cpanel/objects"
              />
              <IconPicker
                label="Icon"
                value={form.icon}
                onChange={(icon) => setForm({ ...form, icon })}
              />
              <div className="flex items-end pb-2">
                <Checkbox
                  label="Help Available"
                  checked={form.help}
                  onChange={(e) => setForm({ ...form, help: e.target.checked })}
                />
              </div>
              <Textarea
                label="Notes"
                wrapClassName="sm:col-span-2"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
              {/* Description — kept at the very bottom of the form. */}
              <Textarea
                label="Description"
                wrapClassName="sm:col-span-2"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Add revision form */}
              <div className="card p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Add Revision
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Revision Number"
                    type="number"
                    value={revForm.revisionNumber}
                    onChange={(e) =>
                      setRevForm({
                        ...revForm,
                        revisionNumber: e.target.value,
                      })
                    }
                  />
                  <Input
                    label="Revised By"
                    required
                    value={revForm.revisedBy}
                    onChange={(e) =>
                      setRevForm({ ...revForm, revisedBy: e.target.value })
                    }
                  />
                  <Input
                    label="Reason"
                    wrapClassName="sm:col-span-2"
                    value={revForm.reason}
                    onChange={(e) =>
                      setRevForm({ ...revForm, reason: e.target.value })
                    }
                  />
                  <Textarea
                    label="Changes Done"
                    wrapClassName="sm:col-span-2"
                    value={revForm.changesDone}
                    onChange={(e) =>
                      setRevForm({ ...revForm, changesDone: e.target.value })
                    }
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    className="btn-success"
                    onClick={addRevision}
                    disabled={revSaving}
                  >
                    {revSaving ? 'Saving...' : 'Add Revision'}
                  </button>
                </div>
              </div>

              {/* Revision list */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  History
                </h3>
                {revisions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
                    No revisions recorded yet
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {revisions
                      .slice()
                      .sort(
                        (a, b) =>
                          (b.revisionNumber ?? 0) - (a.revisionNumber ?? 0),
                      )
                      .map((r) => (
                        <li
                          key={r.id}
                          className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                        >
                          <div className="flex items-center justify-between">
                            <Badge color="blue">Rev #{r.revisionNumber}</Badge>
                            <span className="text-xs text-slate-400">
                              {formatDate(r.createdAt)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                            <span className="font-medium">By:</span>{' '}
                            {r.revisedBy}
                          </p>
                          {r.reason && (
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                              <span className="font-medium">Reason:</span>{' '}
                              {r.reason}
                            </p>
                          )}
                          {r.changesDone && (
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                              <span className="font-medium">Changes:</span>{' '}
                              {r.changesDone}
                            </p>
                          )}
                        </li>
                      ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
