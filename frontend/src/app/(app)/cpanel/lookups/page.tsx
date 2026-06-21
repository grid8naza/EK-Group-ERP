'use client';

import { useEffect, useState } from 'react';
import { Plus, List, ChevronRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { Lookup, LookupValue } from '@/lib/types';

const ROUTE = '/cpanel/lookups';

const emptyLookup = { code: '', name: '', description: '', isSystem: false };
const emptyValue = {
  value: '',
  label: '',
  extra: '',
  sortOrder: 0,
  isActive: true,
};

export default function LookupsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: lookups, loading, refetch } = useFetch<Lookup[]>('/lookups');
  const [selected, setSelected] = useState<Lookup | null>(null);

  // values for selected lookup
  const [values, setValues] = useState<LookupValue[]>([]);
  const [valuesLoading, setValuesLoading] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  // lookup drawer
  const [lkOpen, setLkOpen] = useState(false);
  const [lkEditing, setLkEditing] = useState<Lookup | null>(null);
  const [lkForm, setLkForm] = useState({ ...emptyLookup });
  const [lkSaving, setLkSaving] = useState(false);

  // value drawer
  const [vOpen, setVOpen] = useState(false);
  const [vEditing, setVEditing] = useState<LookupValue | null>(null);
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

  useEffect(() => {
    if (selected) loadValues(selected);
    else setValues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // ---- Lookup CRUD ----
  const openAddLookup = () => {
    setLkEditing(null);
    setLkForm({ ...emptyLookup });
    setLkOpen(true);
  };
  const openEditLookup = (l: Lookup) => {
    setLkEditing(l);
    setLkForm({
      code: l.code,
      name: l.name,
      description: l.description ?? '',
      isSystem: l.isSystem,
    });
    setLkOpen(true);
  };
  const saveLookup = async (again = false) => {
    if (!lkForm.code.trim() || !lkForm.name.trim()) {
      toast.error('Code and Name are required.');
      return;
    }
    setLkSaving(true);
    try {
      if (lkEditing) {
        await api.patch(`/lookups/${lkEditing.id}`, lkForm);
        toast.success('Lookup updated.');
      } else {
        await api.post('/lookups', lkForm);
        toast.success('Lookup created.');
      }
      await refetch();
      if (again) {
        setLkEditing(null);
        setLkForm({ ...emptyLookup });
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
  const openAddValue = () => {
    setVEditing(null);
    setVForm({ ...emptyValue });
    setVOpen(true);
  };
  const openEditValue = (val: LookupValue) => {
    setVEditing(val);
    setVForm({
      value: val.value,
      label: val.label,
      extra: val.extra ?? '',
      sortOrder: val.sortOrder ?? 0,
      isActive: val.isActive,
    });
    setVOpen(true);
  };
  const saveValue = async (again = false) => {
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
      if (vEditing) {
        await api.patch(`/lookup-values/${vEditing.id}`, payload);
        toast.success('Value updated.');
      } else {
        await api.post(`/lookups/${selected.id}/values`, payload);
        toast.success('Value added.');
      }
      await loadValues(selected);
      if (again) {
        setVEditing(null);
        setVForm({ ...emptyValue });
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
    { key: 'extra', header: 'Extra', accessor: (r) => r.extra },
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
    <div className="mx-auto max-w-7xl">
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
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Lookups
              </h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {loading ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  Loading...
                </p>
              ) : (lookups ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  No lookups yet
                </p>
              ) : (
                (lookups ?? []).map((l) => (
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
          {selected && (canEdit || canDelete) && (
            <div className="mt-3 flex gap-2">
              {canEdit && (
                <button
                  className="btn-secondary"
                  onClick={() => openEditLookup(selected)}
                >
                  Edit Lookup
                </button>
              )}
              {canDelete && !selected.isSystem && (
                <button
                  className="btn-danger"
                  onClick={() => removeLookup(selected)}
                >
                  Delete Lookup
                </button>
              )}
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
                onEdit={openEditValue}
                onDelete={removeValue}
                canEdit={canEdit}
                canDelete={canDelete}
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
        onClose={() => setLkOpen(false)}
        title={lkEditing ? 'Edit Lookup' : 'New Lookup'}
        subtitle="Lookup master"
        icon={<List className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setLkOpen(false)}
            onSave={() => saveLookup(false)}
            onSaveNew={lkEditing ? undefined : () => saveLookup(true)}
            saving={lkSaving}
          />
        }
      >
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
          <Checkbox
            label="System lookup"
            checked={lkForm.isSystem}
            onChange={(e) =>
              setLkForm({ ...lkForm, isSystem: e.target.checked })
            }
          />
        </div>
      </Drawer>

      {/* Value drawer */}
      <Drawer
        open={vOpen}
        onClose={() => setVOpen(false)}
        title={vEditing ? 'Edit Value' : 'New Value'}
        subtitle={selected?.name}
        icon={<List className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setVOpen(false)}
            onSave={() => saveValue(false)}
            onSaveNew={vEditing ? undefined : () => saveValue(true)}
            saving={vSaving}
          />
        }
      >
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
            label="Extra"
            value={vForm.extra}
            onChange={(e) => setVForm({ ...vForm, extra: e.target.value })}
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
      </Drawer>
    </div>
  );
}
