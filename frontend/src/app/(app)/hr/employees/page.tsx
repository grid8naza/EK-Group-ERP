'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  UserCog,
  Upload,
  Trash2,
  Phone,
  Mail,
  User as UserIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { mediaUrl } from '@/lib/login-screen';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { StatusToggle } from '@/components/ui/StatusToggle';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import {
  Input,
  Select,
  Checkbox,
  Textarea,
  DateInput,
} from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  Employee,
  HrCategory,
  HrGroup,
  HrDesignation,
  Company,
  Branch,
  CostCenter,
  CostObject,
} from '@/lib/types';

const ROUTE = '/hr/employees';

const SEXES = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];

const MARITAL_STATUSES = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'DIVORCED', label: 'Divorced' },
  { value: 'WIDOWED', label: 'Widowed' },
];

const empty = {
  name: '',
  dateOfBirth: '',
  sex: '',
  maritalStatus: '',
  aadhaarNumber: '',
  address: '',
  phone: '',
  email: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  photoUrl: '',

  companyId: '',
  branchId: '',
  // Division and department come from the COMPANY master: a division is a cost
  // centre, a department the cost object under it.
  costCenterId: '',
  costObjectId: '',
  // Category and group are FORM-ONLY: they narrow the designation list and are
  // never sent, because the designation already knows both.
  categoryId: '',
  groupId: '',
  designationId: '',
  dateOfJoin: '',
  reportsToId: '',
  isActive: true,
};

type Form = typeof empty;

