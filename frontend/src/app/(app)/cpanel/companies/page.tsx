'use client';

import { useState, useRef } from 'react';
import {
  Plus,
  Building2,
  Layers,
  Lock,
  GitBranch,
  Pencil,
  Trash2,
  Network,
  Boxes,
} from 'lucide-react';
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
import { mediaUrl } from '@/lib/login-screen';
import { resolveIcon } from '@/lib/icons';
import { Upload, Image as ImageIcon } from 'lucide-react';
import type {
  Company,
  CompanyModule,
  Currency,
  Branch,
  CostCenter,
  CostObject,
} from '@/lib/types';

const ROUTE = '/cpanel/companies';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const empty = {
  code: '',
  name: '',
  shortName: '',
  logo: '',
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
  costObjectApplicable: false,
  branchApplicable: false,
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
  const { can, activeCompanyId, refreshProfile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Company[]>('/companies');
  const { data: currencies } = useFetch<Currency[]>('/currencies');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Company>({
    endpoint: '/companies',
    route: ROUTE,
    noun: 'company',
    nameOf: (c) => c.name,
    reload: refetch,
  });

  // Lock/unlock for branches (inside the Branches drawer).
  const {
    canLock: canLockBranch,
    canUnlock: canUnlockBranch,
    toggleLock: toggleBranchLock,
    guardEdit: guardBranchEdit,
    guardDelete: guardBranchDelete,
  } = useLock<Branch>({
    endpoint: '/branches',
    route: ROUTE,
    noun: 'branch',
    nameOf: (b) => b.name,
    reload: () => {
      if (brCompany) void reloadBranches(brCompany.id);
    },
  });

  // Lock/unlock for cost centers (inside the Cost Centers drawer).
  const {
    canLock: canLockCc,
    canUnlock: canUnlockCc,
    toggleLock: toggleCcLock,
    guardEdit: guardCcEdit,
    guardDelete: guardCcDelete,
  } = useLock<CostCenter>({
    endpoint: '/cost-centers',
    route: ROUTE,
    noun: 'cost center',
    nameOf: (c) => c.name,
    reload: () => {
      if (ccCompany) void reloadCostCenters(ccCompany.id);
    },
  });

  // Lock/unlock for cost objects (inside the Cost Objects drawer).
  const {
    canLock: canLockCo,
    canUnlock: canUnlockCo,
    toggleLock: toggleCoLock,
    guardEdit: guardCoEdit,
    guardDelete: guardCoDelete,
  } = useLock<CostObject>({
    endpoint: '/cost-objects',
    route: ROUTE,
    noun: 'cost object',
    nameOf: (c) => c.name,
    reload: () => {
      if (coCenterId) void reloadCostObjects(Number(coCenterId));
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const uploadCompanyLogo = async (file: File) => {
    setLogoUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<{ url: string }>('/companies/logo', fd);
      setForm((f) => ({ ...f, logo: res.url }));
      toast.success('Logo uploaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Logo upload failed.');
    } finally {
      setLogoUploading(false);
    }
  };

  // ---- Per-company module enablement ----
  const [modOpen, setModOpen] = useState(false);
  const [modCompany, setModCompany] = useState<Company | null>(null);
  const [modules, setModules] = useState<CompanyModule[]>([]);
  const [modEnabled, setModEnabled] = useState<Record<number, boolean>>({});
  const [modLoading, setModLoading] = useState(false);
  const [modSaving, setModSaving] = useState(false);

  // ---- Per-company branches ----
  const branchEmpty = {
    code: '',
    name: '',
    address: '',
    city: '',
    state: '',
    country: '',
    phone: '',
    email: '',
    isActive: true,
  };
  const [brOpen, setBrOpen] = useState(false);
  const [brCompany, setBrCompany] = useState<Company | null>(null);
  const [branchList, setBranchList] = useState<Branch[]>([]);
  const [brLoading, setBrLoading] = useState(false);
  const [brEditing, setBrEditing] = useState<Branch | null>(null);
  const [brFormOpen, setBrFormOpen] = useState(false);
  const [brForm, setBrForm] = useState({ ...branchEmpty });
  const [brSaving, setBrSaving] = useState(false);

  // ---- Per-company cost centers & cost objects ----
  const costEmpty = { code: '', name: '', description: '', isActive: true };
  // Cost centers
  const [ccOpen, setCcOpen] = useState(false);
  const [ccCompany, setCcCompany] = useState<Company | null>(null);
  const [ccList, setCcList] = useState<CostCenter[]>([]);
  const [ccLoading, setCcLoading] = useState(false);
  const [ccEditing, setCcEditing] = useState<CostCenter | null>(null);
  const [ccFormOpen, setCcFormOpen] = useState(false);
  const [ccForm, setCcForm] = useState({ ...costEmpty });
  const [ccSaving, setCcSaving] = useState(false);
  // Cost objects
  const [coOpen, setCoOpen] = useState(false);
  const [coCompany, setCoCompany] = useState<Company | null>(null);
  const [coCenters, setCoCenters] = useState<CostCenter[]>([]); // picker options
  const [coCenterId, setCoCenterId] = useState(''); // selected parent cost center
  const [coList, setCoList] = useState<CostObject[]>([]);
  const [coLoading, setCoLoading] = useState(false);
  const [coEditing, setCoEditing] = useState<CostObject | null>(null);
  const [coFormOpen, setCoFormOpen] = useState(false);
  const [coForm, setCoForm] = useState({ ...costEmpty });
  const [coSaving, setCoSaving] = useState(false);

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
    shortName: c.shortName ?? '',
    logo: c.logo ?? '',
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
    costObjectApplicable: !!c.costObjectApplicable,
    branchApplicable: !!c.branchApplicable,
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

  const save = async (mode: SaveMode = 'saveClose') => {
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
      let saved: Company;
      if (editing) {
        saved = await api.patch<Company>(`/companies/${editing.id}`, payload);
        toast.success('Company updated.');
      } else {
        saved = await api.post<Company>('/companies', payload);
        toast.success('Company created.');
      }
      await refetch();
      // Refresh the auth profile so the sidebar (active company logo / name)
      // reflects any change to the active company.
      void refreshProfile?.();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...empty });
      } else if (mode === 'save') {
        setEditing(saved);
        setForm(formFrom(saved));
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

  // ---- Branches ----
  const openBranches = async (c: Company) => {
    setBrCompany(c);
    setBranchList([]);
    setBrEditing(null);
    setBrFormOpen(false);
    setBrForm({ ...branchEmpty });
    setBrOpen(true);
    void reloadBranches(c.id);
  };

  const reloadBranches = async (companyId: number) => {
    setBrLoading(true);
    try {
      const data = await api.get<Branch[]>(`/branches?companyId=${companyId}`);
      setBranchList(data ?? []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load branches.');
    } finally {
      setBrLoading(false);
    }
  };

  const openBranchAdd = () => {
    setBrEditing(null);
    setBrForm({ ...branchEmpty });
    setBrFormOpen(true);
  };

  const openBranchEdit = (b: Branch) => {
    setBrEditing(b);
    setBrForm({
      code: b.code,
      name: b.name,
      address: b.address ?? '',
      city: b.city ?? '',
      state: b.state ?? '',
      country: b.country ?? '',
      phone: b.phone ?? '',
      email: b.email ?? '',
      isActive: b.isActive,
    });
    setBrFormOpen(true);
  };

  const saveBranch = async () => {
    if (!brCompany) return;
    if (!brForm.code.trim() || !brForm.name.trim()) {
      toast.error('Branch Code and Name are required.');
      return;
    }
    setBrSaving(true);
    try {
      if (brEditing) {
        await api.patch(`/branches/${brEditing.id}`, brForm);
        toast.success('Branch updated.');
      } else {
        await api.post('/branches', { ...brForm, companyId: brCompany.id });
        toast.success('Branch created.');
      }
      setBrFormOpen(false);
      setBrEditing(null);
      await reloadBranches(brCompany.id);
      // Keep the top-bar branch switcher in sync when editing the active company.
      if (brCompany.id === activeCompanyId) await refreshProfile();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save branch.');
    } finally {
      setBrSaving(false);
    }
  };

  const deleteBranch = async (b: Branch) => {
    const ok = await confirm({
      title: 'Delete branch',
      message: `Delete "${b.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/branches/${b.id}`);
      toast.success('Branch deleted.');
      if (brCompany) await reloadBranches(brCompany.id);
      if (brCompany && brCompany.id === activeCompanyId) await refreshProfile();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete branch.');
    }
  };

  // ---- Cost centers ----
  const openCostCenters = (c: Company) => {
    setCcCompany(c);
    setCcList([]);
    setCcEditing(null);
    setCcFormOpen(false);
    setCcForm({ ...costEmpty });
    setCcOpen(true);
    void reloadCostCenters(c.id);
  };
  const reloadCostCenters = async (companyId: number) => {
    setCcLoading(true);
    try {
      const data = await api.get<CostCenter[]>(
        `/cost-centers?companyId=${companyId}`,
      );
      setCcList(data ?? []);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load cost centers.',
      );
    } finally {
      setCcLoading(false);
    }
  };
  const openCcAdd = () => {
    setCcEditing(null);
    setCcForm({ ...costEmpty });
    setCcFormOpen(true);
  };
  const openCcEdit = (c: CostCenter) => {
    setCcEditing(c);
    setCcForm({
      code: c.code,
      name: c.name,
      description: c.description ?? '',
      isActive: c.isActive,
    });
    setCcFormOpen(true);
  };
  const saveCostCenter = async () => {
    if (!ccCompany) return;
    if (!ccForm.code.trim() || !ccForm.name.trim()) {
      toast.error('Cost Center Code and Name are required.');
      return;
    }
    setCcSaving(true);
    try {
      if (ccEditing) {
        await api.patch(`/cost-centers/${ccEditing.id}`, ccForm);
        toast.success('Cost center updated.');
      } else {
        await api.post('/cost-centers', { ...ccForm, companyId: ccCompany.id });
        toast.success('Cost center created.');
      }
      setCcFormOpen(false);
      setCcEditing(null);
      await reloadCostCenters(ccCompany.id);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to save cost center.',
      );
    } finally {
      setCcSaving(false);
    }
  };
  const deleteCostCenter = async (c: CostCenter) => {
    const ok = await confirm({
      title: 'Delete cost center',
      message: `Delete "${c.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/cost-centers/${c.id}`);
      toast.success('Cost center deleted.');
      if (ccCompany) await reloadCostCenters(ccCompany.id);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to delete cost center.',
      );
    }
  };

  // ---- Cost objects ----
  const openCostObjects = async (c: Company) => {
    setCoCompany(c);
    setCoCenters([]);
    setCoCenterId('');
    setCoList([]);
    setCoEditing(null);
    setCoFormOpen(false);
    setCoForm({ ...costEmpty });
    setCoOpen(true);
    try {
      const centers = await api.get<CostCenter[]>(
        `/cost-centers?companyId=${c.id}`,
      );
      setCoCenters(centers ?? []);
      if (centers && centers.length) {
        setCoCenterId(String(centers[0].id));
        void reloadCostObjects(centers[0].id);
      }
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load cost centers.',
      );
    }
  };
  const reloadCostObjects = async (costCenterId: number) => {
    setCoLoading(true);
    try {
      const data = await api.get<CostObject[]>(
        `/cost-objects?costCenterId=${costCenterId}`,
      );
      setCoList(data ?? []);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load cost objects.',
      );
    } finally {
      setCoLoading(false);
    }
  };
  const selectCoCenter = (id: string) => {
    setCoCenterId(id);
    setCoFormOpen(false);
    setCoEditing(null);
    if (id) void reloadCostObjects(Number(id));
    else setCoList([]);
  };
  const openCoAdd = () => {
    if (!coCenterId) {
      toast.error('Select a cost center first.');
      return;
    }
    setCoEditing(null);
    setCoForm({ ...costEmpty });
    setCoFormOpen(true);
  };
  const openCoEdit = (c: CostObject) => {
    setCoEditing(c);
    setCoForm({
      code: c.code,
      name: c.name,
      description: c.description ?? '',
      isActive: c.isActive,
    });
    setCoFormOpen(true);
  };
  const saveCostObject = async () => {
    if (!coCenterId) return;
    if (!coForm.code.trim() || !coForm.name.trim()) {
      toast.error('Cost Object Code and Name are required.');
      return;
    }
    setCoSaving(true);
    try {
      if (coEditing) {
        await api.patch(`/cost-objects/${coEditing.id}`, coForm);
        toast.success('Cost object updated.');
      } else {
        await api.post('/cost-objects', {
          ...coForm,
          costCenterId: Number(coCenterId),
        });
        toast.success('Cost object created.');
      }
      setCoFormOpen(false);
      setCoEditing(null);
      await reloadCostObjects(Number(coCenterId));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to save cost object.',
      );
    } finally {
      setCoSaving(false);
    }
  };
  const deleteCostObject = async (c: CostObject) => {
    const ok = await confirm({
      title: 'Delete cost object',
      message: `Delete "${c.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/cost-objects/${c.id}`);
      toast.success('Cost object deleted.');
      if (coCenterId) await reloadCostObjects(Number(coCenterId));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to delete cost object.',
      );
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
    <div className="mx-auto flex h-full max-w-7xl flex-col">
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
            <>
              <button
                onClick={() => openModules(r)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                title="Modules"
              >
                <Layers className="h-4 w-4" />
              </button>
              {r.branchApplicable && (
                <button
                  onClick={() => openBranches(r)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                  title="Branches"
                >
                  <GitBranch className="h-4 w-4" />
                </button>
              )}
              {r.costCenterApplicable && (
                <button
                  onClick={() => openCostCenters(r)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                  title="Cost Centers"
                >
                  <Network className="h-4 w-4" />
                </button>
              )}
              {r.costObjectApplicable && (
                <button
                  onClick={() => openCostObjects(r)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                  title="Cost Objects"
                >
                  <Boxes className="h-4 w-4" />
                </button>
              )}
            </>
          ) : null
        }
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
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
            label="Short Name"
            value={form.shortName}
            onChange={(e) => setForm({ ...form, shortName: e.target.value })}
            placeholder="Shown in the sidebar (e.g. Regency)"
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
          <div className="sm:col-span-2">
            <label className="label">Logo</label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                {form.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(form.logo)} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => logoInput.current?.click()}
                  disabled={logoUploading}
                >
                  <Upload className="h-4 w-4" />
                  {logoUploading ? 'Uploading…' : 'Upload'}
                </button>
                {form.logo && (
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                    onClick={() => setForm({ ...form, logo: '' })}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                )}
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadCompanyLogo(f);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              PNG, JPG, WEBP, GIF or SVG — up to 5 MB. Shown in the sidebar for this company.
            </p>
          </div>
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
            onChange={(e) => {
              const on = e.target.value === 'yes';
              setForm({
                ...form,
                costCenterApplicable: on,
                // Cost objects require cost centers — turning this off clears it.
                costObjectApplicable: on ? form.costObjectApplicable : false,
              });
            }}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
          <Select
            label="Cost Object Applicable"
            value={form.costObjectApplicable ? 'yes' : 'no'}
            disabled={!form.costCenterApplicable}
            onChange={(e) =>
              setForm({
                ...form,
                costObjectApplicable: e.target.value === 'yes',
              })
            }
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
          <Select
            label="Branch Applicable"
            value={form.branchApplicable ? 'yes' : 'no'}
            onChange={(e) =>
              setForm({ ...form, branchApplicable: e.target.value === 'yes' })
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

      {/* Branches drawer — manage a branch-applicable company's branches */}
      <Drawer
        open={brOpen}
        onClose={() => setBrOpen(false)}
        title={`Branches — ${brCompany?.name ?? ''}`}
        subtitle="Manage this company's branches"
        icon={<GitBranch className="h-5 w-5" />}
        width="lg"
        footer={<CloseFooter onClose={() => setBrOpen(false)} />}
      >
        <div className="space-y-4">
          {/* Add / edit inline form */}
          {brFormOpen ? (
            <div className="card space-y-4 p-4">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {brEditing ? 'Edit Branch' : 'New Branch'}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Code"
                  required
                  value={brForm.code}
                  onChange={(e) =>
                    setBrForm({ ...brForm, code: e.target.value })
                  }
                />
                <Input
                  label="Name"
                  required
                  value={brForm.name}
                  onChange={(e) =>
                    setBrForm({ ...brForm, name: e.target.value })
                  }
                />
                <Textarea
                  label="Address"
                  wrapClassName="sm:col-span-2"
                  value={brForm.address}
                  onChange={(e) =>
                    setBrForm({ ...brForm, address: e.target.value })
                  }
                />
                <Input
                  label="City"
                  value={brForm.city}
                  onChange={(e) =>
                    setBrForm({ ...brForm, city: e.target.value })
                  }
                />
                <Input
                  label="State"
                  value={brForm.state}
                  onChange={(e) =>
                    setBrForm({ ...brForm, state: e.target.value })
                  }
                />
                <Input
                  label="Country"
                  value={brForm.country}
                  onChange={(e) =>
                    setBrForm({ ...brForm, country: e.target.value })
                  }
                />
                <Input
                  label="Phone"
                  value={brForm.phone}
                  onChange={(e) =>
                    setBrForm({ ...brForm, phone: e.target.value })
                  }
                />
                <Input
                  label="Email"
                  type="email"
                  wrapClassName="sm:col-span-2"
                  value={brForm.email}
                  onChange={(e) =>
                    setBrForm({ ...brForm, email: e.target.value })
                  }
                />
                <div className="sm:col-span-2">
                  <Checkbox
                    label="Active"
                    checked={brForm.isActive}
                    onChange={(e) =>
                      setBrForm({ ...brForm, isActive: e.target.checked })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setBrFormOpen(false);
                    setBrEditing(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={saveBranch}
                  disabled={brSaving}
                >
                  {brSaving ? 'Saving...' : brEditing ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-primary" onClick={openBranchAdd}>
              <Plus className="h-4 w-4" /> Add Branch
            </button>
          )}

          {/* Branch list */}
          {brLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Loading branches...
            </p>
          ) : branchList.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No branches yet. Add the first one above.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {branchList.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 py-3"
                >
                  <span className="mt-0.5 text-brand-600">
                    <GitBranch className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
                      {b.name}
                      <span className="text-xs font-normal text-slate-400">
                        {b.code}
                      </span>
                      {!b.isActive && <Badge color="slate">Inactive</Badge>}
                      {b.isLocked && (
                        <Badge color="amber">
                          <Lock className="mr-1 h-3 w-3" /> Locked
                        </Badge>
                      )}
                    </span>
                    {(b.city || b.state) && (
                      <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                        {[b.city, b.state].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => guardBranchEdit(b, () => openBranchEdit(b))}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => guardBranchDelete(b, () => deleteBranch(b))}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <LockButton
                    locked={b.isLocked}
                    canLock={canLockBranch}
                    canUnlock={canUnlockBranch}
                    onToggle={() => toggleBranchLock(b)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>

      {/* Cost Centers drawer */}
      <Drawer
        open={ccOpen}
        onClose={() => setCcOpen(false)}
        title={`Cost Centers — ${ccCompany?.name ?? ''}`}
        subtitle="Manage this company's cost centers"
        icon={<Network className="h-5 w-5" />}
        width="lg"
        footer={<CloseFooter onClose={() => setCcOpen(false)} />}
      >
        <div className="space-y-4">
          {ccFormOpen ? (
            <div className="card space-y-4 p-4">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {ccEditing ? 'Edit Cost Center' : 'New Cost Center'}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Code"
                  required
                  value={ccForm.code}
                  onChange={(e) =>
                    setCcForm({ ...ccForm, code: e.target.value })
                  }
                />
                <Input
                  label="Name"
                  required
                  value={ccForm.name}
                  onChange={(e) =>
                    setCcForm({ ...ccForm, name: e.target.value })
                  }
                />
                <div className="sm:col-span-2">
                  <Checkbox
                    label="Active"
                    checked={ccForm.isActive}
                    onChange={(e) =>
                      setCcForm({ ...ccForm, isActive: e.target.checked })
                    }
                  />
                </div>
                {/* Description — kept at the very bottom of the form. */}
                <Textarea
                  label="Description"
                  wrapClassName="sm:col-span-2"
                  value={ccForm.description}
                  onChange={(e) =>
                    setCcForm({ ...ccForm, description: e.target.value })
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setCcFormOpen(false);
                    setCcEditing(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={saveCostCenter}
                  disabled={ccSaving}
                >
                  {ccSaving ? 'Saving...' : ccEditing ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-primary" onClick={openCcAdd}>
              <Plus className="h-4 w-4" /> Add Cost Center
            </button>
          )}

          {ccLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Loading cost centers...
            </p>
          ) : ccList.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No cost centers yet. Add the first one above.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {ccList.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-3">
                  <span className="text-brand-600">
                    <Network className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
                      {c.name}
                      <span className="text-xs font-normal text-slate-400">
                        {c.code}
                      </span>
                      {!c.isActive && <Badge color="slate">Inactive</Badge>}
                      {c.isLocked && (
                        <Badge color="amber">
                          <Lock className="mr-1 h-3 w-3" /> Locked
                        </Badge>
                      )}
                    </span>
                    {c.description && (
                      <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                        {c.description}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => guardCcEdit(c, () => openCcEdit(c))}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => guardCcDelete(c, () => deleteCostCenter(c))}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <LockButton
                    locked={c.isLocked}
                    canLock={canLockCc}
                    canUnlock={canUnlockCc}
                    onToggle={() => toggleCcLock(c)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>

      {/* Cost Objects drawer */}
      <Drawer
        open={coOpen}
        onClose={() => setCoOpen(false)}
        title={`Cost Objects — ${coCompany?.name ?? ''}`}
        subtitle="Manage cost objects under a cost center"
        icon={<Boxes className="h-5 w-5" />}
        width="lg"
        footer={<CloseFooter onClose={() => setCoOpen(false)} />}
      >
        <div className="space-y-4">
          <Select
            label="Cost Center"
            value={coCenterId}
            onChange={(e) => selectCoCenter(e.target.value)}
            placeholder="Select cost center"
            options={coCenters.map((c) => ({
              value: c.id,
              label: `${c.code} — ${c.name}`,
            }))}
          />

          {coCenters.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No cost centers yet. Add a cost center first (Cost Centers).
            </p>
          ) : !coCenterId ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Select a cost center to manage its cost objects.
            </p>
          ) : (
            <>
              {coFormOpen ? (
                <div className="card space-y-4 p-4">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {coEditing ? 'Edit Cost Object' : 'New Cost Object'}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Code"
                      required
                      value={coForm.code}
                      onChange={(e) =>
                        setCoForm({ ...coForm, code: e.target.value })
                      }
                    />
                    <Input
                      label="Name"
                      required
                      value={coForm.name}
                      onChange={(e) =>
                        setCoForm({ ...coForm, name: e.target.value })
                      }
                    />
                    <div className="sm:col-span-2">
                      <Checkbox
                        label="Active"
                        checked={coForm.isActive}
                        onChange={(e) =>
                          setCoForm({ ...coForm, isActive: e.target.checked })
                        }
                      />
                    </div>
                    {/* Description — kept at the very bottom of the form. */}
                    <Textarea
                      label="Description"
                      wrapClassName="sm:col-span-2"
                      value={coForm.description}
                      onChange={(e) =>
                        setCoForm({ ...coForm, description: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setCoFormOpen(false);
                        setCoEditing(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={saveCostObject}
                      disabled={coSaving}
                    >
                      {coSaving ? 'Saving...' : coEditing ? 'Update' : 'Create'}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn-primary" onClick={openCoAdd}>
                  <Plus className="h-4 w-4" /> Add Cost Object
                </button>
              )}

              {coLoading ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  Loading cost objects...
                </p>
              ) : coList.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No cost objects under this cost center yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {coList.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 py-3">
                      <span className="text-brand-600">
                        <Boxes className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
                          {c.name}
                          <span className="text-xs font-normal text-slate-400">
                            {c.code}
                          </span>
                          {!c.isActive && <Badge color="slate">Inactive</Badge>}
                          {c.isLocked && (
                            <Badge color="amber">
                              <Lock className="mr-1 h-3 w-3" /> Locked
                            </Badge>
                          )}
                        </span>
                        {c.description && (
                          <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                            {c.description}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => guardCoEdit(c, () => openCoEdit(c))}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() =>
                          guardCoDelete(c, () => deleteCostObject(c))
                        }
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <LockButton
                        locked={c.isLocked}
                        canLock={canLockCo}
                        canUnlock={canUnlockCo}
                        onToggle={() => toggleCoLock(c)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}
