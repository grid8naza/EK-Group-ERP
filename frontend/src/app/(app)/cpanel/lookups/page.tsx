'use client';

import { useEffect, useState } from 'react';
import { Plus, List, ChevronRight, Eye } from 'lucide-react';
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
import { Input, Textarea, Checkbox, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { Lookup, LookupValue, Module } from '@/lib/types';

const ROUTE = '/cpanel/lookups';

const emptyLookup = {
  code: '',
  name: '',
  description: '',
  moduleId: '',
  isSystem: false,
};
const emptyValue = {
  value: '',
  label: '',
  alias: '',
  remarks: '',
  sortOrder: 0,
  isActive: true,
};

export default function LookupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: lookups, loading, refetch } = useFetch<Lookup[]>('/lookups');
  const { data: modules } = useFetch<Module[]>('/modules');
  const [selected, setSelected] = useState<Lookup | null>(null);
  // Module filter for the lookup list ('' = all modules).
  const [moduleFilter, setModuleFilter] = useState('');
  const shownLookups = (lookups ?? []).filter(
    (l) => !moduleFilter || String(l.moduleId ?? '') === moduleFilter,
  );

  // values for selected lookup
  const [values, setValues] = useState<LookupValue[]>([]);
  const [valuesLoading, setValuesLoading] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  // lookup drawer
  const [lkOpen, setLkOpen] = useState(false);
  const [lkEditing, setLkEditing] = useState<Lookup | null>(null);
  const [lkView, setLkView] = useState(false); // read-only view (e.g. for locked records)
  const [lkForm, setLkForm] = useState({ ...emptyLookup });
  const [lkSaving, setLkSaving] = useState(false);

  // value drawer
  const [vOpen, setVOpen] = useState(false);
  const [vEditing, setVEditing] = useState<LookupValue | null>(null);
  const [vView, setVView] = useState(false); // read-only view (e.g. for locked records)
  const [vForm, setVForm] = useState({ ...emptyValue });
  const [vSaving, setVSaving] = useState(false);

  const loadValues = async (lookup: Lookup) => {
    setValuesLoading(true);
    try {
      const res = await api.get<LookupValue[]>(`/lookups/${lookup.id}/values`);
      setValues(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load values.');
    } finally {
      setValuesLoading(false);
    }
  };

  const lookupLock = useLock<Lookup>({
    endpoint: '/lookups',
    route: ROUTE,
    noun: 'lookup',
    nameOf: (l) => l.name,
    reload: refetch,
  });
  const valueLock = useLock<LookupValue>({
    endpoint: '/lookup-values',
    route: ROUTE,
    noun: 'lookup value',
    nameOf: (v) => v.label,
    reload: () => {
      if (selected) loadValues(selected);
    },
  });

  useEffect(() => {
    if (selected) loadValues(selected);
    else setValues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // ---- Lookup CRUD ----
  const closeLookupDrawer = () => {
    setLkOpen(false);
    setLkView(false);
  };
  const lookupFormFrom = (l: Lookup) => ({
    code: l.code,
    name: l.name,
    description: l.description ?? '',
    moduleId: l.moduleId != null ? String(l.moduleId) : '',
    isSystem: l.isSystem,
  });
  const openAddLookup = () => {
    setLkEditing(null);
    setLkView(false);
    setLkForm({ ...emptyLookup });
    setLkOpen(true);
  };
  const openEditLookup = (l: Lookup) => {
    setLkEditing(l);
    setLkView(false);
    setLkForm(lookupFormFrom(l));
    setLkOpen(true);
  };
  // Read-only view — works for locked records without unlocking them.
  const openViewLookup = (l: Lookup) => {
    setLkEditing(l);
    setLkView(true);
    setLkForm(lookupFormFrom(l));
    setLkOpen(true);
  };
  const saveLookup = async (mode: SaveMode = 'saveClose') => {
    if (!lkForm.code.trim() || !lkForm.name.trim()) {
      toast.error('Code and Name are required.');
      return;
    }
    setLkSaving(true);
    try {
      const payload = {
        ...lkForm,
        moduleId: lkForm.moduleId ? Number(lkForm.moduleId) : null,
      };
      let saved: Lookup;
      if (lkEditing) {
        saved = await api.patch<Lookup>(`/lookups/${lkEditing.id}`, payload);
        toast.success('Lookup updated.');
      } else {
        saved = await api.post<Lookup>('/lookups', payload);
        toast.success('Lookup created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setLkEditing(null);
        setLkForm({ ...emptyLookup });
      } else if (mode === 'save') {
        setLkEditing(saved);
        setLkForm(lookupFormFrom(saved));
      } else setLkOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setLkSaving(false);
    }
  };
  const removeLookup = async (l: Lookup) => {
    const ok = await confirm({
      title: 'Delete lookup',
      message: `Delete "${l.name}" and all its values?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/lookups/${l.id}`);
      toast.success('Lookup deleted.');
      if (selected?.id === l.id) setSelected(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- Value CRUD ----
  const closeValueDrawer = () => {
    setVOpen(false);
    setVView(false);
  };
  const valueFormFrom = (val: LookupValue) => ({
    value: val.value,
    label: val.label,
    alias: val.alias ?? '',
    remarks: val.remarks ?? '',
    sortOrder: val.sortOrder ?? 0,
    isActive: val.isActive,
  });
  const openAddValue = () => {
    setVEditing(null);
    setVView(false);
    setVForm({ ...emptyValue });
    setVOpen(true);
  };
  const openEditValue = (val: LookupValue) => {
    setVEditing(val);
    setVView(false);
    setVForm(valueFormFrom(val));
    setVOpen(true);
  };
  // Read-only view — works for locked records without unlocking them.
  const openViewValue = (val: LookupValue) => {
    setVEditing(val);
    setVView(true);
    setVForm(valueFormFrom(val));
    setVOpen(true);
  };
  const saveValue = async (mode: SaveMode = 'saveClose') => {
    if (!selected) return;
    if (!vForm.value.trim() || !vForm.label.trim()) {
      toast.error('Value and Label are required.');
      return;
    }
    setVSaving(true);
    try {
      const payload = {
        lookupId: selected.id,
        ...vForm,
        sortOrder: Number(vForm.sortOrder) || 0,
      };
      let saved: LookupValue;
      if (vEditing) {
        saved = await api.patch<LookupValue>(`/lookup-values/${vEditing.id}`, payload);
        toast.success('Value updated.');
      } else {
        saved = await api.post<LookupValue>(`/lookups/${selected.id}/values`, payload);
        toast.success('Value added.');
      }
      await loadValues(selected);
      if (mode === 'saveNew') {
        setVEditing(null);
        setVForm({ ...emptyValue });
      } else if (mode === 'save') {
        setVEditing(saved);
        setVForm(valueFormFrom(saved));
      } else setVOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setVSaving(false);
    }
  };
  const removeValue = async (val: LookupValue) => {
    const ok = await confirm({
      title: 'Delete value',
      message: `Delete value "${val.label}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/lookup-values/${val.id}`);
      toast.success('Value deleted.');
      if (selected) loadValues(selected);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const valueColumns: Column<LookupValue>[] = [
    { key: 'value', header: 'Value', accessor: (r) => r.value },
    {
      key: 'label',
      header: 'Label',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.label}
        </span>
      ),
    },
    { key: 'alias', header: 'Alias', accessor: (r) => r.alias || '-' },
    { key: 'remarks', header: 'Remarks', accessor: (r) => r.remarks || '-' },
    { key: 'sortOrder', header: 'Sort', accessor: (r) => r.sortOrder ?? 0 },
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

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Lookups"
        description="Manage lookup master lists and their values"
        icon={<List className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAddLookup}>
              <Plus className="h-4 w-4" /> Add Lookup
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Master list */}
        <div className="lg:col-span-5">
          {/* No overflow-hidden here so the module dropdown isn't clipped; the
              scroll area below rounds its own bottom corners instead. */}
          <div className="card">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Lookups
              </h2>
              <Select
                wrapClassName="w-44"
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                placeholder="All modules"
                options={(modules ?? []).map((m) => ({
                  value: String(m.id),
                  label: m.name,
                }))}
              />
            </div>
            <div className="max-h-[600px] overflow-y-auto rounded-b-2xl">
              {loading ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  Loading...
                </p>
              ) : shownLookups.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  No lookups yet
                </p>
              ) : (
                shownLookups.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setSelected(l)}
                    className={cn(
                      'flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40',
                      selected?.id === l.id &&
                        'bg-brand-50 dark:bg-brand-950/40',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {l.name}
                        {l.isSystem && <Badge color="violet">System</Badge>}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {l.code}
                        {l.module ? ` · ${l.module.name}` : ''}
                      </p>
                    </div>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 flex-none text-slate-300',
                        selected?.id === l.id && 'text-brand-500',
                      )}
                    />
                  </button>
                ))
              )}
            </div>
          </div>
          {selected &&
            (canView || canEdit || canDelete || lookupLock.canToggle) && (
            <div className="mt-3 flex items-center gap-2">
              {canView && (
                <button
                  onClick={() => openViewLookup(selected)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                  title="View"
                >
                  <Eye className="h-4 w-4" />
                </button>
              )}
              {canEdit && (
                <button
                  className="btn-secondary"
                  onClick={() =>
                    lookupLock.guardEdit(selected, () => openEditLookup(selected))
                  }
                >
                  Edit Lookup
                </button>
              )}
              {canDelete && !selected.isSystem && (
                <button
                  className="btn-danger"
                  onClick={() =>
                    lookupLock.guardDelete(selected, () =>
                      removeLookup(selected),
                    )
                  }
                >
                  Delete Lookup
                </button>
              )}
              <LockButton
                locked={selected.isLocked}
                canLock={lookupLock.canLock}
                canUnlock={lookupLock.canUnlock}
                onToggle={() => lookupLock.toggleLock(selected)}
              />
            </div>
          )}
        </div>

        {/* Values */}
        <div className="lg:col-span-7">
          {selected ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Values — {selected.name}
                </h2>
                {canAdd && (
                  <button className="btn-primary" onClick={openAddValue}>
                    <Plus className="h-4 w-4" /> Add Value
                  </button>
                )}
              </div>
              <DataTable
                columns={valueColumns}
                rows={values}
                rowKey={(r) => r.id}
                loading={valuesLoading}
                searchPlaceholder="Search values..."
                onView={openViewValue}
                onEdit={(r) => valueLock.guardEdit(r, () => openEditValue(r))}
                onDelete={(r) =>
                  valueLock.guardDelete(r, () => removeValue(r))
                }
                canView={canView}
                canEdit={canEdit}
                canDelete={canDelete}
                renderLock={(r) => (
                  <LockButton
                    locked={r.isLocked}
                    canLock={valueLock.canLock}
                    canUnlock={valueLock.canUnlock}
                    onToggle={() => valueLock.toggleLock(r)}
                  />
                )}
                pageSize={8}
                emptyMessage="No values for this lookup"
              />
            </>
          ) : (
            <div className="card flex h-full min-h-[300px] items-center justify-center p-10 text-center text-sm text-slate-400">
              Select a lookup to view and manage its values
            </div>
          )}
        </div>
      </div>

      {/* Lookup drawer */}
      <Drawer
        open={lkOpen}
        onClose={closeLookupDrawer}
        title={lkView ? 'View Lookup' : lkEditing ? 'Edit Lookup' : 'New Lookup'}
        subtitle="Lookup master"
        icon={<List className="h-5 w-5" />}
        footer={
          lkView ? (
            <CloseFooter onClose={closeLookupDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeLookupDrawer}
              onSave={saveLookup}
              saving={lkSaving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={lkView}>
          <div className="space-y-4">
            <Input
              label="Code"
              required
              value={lkForm.code}
              onChange={(e) => setLkForm({ ...lkForm, code: e.target.value })}
            />
            <Input
              label="Name"
              required
              value={lkForm.name}
              onChange={(e) => setLkForm({ ...lkForm, name: e.target.value })}
            />
            <Textarea
              label="Description"
              value={lkForm.description}
              onChange={(e) =>
                setLkForm({ ...lkForm, description: e.target.value })
              }
            />
            <Select
              label="Module"
              value={lkForm.moduleId}
              onChange={(e) =>
                setLkForm({ ...lkForm, moduleId: e.target.value })
              }
              placeholder="— Global (all modules) —"
              options={(modules ?? []).map((m) => ({
                value: m.id,
                label: m.name,
              }))}
            />
            <Checkbox
              label="System lookup"
              checked={lkForm.isSystem}
              onChange={(e) =>
                setLkForm({ ...lkForm, isSystem: e.target.checked })
              }
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>

      {/* Value drawer */}
      <Drawer
        open={vOpen}
        onClose={closeValueDrawer}
        title={vView ? 'View Value' : vEditing ? 'Edit Value' : 'New Value'}
        subtitle={selected?.name}
        icon={<List className="h-5 w-5" />}
        footer={
          vView ? (
            <CloseFooter onClose={closeValueDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeValueDrawer}
              onSave={saveValue}
              saving={vSaving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={vView}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Value"
              required
              value={vForm.value}
              onChange={(e) => setVForm({ ...vForm, value: e.target.value })}
            />
            <Input
              label="Label"
              required
              value={vForm.label}
              onChange={(e) => setVForm({ ...vForm, label: e.target.value })}
            />
            <Input
              label="Alias"
              value={vForm.alias}
              onChange={(e) => setVForm({ ...vForm, alias: e.target.value })}
              placeholder="Custom name (optional)"
            />
            <Input
              label="Remarks"
              value={vForm.remarks}
              onChange={(e) => setVForm({ ...vForm, remarks: e.target.value })}
            />
            <Input
              label="Sort Order"
              type="number"
              value={vForm.sortOrder}
              onChange={(e) =>
                setVForm({ ...vForm, sortOrder: Number(e.target.value) })
              }
            />
            <div className="sm:col-span-2">
              <Checkbox
                label="Active"
                checked={vForm.isActive}
                onChange={(e) =>
                  setVForm({ ...vForm, isActive: e.target.checked })
                }
              />
            </div>
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