export default function EmployeesPage() {
  const { can, activeCompanyId, activeBranchId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data, loading, refetch } = useFetch<Employee[]>('/hr-employees');
  const { data: categories } = useFetch<HrCategory[]>('/hr-categories');
  const { data: groups } = useFetch<HrGroup[]>('/hr-groups');
  const { data: designations } = useFetch<HrDesignation[]>('/hr-designations');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  // Every company's divisions and departments in one call each — the form can
  // move an employee to another company, so it needs more than the active one.
  const { data: costCenters } = useFetch<CostCenter[]>('/cost-centers');
  const { data: costObjects } = useFetch<CostObject[]>('/cost-objects');

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<Employee>({
      endpoint: '/hr-employees',
      route: ROUTE,
      noun: 'employee',
      nameOf: (e) => e.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState<Form>({ ...empty });
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // List filters.
  const [divisionFilter, setDivisionFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const branchesOf = (companyId: string) =>
    (branches ?? []).filter(
      (b) => b.isActive && String(b.companyId) === companyId,
    );

  // Division → Department, both belonging to the chosen company. A department
  // under another company's division is the one mistake two loose dropdowns
  // make, so the second list is always cut to the first.
  const divisionsOf = (companyId: string) =>
    (costCenters ?? []).filter(
      (c) => c.isActive && String(c.companyId) === companyId,
    );
  const departmentsOf = (companyId: string, costCenterId: string) =>
    (costObjects ?? []).filter(
      (o) =>
        o.isActive &&
        String(o.companyId) === companyId &&
        (!costCenterId || String(o.costCenterId) === costCenterId),
    );

  // ---- the classification cascade -------------------------------------
  // Category narrows Group, Group narrows Designation. Only the designation is
  // saved; the two above it exist so a person can FIND it in a list that would
  // otherwise be every designation in the group.
  const groupOptions = useMemo(
    () =>
      (groups ?? []).filter(
        (g) =>
          !g.subGroupApplicable &&
          g.isActive &&
          (!form.categoryId || String(g.categoryId) === form.categoryId),
      ),
    [groups, form.categoryId],
  );

  const designationOptions = useMemo(
    () =>
      (designations ?? []).filter(
        (d) =>
          d.isActive &&
          (!form.categoryId || String(d.categoryId) === form.categoryId) &&
          (!form.groupId || String(d.groupId) === form.groupId),
      ),
    [designations, form.categoryId, form.groupId],
  );

  /**
   * Who this person can report to: anybody already on the books at the same
   * company, minus themselves. Same-company because a line of report that
   * crosses companies answers to a payroll it is not on — the server enforces
   * it too, so a stale list cannot slip one through.
   */
  const managerOptions = useMemo(
    () =>
      (data ?? []).filter(
        (e) =>
          String(e.companyId) === form.companyId && e.id !== (editing?.id ?? 0),
      ),
    [data, form.companyId, editing],
  );

  /** The chosen designation's name, for the header beside the photograph. */
  const designationName = (id: string) =>
    (designations ?? []).find((d) => String(d.id) === id)?.name ?? '';

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (e: Employee): Form => ({
    name: e.name,
    dateOfBirth: e.dateOfBirth ?? '',
    sex: e.sex ?? '',
    maritalStatus: e.maritalStatus ?? '',
    aadhaarNumber: e.aadhaarNumber ?? '',
    address: e.address ?? '',
    phone: e.phone ?? '',
    email: e.email ?? '',
    emergencyContactName: e.emergencyContactName ?? '',
    emergencyContactPhone: e.emergencyContactPhone ?? '',
    photoUrl: e.photoUrl,

    companyId: String(e.companyId),
    branchId: e.branchId != null ? String(e.branchId) : '',
    costCenterId: e.costCenterId != null ? String(e.costCenterId) : '',
    costObjectId: e.costObjectId != null ? String(e.costObjectId) : '',
    categoryId: String(e.categoryId),
    groupId: String(e.groupId),
    designationId: String(e.designationId),
    dateOfJoin: e.dateOfJoin,
    reportsToId: e.reportsToId != null ? String(e.reportsToId) : '',
    isActive: e.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    // Start where the user is working — they can move it on the form.
    setForm({
      ...empty,
      companyId: activeCompanyId ? String(activeCompanyId) : '',
      branchId: activeBranchId ? String(activeBranchId) : '',
    });
    setOpen(true);
  };
  const openEdit = (e: Employee) => {
    setEditing(e);
    setView(false);
    setForm(formFrom(e));
    setOpen(true);
  };
  const openView = (e: Employee) => {
    setEditing(e);
    setView(true);
    setForm(formFrom(e));
    setOpen(true);
  };

  // Alt+A opens the New form (when allowed and no drawer is open).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.altKey && ev.key.toLowerCase() === 'a' && canAdd && !open) {
        ev.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdd, open]);

  const uploadPhoto = async (file: File) => {
    setPhotoUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<{ url: string }>('/hr-employees/photo', fd);
      setForm((f) => ({ ...f, photoUrl: res.url }));
      toast.success('Photograph uploaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Photo upload failed.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Employee Name is required.');
      return;
    }
    if (!form.companyId) {
      toast.error('Choose the company this employee belongs to.');
      return;
    }
    if (!form.designationId) {
      toast.error('Choose a designation.');
      return;
    }
    if (!form.dateOfJoin) {
      toast.error('Enter the date of joining.');
      return;
    }
    if (!form.photoUrl) {
      toast.error('A photograph is required — upload one before saving.');
      return;
    }
    if (form.aadhaarNumber && !/^\d{12}$/.test(form.aadhaarNumber)) {
      toast.error('An Aadhaar number is 12 digits.');
      return;
    }

    const idOrNull = (s: string) => (s ? Number(s) : null);
    const payload = {
      // Code, category and group are all derived server-side.
      name: form.name.trim(),
      dateOfBirth: form.dateOfBirth || null,
      sex: form.sex || null,
      maritalStatus: form.maritalStatus || null,
      aadhaarNumber: form.aadhaarNumber.trim() || null,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      emergencyContactName: form.emergencyContactName.trim() || null,
      emergencyContactPhone: form.emergencyContactPhone.trim() || null,
      photoUrl: form.photoUrl,

      companyId: Number(form.companyId),
      branchId: idOrNull(form.branchId),
      costCenterId: idOrNull(form.costCenterId),
      costObjectId: idOrNull(form.costObjectId),
      designationId: Number(form.designationId),
      dateOfJoin: form.dateOfJoin,
      reportsToId: idOrNull(form.reportsToId),
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: Employee;
      if (editing) {
        saved = await api.patch<Employee>(
          `/hr-employees/${editing.id}`,
          payload,
        );
        toast.success('Employee updated.');
      } else {
        saved = await api.post<Employee>('/hr-employees', payload);
        toast.success(`Employee created — ${saved.code}.`);
      }
      await refetch();
      if (mode === 'saveNew') {
        // Fast entry: keep the posting (company, branch, department,
        // designation), clear the person. The photograph MUST be cleared —
        // carrying the last one over is how the wrong face ends up on a record.
        setEditing(null);
        setForm((f) => ({
          ...f,
          name: '',
          dateOfBirth: '',
          sex: '',
          maritalStatus: '',
          aadhaarNumber: '',
          address: '',
          phone: '',
          email: '',
          emergencyContactName: '',
          emergencyContactPhone: '',
          photoUrl: '',
        }));
        setTimeout(() => nameRef.current?.focus(), 0);
      } else if (mode === 'save') {
        setEditing(saved);
        setForm(formFrom(saved));
      } else {
        closeDrawer();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: Employee) => {
    const ok = await confirm({
      title: 'Delete employee',
      message: `Delete "${e.name}" (${e.code})?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/hr-employees/${e.id}`);
      toast.success('Employee deleted.');
      refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete.');
    }
  };

  // Somebody who has left is set inactive, not deleted — the record is what
  // their service is proved from.
  const toggleActive = (e: Employee) =>
    guardEdit(e, async () => {
      try {
        await api.patch(`/hr-employees/${e.id}`, { isActive: !e.isActive });
        toast.success(
          e.isActive ? 'Employee set inactive.' : 'Employee set active.',
        );
        refetch();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Failed to update.',
        );
      }
    });

  const branchNameById = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b.name])),
    [branches],
  );

  const visibleRows = useMemo(() => {
    let rows = [...(data ?? [])];
    if (divisionFilter)
      rows = rows.filter(
        (r) => String(r.costCenterId ?? '') === divisionFilter,
      );
    if (deptFilter)
      rows = rows.filter((r) => String(r.costObjectId ?? '') === deptFilter);
    if (designationFilter)
      rows = rows.filter((r) => String(r.designationId) === designationFilter);
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows;
  }, [data, divisionFilter, deptFilter, designationFilter, status]);

  const columns: Column<Employee>[] = [
    {
      key: 'photo',
      header: '',
      sortable: false,
      className: 'w-12',
      render: (r) => (
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          {r.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(r.photoUrl)}
              alt={r.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <UserIcon className="h-4 w-4 text-slate-300" />
          )}
        </div>
      ),
    },
    { key: 'code', header: 'Employee ID', accessor: (r) => r.code },
    {
      key: 'name',
      header: 'Employee Name',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'division',
      header: 'Division',
      accessor: (r) => r.divisionName ?? '-',
    },
    {
      key: 'department',
      header: 'Department',
      accessor: (r) => r.departmentName ?? '-',
    },
    {
      key: 'designation',
      header: 'Designation',
      accessor: (r) => r.designationName,
    },
    {
      key: 'branch',
      header: 'Branch',
      accessor: (r) =>
        r.branchId
          ? (branchNameById.get(r.branchId) ?? `#${r.branchId}`)
          : 'All',
    },
    { key: 'phone', header: 'Contact', accessor: (r) => r.phone ?? '-' },
    {
      key: 'dateOfJoin',
      header: 'Joined',
      accessor: (r) => r.dateOfJoin.split('-').reverse().join('-'),
      sortAccessor: (r) => r.dateOfJoin,
    },
    {
      key: 'isActive',
      header: 'Status',
      sortAccessor: (r) => (r.isActive ? 'Active' : 'Inactive'),
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const title = view
    ? 'View Employee'
    : editing
      ? 'Edit Employee'
      : 'New Employee';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Employee Master"
        description="The people on the payroll — including staff who have no user login"
        icon={<UserCog className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
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
        rows={visibleRows}
        defaultSort={{ key: 'code', dir: 'asc' }}
        key={`${divisionFilter}|${deptFilter}|${designationFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search employees..."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {/* The filters follow the company being worked in, since the list
                does — see findAll. */}
            <Select
              value={divisionFilter}
              onChange={(e) => {
                setDivisionFilter(e.target.value);
                setDeptFilter(''); // its departments no longer apply
              }}
              wrapClassName="w-40"
              placeholder="All divisions"
              options={divisionsOf(String(activeCompanyId ?? '')).map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
            <Select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              wrapClassName="w-44"
              placeholder="All departments"
              options={departmentsOf(
                String(activeCompanyId ?? ''),
                divisionFilter,
              ).map((o) => ({ value: String(o.id), label: o.name }))}
            />
            <Select
              value={designationFilter}
              onChange={(e) => setDesignationFilter(e.target.value)}
              wrapClassName="w-48"
              placeholder="All designations"
              options={(designations ?? []).map((d) => ({
                value: String(d.id),
                label: d.name,
              }))}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapClassName="w-40"
              placeholder="All statuses"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
        }
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        rowActions={(r) => (
          <StatusToggle
            active={r.isActive}
            canEdit={canEdit}
            onToggle={() => toggleActive(r)}
          />
        )}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No employees found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Employee details"
        icon={<UserCog className="h-5 w-5" />}
        width="xl"
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
            {/* ---- the photograph, first: it is what identifies the record ---- */}
            <div className="sm:col-span-2">
              <label className="label">
                Photograph <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-4">
                <div className="flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  {form.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(form.photoUrl)}
                      alt="Photograph"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <UserIcon className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {/*
                    Who this record is, beside their face — the two facts that
                    identify a person at a glance. Read from the FORM, not the
                    saved row, so it names whoever is being typed in rather than
                    lagging a field behind.
                  */}
                  <p className="truncate text-xl font-bold leading-tight text-brand-700 dark:text-brand-300">
                    {form.name.trim() || 'New employee'}
                  </p>
                  <p className="truncate text-base font-semibold text-amber-600 dark:text-amber-400">
                    {designationName(form.designationId) ||
                      'No designation yet'}
                  </p>
                  {editing && (
                    <p className="mt-0.5 font-mono text-sm text-slate-400">
                      {editing.code}
                    </p>
                  )}
                  {/* How to reach them — the other thing anybody opens this
                      record for. Hidden until there is something to show. */}
                  {(form.phone.trim() || form.email.trim()) && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                      {form.phone.trim() && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 flex-none" />
                          {form.phone.trim()}
                        </span>
                      )}
                      {form.email.trim() && (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 flex-none" />
                          <span className="truncate">{form.email.trim()}</span>
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* The controls sit at the far edge, away from the identity. */}
                <div className="flex flex-none flex-col items-end gap-1">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      className="btn-secondary inline-flex items-center gap-2"
                      onClick={() => photoInput.current?.click()}
                      disabled={photoUploading}
                    >
                      <Upload className="h-4 w-4" />
                      {photoUploading
                        ? 'Uploading…'
                        : form.photoUrl
                          ? 'Replace'
                          : 'Upload'}
                    </button>
                    {form.photoUrl && (
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                        onClick={() => setForm({ ...form, photoUrl: '' })}
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </button>
                    )}
                    <input
                      ref={photoInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadPhoto(f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-400">
                    PNG, JPG or WEBP — up to 5 MB.
                  </span>
                </div>
              </div>
            </div>

            {/* ---- the person ---- */}
            <div className="mt-1 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:col-span-2">
              Personal
            </div>

            <Input
              label="Employee ID (auto)"
              value={editing ? editing.code : 'Generated on save'}
              disabled
            />
            <Input
              ref={nameRef}
              label="Employee Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name as on record"
            />
            <DateInput
              label="Date of Birth"
              value={form.dateOfBirth}
              onChange={(iso) => setForm({ ...form, dateOfBirth: iso })}
            />
            <Select
              label="Sex"
              value={form.sex}
              onChange={(e) => setForm({ ...form, sex: e.target.value })}
              placeholder="— Not stated —"
              sortOptions={false}
              options={SEXES}
            />
            <Select
              label="Marital Status"
              value={form.maritalStatus}
              onChange={(e) =>
                setForm({ ...form, maritalStatus: e.target.value })
              }
              placeholder="— Not stated —"
              sortOptions={false}
              options={MARITAL_STATUSES}
            />
            <Input
              label="Aadhaar Number"
              value={form.aadhaarNumber}
              onChange={(e) =>
                setForm({
                  ...form,
                  // Digits only, 12 of them — typed spaces are the usual reason
                  // an otherwise valid number is rejected.
                  aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12),
                })
              }
              placeholder="12 digits"
            />
            <Textarea
              label="Address"
              wrapClassName="sm:col-span-2"
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <Input
              label="Contact Number"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="Contact Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="Emergency Contact Person"
              value={form.emergencyContactName}
              onChange={(e) =>
                setForm({ ...form, emergencyContactName: e.target.value })
              }
            />
            <Input
              label="Emergency Contact Number"
              value={form.emergencyContactPhone}
              onChange={(e) =>
                setForm({ ...form, emergencyContactPhone: e.target.value })
              }
            />

            {/* ---- the job ---- */}
            <div className="mt-1 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:col-span-2">
              Posting
            </div>

            {/*
              Company and branch are chosen HERE rather than taken from the
              topbar: HR set up the whole group's staff, and making them switch
              company to add somebody at another branch is a step that exists
              only because of where the data lives.
            */}
            <Select
              label="Company"
              required
              value={form.companyId}
              onChange={(e) =>
                // Branch, division, department and manager all belong to one
                // company — every one of them is cleared when it moves.
                setForm({
                  ...form,
                  companyId: e.target.value,
                  branchId: '',
                  costCenterId: '',
                  costObjectId: '',
                  reportsToId: '',
                })
              }
              placeholder="Select company"
              options={companyList
                .filter((c) => c.isActive)
                .map((c) => ({ value: String(c.id), label: c.name }))}
            />
            <Select
              label="Branch"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              placeholder={
                form.companyId ? 'Whole company' : 'Pick a company first'
              }
              options={branchesOf(form.companyId).map((b) => ({
                value: String(b.id),
                label: b.name,
              }))}
            />
            {/*
              Division and department come from the company master — a division
              is a cost centre, a department the cost object under it. Not a
              list of their own: the company already carries this structure and
              the ledger already posts against it, so naming departments twice
              would let an employee sit under one "Packing" while their cost
              goes to another.
            */}
            <Select
              label="Division"
              value={form.costCenterId}
              onChange={(e) =>
                // The departments under the old division no longer apply.
                setForm({
                  ...form,
                  costCenterId: e.target.value,
                  costObjectId: '',
                })
              }
              placeholder={
                form.companyId
                  ? divisionsOf(form.companyId).length
                    ? '— None —'
                    : 'No divisions set up for this company'
                  : 'Pick a company first'
              }
              options={divisionsOf(form.companyId).map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
            />
            <Select
              label="Department"
              value={form.costObjectId}
              onChange={(e) =>
                setForm({ ...form, costObjectId: e.target.value })
              }
              placeholder={
                form.costCenterId ? '— None —' : 'Pick a division first'
              }
              options={departmentsOf(form.companyId, form.costCenterId).map(
                (o) => ({ value: String(o.id), label: o.name }),
              )}
            />
            <DateInput
              label="Date of Join"
              required
              value={form.dateOfJoin}
              onChange={(iso) => setForm({ ...form, dateOfJoin: iso })}
            />

            {/*
              Category → Group → Designation. Only the designation is stored:
              it already knows the other two, and a stored copy would go stale
              the day a designation is moved to another group.
            */}
            <Select
              label="Category"
              value={form.categoryId}
              onChange={(e) =>
                setForm({
                  ...form,
                  categoryId: e.target.value,
                  groupId: '',
                  designationId: '',
                })
              }
              placeholder="All categories"
              options={(categories ?? [])
                .filter((c) => c.isActive)
                .map((c) => ({ value: String(c.id), label: c.name }))}
            />
            <Select
              label="Group"
              value={form.groupId}
              onChange={(e) =>
                setForm({ ...form, groupId: e.target.value, designationId: '' })
              }
              placeholder={form.categoryId ? 'All groups' : 'Pick a category'}
              options={groupOptions.map((g) => ({
                value: String(g.id),
                label: g.name,
              }))}
            />
            <Select
              label="Designation"
              required
              wrapClassName="sm:col-span-2"
              value={form.designationId}
              onChange={(e) =>
                setForm({ ...form, designationId: e.target.value })
              }
              placeholder="Select designation"
              options={designationOptions.map((d) => ({
                value: String(d.id),
                label: d.name,
              }))}
            />

            <Select
              label="Reporting To"
              wrapClassName="sm:col-span-2"
              value={form.reportsToId}
              onChange={(e) =>
                setForm({ ...form, reportsToId: e.target.value })
              }
              placeholder={
                form.companyId
                  ? managerOptions.length
                    ? '— Nobody —'
                    : 'Nobody else on this company yet'
                  : 'Pick a company first'
              }
              options={managerOptions.map((m) => ({
                value: String(m.id),
                label: `${m.name} (${m.designationName})`,
              }))}
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
    </div>
  );
}
