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
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
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
} from '@/lib/types';

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
  help: '',
  notes: '',
};

export default function ObjectsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [resp, setResp] = useState<ObjectListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<Module[]>([]);

  const [search, setSearch] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [objectType, setObjectType] = useState('');
  const [page, setPage] = useState(1);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  // drawer state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ErpObject | null>(null);
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
  }, [search, moduleId, objectType, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<Module[]>('/companies/enabled-modules')
      .then((m) => setModules(m ?? []))
      .catch(() => {});
  }, [activeCompanyId]);

  // reset to page 1 on filter change
  useEffect(() => {
    setPage(1);
  }, [search, moduleId, objectType]);

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.name }));

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setRevisions([]);
    setTab('object');
    setOpen(true);
  };

  const openEdit = async (o: ErpObject) => {
    setEditing(o);
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
      help: o.help ?? '',
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
    help: form.help || null,
    notes: form.notes || null,
  });

  const save = async (again = false) => {
    if (!form.moduleId || !form.author.trim() || !form.objectName.trim()) {
      toast.error('Module, Author and Object Name are required.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/objects/${editing.id}`, buildPayload());
        toast.success('Object updated.');
      } else {
        await api.post('/objects', buildPayload());
        toast.success('Object created.');
      }
      await load();
      if (again) {
        setEditing(null);
        setForm({ ...emptyForm });
        setTab('object');
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
      toast.error(e instanceof ApiError ? e.message : 'Failed to add revision.');
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
      render: (r) => (
        <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">
          {formatDate(r.createdAt)}
        </span>
      ),
    },
    { key: 'author', header: 'Author', accessor: (r) => r.author },
    {
      key: 'module',
      header: 'Module',
      render: (r) =>
        r.module?.name ??
        modules.find((m) => m.id === r.moduleId)?.name ??
        '-',
    },
    {
      key: 'objectType',
      header: 'Object Type',
      render: (r) => typeBadge(r.objectType),
    },
    {
      key: 'objectName',
      header: 'Object Name',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.objectName}
        </span>
      ),
    },
    {
      key: 'nameInMenu',
      header: 'Menu',
      render: (r) =>
        r.showInMenu ? (
          <span>{r.nameInMenu || r.objectName}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
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
        columns={columns}
        rows={resp?.data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={load}
        search={search}
        onSearchChange={setSearch}
        serverSearch
        searchPlaceholder="Search objects..."
        onEdit={openEdit}
        onDelete={remove}
        canEdit={canEdit}
        canDelete={canDelete}
        emptyMessage="No objects found"
        serverPagination={{
          page,
          total: resp?.total ?? 0,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
        }}
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
          </>
        }
      />

      {/* Drawer */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Object' : 'New Object'}
        subtitle={editing ? editing.objectName : 'Object Master'}
        icon={<Monitor className="h-5 w-5" />}
        width="lg"
        footer={
          tab === 'object' ? (
            <DrawerFooter
              onCancel={() => setOpen(false)}
              onSave={() => save(false)}
              onSaveNew={editing ? undefined : () => save(true)}
              saving={saving}
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
            <Input
              label="Author"
              required
              value={form.author}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
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
              value={form.nameInMenu}
              onChange={(e) =>
                setForm({ ...form, nameInMenu: e.target.value })
              }
              disabled={!form.showInMenu}
              placeholder={form.showInMenu ? '' : 'Enable "Show in Menu"'}
            />
            <Input
              label="Route"
              wrapClassName="sm:col-span-2"
              value={form.route}
              onChange={(e) => setForm({ ...form, route: e.target.value })}
              placeholder="e.g. /cpanel/objects"
            />
            <Input
              label="Icon"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="e.g. box"
            />
            <Input
              label="Help"
              value={form.help}
              onChange={(e) => setForm({ ...form, help: e.target.value })}
            />
            <Textarea
              label="Description"
              wrapClassName="sm:col-span-2"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
            <Textarea
              label="Notes"
              wrapClassName="sm:col-span-2"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
                          <span className="font-medium">By:</span> {r.revisedBy}
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
      </Drawer>
    </div>
  );
}
