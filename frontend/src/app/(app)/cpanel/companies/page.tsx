'use client';

import { useState } from 'react';
import { Plus, Building2, Layers, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Textarea, Checkbox, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { resolveIcon } from '@/lib/icons';
import type { Company, CompanyModule, Currency } from '@/lib/types';

const ROUTE = '/cpanel/companies';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const empty = {
  code: '',
  name: '',
  legalName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  country: '',
  // Financial / statutory (kept as strings for the form controls).
  financialYearStartMonth: '',
  financialYearEndMonth: '',
  booksStartDate: '',
  costCenterApplicable: false,
  currencyId: '',
  cin: '',
  gstin: '',
  pan: '',
  tan: '',
  ptrn: '',
  ptec: '',
  isActive: true,
};

export default function CompaniesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Company[]>('/companies');
  const { data: currencies } = useFetch<Currency[]>('/currencies');
  const { canToggle, toggleLock, guardEdit, guardDelete } = useLock<Company>({
    endpoint: '/companies',
    noun: 'company',
    nameOf: (c) => c.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  // ---- Per-company module enablement ----
  const [modOpen, setModOpen] = useState(false);
  const [modCompany, setModCompany] = useState<Company | null>(null);
  const [modules, setModules] = useState<CompanyModule[]>([]);
  const [modEnabled, setModEnabled] = useState<Record<number, boolean>>({});
  const [modLoading, setModLoading] = useState(false);
  const [modSaving, setModSaving] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (c: Company) => ({
    code: c.code,
    name: c.name,
    legalName: c.legalName ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    country: c.country ?? '',
    financialYearStartMonth:
      c.financialYearStartMonth != null ? String(c.financialYearStartMonth) : '',
    financialYearEndMonth:
      c.financialYearEndMonth != null ? String(c.financialYearEndMonth) : '',
    booksStartDate: c.booksStartDate ? c.booksStartDate.slice(0, 10) : '',
    costCenterApplicable: !!c.costCenterApplicable,
    currencyId: c.currencyId != null ? String(c.currencyId) : '',
    cin: c.cin ?? '',
    gstin: c.gstin ?? '',
    pan: c.pan ?? '',
    tan: c.tan ?? '',
    ptrn: c.ptrn ?? '',
    ptec: c.ptec ?? '',
    isActive: c.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (c: Company) => {
    setEditing(c);
    setView(false);
    setForm(formFrom(c));
    setOpen(true);
  };

  // Read-only view — works for locked records without unlocking them.
  const openView = (c: Company) => {
    setEditing(c);
    setView(true);
    setForm(formFrom(c));
    setOpen(true);
  };

  const save = async (again = false) => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and Name are required.');
      return;
    }
    setSaving(true);
    // Numbers/dates come from form controls as strings; send numbers (or omit
    // when blank) so the API's validators are happy.
    const payload = {
      ...form,
      financialYearStartMonth: form.financialYearStartMonth
        ? Number(form.financialYearStartMonth)
        : undefined,
      financialYearEndMonth: form.financialYearEndMonth
        ? Number(form.financialYearEndMonth)
        : undefined,
      currencyId: form.currencyId ? Number(form.currencyId) : undefined,
      booksStartDate: form.booksStartDate || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/companies/${editing.id}`, payload);
        toast.success('Company updated.');
      } else {
        await api.post('/companies', payload);
        toast.success('Company created.');
      }
      await refetch();
      if (again) {
        setEditing(null);
        setForm({ ...empty });
      } else {
        setOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Company) => {
    const ok = await confirm({
      title: 'Delete company',
      message: `Delete "${c.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/companies/${c.id}`);
      toast.success('Company deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const openModules = async (c: Company) => {
    setModCompany(c);
    setModules([]);
    setModEnabled({});
    setModOpen(true);
    setModLoading(true);
    try {
      const data = await api.get<CompanyModule[]>(`/companies/${c.id}/modules`);
      setModules(data);
      const map: Record<number, boolean> = {};
      for (const m of data) map[m.id] = m.isCore || m.enabled;
      setModEnabled(map);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load modules.');
    } finally {
      setModLoading(false);
    }
  };

  const toggleModule = (m: CompanyModule, checked: boolean) => {
    if (m.isCore) return; // core modules are always enabled
    setModEnabled((prev) => ({ ...prev, [m.id]: checked }));
  };

  const saveModules = async () => {
    if (!modCompany) return;
    setModSaving(true);
    try {
      const moduleIds = modules
        .filter((m) => m.isCore || modEnabled[m.id])
        .map((m) => m.id);
      await api.put(`/companies/${modCompany.id}/modules`, { moduleIds });
      toast.success('Modules updated.');
      setModOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save modules.');
    } finally {
      setModSaving(false);
    }
  };

  const columns: Column<Company>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'email', header: 'Email', accessor: (r) => r.email },
    { key: 'phone', header: 'Phone', accessor: (r) => r.phone },
    { key: 'city', header: 'City', accessor: (r) => r.city },
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
        title="Company Master"
        description="Manage companies and their details"
        icon={<Building2 className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={refetch}
        searchPlaceholder="Search companies..."
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        rowActions={(r) =>
          canEdit ? (
            <button
              onClick={() => openModules(r)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
              title="Modules"
            >
              <Layers className="h-4 w-4" />
            </button>
          ) : null
        }
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canToggle={canToggle}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No companies found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View Company' : editing ? 'Edit Company' : 'New Company'}
        subtitle={view ? 'Read-only — locked or view mode' : 'Company details'}
        icon={<Building2 className="h-5 w-5" />}
        width="lg"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={() => save(false)}
              onSaveNew={editing ? undefined : () => save(true)}
              saving={saving}
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Code"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Legal Name"
            wrapClassName="sm:col-span-2"
            value={form.legalName}
            onChange={(e) => setForm({ ...form, legalName: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Textarea
            label="Address"
            wrapClassName="sm:col-span-2"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <Input
            label="City"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <Input
            label="State"
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
          />
          <Input
            label="Country"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
          <div className="mt-1 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:col-span-2">
            Financial &amp; statutory
          </div>
          <Select
            label="Currency"
            placeholder="Select currency"
            value={form.currencyId}
            onChange={(e) => setForm({ ...form, currencyId: e.target.value })}
            options={(currencies ?? []).map((c) => ({
              value: c.id,
              label: `${c.code} — ${c.name} (${c.symbol})`,
            }))}
          />
          <Select
            label="Financial Year Start Month"
            placeholder="Select month"
            value={form.financialYearStartMonth}
            onChange={(e) =>
              setForm({ ...form, financialYearStartMonth: e.target.value })
            }
            options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
          />
          <Select
            label="Financial Year End Month"
            placeholder="Select month"
            value={form.financialYearEndMonth}
            onChange={(e) =>
              setForm({ ...form, financialYearEndMonth: e.target.value })
            }
            options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
          />
          <Input
            label="Books of Accounts Start From"
            type="date"
            value={form.booksStartDate}
            onChange={(e) =>
              setForm({ ...form, booksStartDate: e.target.value })
            }
          />
          <Select
            label="Cost Center Applicable"
            value={form.costCenterApplicable ? 'yes' : 'no'}
            onChange={(e) =>
              setForm({
                ...form,
                costCenterApplicable: e.target.value === 'yes',
              })
            }
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
          <Input
            label="CIN"
            labelTitle="Corporate Identification Number"
            maxLength={21}
            value={form.cin}
            onChange={(e) =>
              setForm({ ...form, cin: e.target.value.toUpperCase() })
            }
          />
          <Input
            label="GSTIN"
            maxLength={15}
            value={form.gstin}
            onChange={(e) =>
              setForm({ ...form, gstin: e.target.value.toUpperCase() })
            }
          />
          <Input
            label="PAN"
            maxLength={12}
            value={form.pan}
            onChange={(e) =>
              setForm({ ...form, pan: e.target.value.toUpperCase() })
            }
          />
          <Input
            label="TAN"
            maxLength={10}
            value={form.tan}
            onChange={(e) =>
              setForm({ ...form, tan: e.target.value.toUpperCase() })
            }
          />
          <Input
            label="PTRN"
            maxLength={12}
            value={form.ptrn}
            onChange={(e) =>
              setForm({ ...form, ptrn: e.target.value.toUpperCase() })
            }
          />
          <Input
            label="PTEC"
            maxLength={12}
            value={form.ptec}
            onChange={(e) =>
              setForm({ ...form, ptec: e.target.value.toUpperCase() })
            }
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

      <Drawer
        open={modOpen}
        onClose={() => setModOpen(false)}
        title={`Modules — ${modCompany?.name ?? ''}`}
        subtitle="Select the modules enabled for this company"
        icon={<Layers className="h-5 w-5" />}
        width="lg"
        footer={
          <DrawerFooter
            onCancel={() => setModOpen(false)}
            onSave={saveModules}
            saving={modSaving}
          />
        }
      >
        {modLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Loading modules...
          </p>
        ) : modules.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No modules available.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {modules.map((m) => {
              const Icon = resolveIcon(m.icon);
              const checked = m.isCore || !!modEnabled[m.id];
              return (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-start gap-3 py-3"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={m.isCore}
                    onChange={(e) => toggleModule(m, e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
                  />
                  <span className="mt-0.5 text-brand-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
                      {m.name}
                      {m.isCore && (
                        <Badge color="violet">
                          <Lock className="mr-1 h-3 w-3" /> Core
                        </Badge>
                      )}
                    </span>
                    {m.description && (
                      <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                        {m.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </Drawer>
    </div>
  );
}
