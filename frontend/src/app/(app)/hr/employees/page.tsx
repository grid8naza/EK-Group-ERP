'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  UserCog,
  Upload,
  Trash2,
  Phone,
  Mail,
  X,
  KeyRound,
  Wallet,
  MapPin,
  User as UserIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDayMonthYear } from '@/lib/utils';
import { useFetch, useLookupValues } from '@/lib/hooks';
import { mediaUrl } from '@/lib/login-screen';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { StatusToggle } from '@/components/ui/StatusToggle';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { UserAccessPanel } from '@/components/cpanel/UserAccessPanel';
import { SalaryPanel } from '@/components/hr/SalaryPanel';
import { PostingsPanel } from '@/components/hr/PostingsPanel';
import {
  Drawer,
  DrawerFooter,
  CloseFooter,
  DISCARD_PROMPT,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { FormSection } from '@/components/ui/FormSection';
import {
  Input,
  Select,
  MultiSelect,
  Checkbox,
  Textarea,
  DateInput,
} from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  AppUser,
  Employee,
  LookupValue,
  HrCategory,
  HrGroup,
  HrDesignation,
  Company,
  Branch,
  CostCenter,
  CostObject,
} from '@/lib/types';

const ROUTE = '/hr/employees';

// Labelled "Gender" on the form. The stored values (and the column) stay as
// they were — relabelling a field is not a reason to rewrite everybody's data.
const GENDERS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * What colour a status chip wears.
 *
 * Keyed on the LABEL rather than the lookup's code, because the label is what a
 * reader sees and what an admin edits — and matched loosely, so "On Leave
 * (Unpaid)" still reads as leave. Anything unrecognised comes back slate, which
 * is the point of having a default: a status somebody adds tomorrow renders as
 * a neutral chip rather than not at all.
 */
const statusColor = (
  label: string,
): 'green' | 'amber' | 'blue' | 'red' | 'slate' => {
  const l = label.toLowerCase();
  if (l.includes('service') || l.includes('working') || l.includes('duty')) {
    return 'green';
  }
  if (l.includes('probation')) return 'amber';
  if (l.includes('leave')) return 'blue';
  if (l.includes('resign') || l.includes('terminat')) return 'red';
  return 'slate';
};

const MARITAL_STATUSES = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'DIVORCED', label: 'Divorced' },
  { value: 'WIDOWED', label: 'Widowed' },
];

/**
 * Minutes after midnight ↔ the "HH:mm" a time field speaks.
 *
 * Blank means "whatever the branch keeps", which is the answer for almost
 * everybody — so an empty field is null on the wire rather than midnight.
 */
const minutesToTime = (m?: number | null) =>
  m === null || m === undefined
    ? ''
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMinutes = (t: string) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

const empty = {
  name: '',
  dateOfBirth: '',
  sex: '', // labelled "Gender" on the form; the stored field keeps its name
  maritalStatus: '',
  bloodGroupId: '',
  aadhaarNumber: '',
  address: '', // Permanent Address
  presentAddress: '',
  phone: '',
  email: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  photoUrl: '',
  // LookupValue ids (HR → Lookups). Numbers, not strings: they go to the
  // server as ids and there is nothing to be gained by round-tripping them
  // through text.
  educationIds: [] as number[],
  skillIds: [] as number[],
  languageIds: [] as number[],

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
  employeeTypeId: '',
  gradeId: '',
  statusId: '',
  lastWorkingDay: '',
  dateOfJoin: '',
  probationMonths: '',
  dateOfConfirmation: '',
  reportsToId: '',
  showInOrgChart: true,
  // Their own hours as a time field reads them; blank = the branch's.
  defaultTimeIn: '',
  defaultTimeOut: '',
  isActive: true,
};

type Form = typeof empty;

/** The drawer's three parts: the person, what they are paid, and the way in. */
type Tab = 'employee' | 'postings' | 'salary' | 'access';

export default function EmployeesPage() {
  const { can, canTab, activeCompanyId, activeBranchId } = useAuth();
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

  // The HR module's own lists, maintained in HR → Lookups (super-admin only).
  const educationValues = useLookupValues('EDUCATION');
  const skillValues = useLookupValues('SKILL');
  const languageValues = useLookupValues('LANGUAGE');
  const gradeValues = useLookupValues('EMPLOYEE_GRADE');
  const bloodGroupValues = useLookupValues('BLOOD_GROUP');
  const employeeTypeValues = useLookupValues('EMPLOYEE_TYPE');
  const statusValues = useLookupValues('EMPLOYEE_STATUS');
  const asOptions = (vals: LookupValue[]) =>
    vals.map((v) => ({ value: v.id, label: v.label }));

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
  const [tab, setTab] = useState<Tab>('employee');
  /**
   * This employee's login, or null where they have none — which is the ordinary
   * case (SRS FR-HRP-01: most staff never sign in). `undefined` while it is
   * still being looked up, so the tab can say "loading" rather than "none".
   */
  const [login, setLogin] = useState<AppUser | null | undefined>(undefined);
  /** Unsaved work on the User Access tab, as that panel reports it. */
  const [accessDirty, setAccessDirty] = useState(false);
  /** Likewise the Salary tab — true while its package editor is open. */
  const [salaryDirty, setSalaryDirty] = useState(false);
  /** And the Postings tab, while its posting editor is open. */
  const [postingsDirty, setPostingsDirty] = useState(false);
  /**
   * The employee form as it stood when last loaded or saved. Compared against
   * rather than a touched-a-field flag, so the drawer stops claiming unsaved
   * work the moment it IS saved — this one stays open after Save.
   */
  const [employeeBaseline, setEmployeeBaseline] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  /** The photograph, shown full size over the drawer. */
  const [photoOpen, setPhotoOpen] = useState(false);
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

  /**
   * The tabs this user's group is allowed to see (Cpanel → User Groups &
   * Privileges → the screen's Tabs row).
   *
   * Falls back to the full list if a group has somehow hidden both: a form with
   * no panes at all is a broken screen, not a locked-down one, and the way to
   * take Employee Master away is to untick the screen rather than empty it.
   */
  const visibleTabs = useMemo(() => {
    const all: TabDef[] = [
      {
        key: 'employee',
        label: 'Employee',
        icon: <UserCog className="h-4 w-4" />,
      },
      {
        key: 'postings',
        label: 'Postings',
        icon: <MapPin className="h-4 w-4" />,
        // A posting has to belong to somebody.
        disabled: !editing,
      },
      {
        key: 'salary',
        label: 'Salary',
        icon: <Wallet className="h-4 w-4" />,
        // A package has to belong to somebody.
        disabled: !editing,
      },
      {
        key: 'access',
        label: 'User Access',
        icon: <KeyRound className="h-4 w-4" />,
        // Nothing to attach a login to until the record exists.
        disabled: !editing,
      },
    ];
    const allowed = all.filter((t) => canTab(ROUTE, t.key));
    return allowed.length ? allowed : all;
  }, [canTab, editing]);

  /** Which tab the drawer opens on — the first one this group can see. */
  const defaultTab: Tab = canTab(ROUTE, 'employee') ? 'employee' : 'access';

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

  /** The chosen status's label, shown as a chip beside the employee code. */
  const statusChoice = statusValues.find((v) => String(v.id) === form.statusId);
  const statusLabel = statusChoice?.label ?? '';

  /**
   * Has this person gone? Decided on the lookup value's CODE, matching the
   * server's rule — renaming "Resigned" must not switch the last working day
   * back off. Only then is that field asked for.
   */
  const hasLeft =
    !!statusChoice &&
    ['RESIGNED', 'TERMINATED'].includes(String(statusChoice.value));

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
    setPhotoOpen(false);
    setTab(defaultTab);
    setLogin(undefined);
    setAccessDirty(false);
    setSalaryDirty(false);
    setPostingsDirty(false);
  };

  /**
   * Is there unsaved work anywhere in the drawer?
   *
   * Both tabs, whichever is on screen: the User Access tab is unmounted while
   * the Employee tab is showing, so asking only about the visible one would let
   * a typed-out employee be thrown away by a Close pressed from the other side.
   *
   * A view drawer is never dirty — nothing in it can be typed into.
   */
  const employeeDirty =
    !view &&
    employeeBaseline !== '' &&
    JSON.stringify(form) !== employeeBaseline;
  const drawerDirty = useCallback(
    () => employeeDirty || accessDirty || salaryDirty || postingsDirty,
    [employeeDirty, accessDirty, salaryDirty, postingsDirty],
  );

  /**
   * Close, asking first if that would lose something. Given to the footer
   * buttons; the X, Escape and the backdrop are guarded by the Drawer itself
   * from the same `dirty` answer, so every way out asks once and only once.
   */
  const requestClose = async () => {
    if (drawerDirty() && !(await confirm({ ...DISCARD_PROMPT }))) return;
    closeDrawer();
  };

  /**
   * Move between the tabs, asking first where that would lose something.
   *
   * Only the two side panels ask: each is unmounted on the way out and its
   * half-finished work goes with it. The Employee form is held here and
   * survives the round trip, so switching away from it costs nothing.
   */
  const switchTab = async (next: Tab) => {
    if (next === tab) return;

    const leaving =
      tab === 'access' && accessDirty
        ? {
            what: 'the login',
            where: 'User Access',
            clear: () => setAccessDirty(false),
          }
        : tab === 'salary' && salaryDirty
          ? {
              what: 'the package',
              where: 'Salary',
              clear: () => setSalaryDirty(false),
            }
          : tab === 'postings' && postingsDirty
            ? {
                what: 'the posting',
                where: 'Postings',
                clear: () => setPostingsDirty(false),
              }
            : null;

    if (leaving) {
      const ok = await confirm({
        title: `Leave ${leaving.what} unsaved?`,
        message: `What has been entered on ${leaving.where} has not been saved. Switching tabs loses it.`,
        danger: true,
        confirmText: 'Yes',
        cancelText: 'No',
        defaultCancel: true,
      });
      if (!ok) return;
      leaving.clear();
    }
    setTab(next);
  };

  /**
   * The employee the User Access tab is setting a login up for.
   *
   * Memoized deliberately: the panel reloads its form whenever this changes, so
   * building the object inline in the JSX — a new identity every render — would
   * wipe what was being typed on every keystroke.
   */
  const loginOwner = useMemo(
    () =>
      editing
        ? {
            id: editing.id,
            code: editing.code,
            name: editing.name,
            email: editing.email,
            phone: editing.phone,
            companyId: editing.companyId,
            branchId: editing.branchId,
          }
        : null,
    [editing],
  );

  /**
   * Look up this employee's login. One call per employee opened, not per
   * keystroke — the tab reads it, the panel writes through it.
   *
   * Not attempted at all where the User Access tab is hidden: the endpoint
   * refuses that caller, and a 403 in the console would say nothing the missing
   * tab does not already say.
   */
  const loadLogin = useCallback(
    async (employeeId: number) => {
      if (!canTab(ROUTE, 'access')) {
        setLogin(null);
        return;
      }
      setLogin(undefined);
      try {
        const rows = await api.get<AppUser[]>(
          `/users?employeeId=${employeeId}`,
        );
        setLogin(rows?.[0] ?? null);
      } catch {
        // A login that cannot be read is shown as none rather than as an error
        // banner over a form the user came here to fill in for other reasons.
        setLogin(null);
      }
    },
    [canTab],
  );

  /**
   * Put a form on screen and treat it as the saved state. Everything that is
   * not somebody typing goes through here, so "dirty" means what it says.
   */
  const loadForm = (next: Form) => {
    setEmployeeBaseline(JSON.stringify(next));
    setForm(next);
  };

  const formFrom = (e: Employee): Form => ({
    name: e.name,
    dateOfBirth: e.dateOfBirth ?? '',
    sex: e.sex ?? '',
    maritalStatus: e.maritalStatus ?? '',
    bloodGroupId: e.bloodGroupId != null ? String(e.bloodGroupId) : '',
    aadhaarNumber: e.aadhaarNumber ?? '',
    address: e.address ?? '',
    presentAddress: e.presentAddress ?? '',
    phone: e.phone ?? '',
    email: e.email ?? '',
    emergencyContactName: e.emergencyContactName ?? '',
    emergencyContactPhone: e.emergencyContactPhone ?? '',
    photoUrl: e.photoUrl ?? '',
    educationIds: e.educationIds ?? [],
    skillIds: e.skillIds ?? [],
    languageIds: e.languageIds ?? [],

    companyId: String(e.companyId),
    branchId: e.branchId != null ? String(e.branchId) : '',
    costCenterId: e.costCenterId != null ? String(e.costCenterId) : '',
    costObjectId: e.costObjectId != null ? String(e.costObjectId) : '',
    categoryId: String(e.categoryId),
    groupId: String(e.groupId),
    designationId: String(e.designationId),
    employeeTypeId: e.employeeTypeId != null ? String(e.employeeTypeId) : '',
    gradeId: e.gradeId != null ? String(e.gradeId) : '',
    statusId: e.statusId != null ? String(e.statusId) : '',
    lastWorkingDay: e.lastWorkingDay ?? '',
    dateOfJoin: e.dateOfJoin,
    probationMonths: e.probationMonths != null ? String(e.probationMonths) : '',
    dateOfConfirmation: e.dateOfConfirmation ?? '',
    reportsToId: e.reportsToId != null ? String(e.reportsToId) : '',
    showInOrgChart: e.showInOrgChart ?? true,
    defaultTimeIn: minutesToTime(e.defaultTimeIn),
    defaultTimeOut: minutesToTime(e.defaultTimeOut),
    isActive: e.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setTab(defaultTab);
    setLogin(null); // a record that does not exist yet can hold no login
    // Start where the user is working — they can move it on the form.
    loadForm({
      ...empty,
      companyId: activeCompanyId ? String(activeCompanyId) : '',
      branchId: activeBranchId ? String(activeBranchId) : '',
    });
    setOpen(true);
  };
  const openEdit = (e: Employee) => {
    setEditing(e);
    setView(false);
    setTab(defaultTab);
    loadForm(formFrom(e));
    setOpen(true);
    void loadLogin(e.id);
  };
  const openView = (e: Employee) => {
    setEditing(e);
    setView(true);
    setTab(defaultTab);
    loadForm(formFrom(e));
    setOpen(true);
    void loadLogin(e.id);
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

  // Escape closes the enlarged photograph before the drawer sees it.
  useEffect(() => {
    if (!photoOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setPhotoOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [photoOpen]);

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
      bloodGroupId: idOrNull(form.bloodGroupId),
      aadhaarNumber: form.aadhaarNumber.trim() || null,
      address: form.address.trim() || null,
      presentAddress: form.presentAddress.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      emergencyContactName: form.emergencyContactName.trim() || null,
      emergencyContactPhone: form.emergencyContactPhone.trim() || null,
      photoUrl: form.photoUrl || null,
      // Sent whole every time: what arrives replaces what is stored, so
      // removing a skill is simply leaving it out.
      educationIds: form.educationIds,
      skillIds: form.skillIds,
      languageIds: form.languageIds,

      companyId: Number(form.companyId),
      branchId: idOrNull(form.branchId),
      costCenterId: idOrNull(form.costCenterId),
      costObjectId: idOrNull(form.costObjectId),
      designationId: Number(form.designationId),
      employeeTypeId: idOrNull(form.employeeTypeId),
      gradeId: idOrNull(form.gradeId),
      statusId: idOrNull(form.statusId),
      // Sent only where it applies; the server refuses it otherwise and clears
      // it when the status goes back to a working one.
      lastWorkingDay: hasLeft ? form.lastWorkingDay || null : null,
      dateOfJoin: form.dateOfJoin,
      probationMonths: form.probationMonths
        ? Number(form.probationMonths)
        : null,
      dateOfConfirmation: form.dateOfConfirmation || null,
      reportsToId: idOrNull(form.reportsToId),
      showInOrgChart: form.showInOrgChart,
      defaultTimeIn: timeToMinutes(form.defaultTimeIn),
      defaultTimeOut: timeToMinutes(form.defaultTimeOut),
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
        setLogin(null); // the next record is a different person
        // A saved record followed by a blank one is not unsaved work, so the
        // cleared form becomes the baseline too.
        loadForm({
          ...form,
          name: '',
          dateOfBirth: '',
          sex: '',
          maritalStatus: '',
          bloodGroupId: '',
          aadhaarNumber: '',
          address: '',
          presentAddress: '',
          phone: '',
          email: '',
          emergencyContactName: '',
          emergencyContactPhone: '',
          photoUrl: '',
          educationIds: [],
          skillIds: [],
          languageIds: [],
          // The grade and the probation term belong with the designation being
          // carried over — a batch of hires into one role usually shares both.
          // The confirmation DATE does not: that is one person's.
          dateOfConfirmation: '',
        });
        setTimeout(() => nameRef.current?.focus(), 0);
      } else if (mode === 'save') {
        setEditing(saved);
        loadForm(formFrom(saved));
        // The record now has an id, so the User Access tab has something to
        // hang a login on.
        void loadLogin(saved.id);
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
      accessor: (r) => formatDayMonthYear(r.dateOfJoin),
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
        // The RAW close: the Drawer asks for itself, from `dirty` below, on the
        // X, Escape and the backdrop. Guarding here as well would ask twice.
        onClose={closeDrawer}
        dirty={drawerDirty}
        title={title}
        subtitle="Employee details"
        icon={<UserCog className="h-5 w-5" />}
        width="xl"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : tab === 'employee' ? (
            <DrawerFooter
              onCancel={() => void requestClose()}
              onSave={save}
              saving={saving}
              dataEntry
            />
          ) : (
            // Salary and User Access save their OWN thing — a package, a login
            // — each with its own button. One Save meaning three different
            // things depending on the tab is the confusion worth avoiding.
            <CloseFooter onClose={() => void requestClose()} />
          )
        }
      >
        {/* Tab navigation stays outside the read-only wrapper so tabs remain
            switchable in view mode. Hidden entirely when this group is left
            with one tab — a single tab is a heading, not a choice. */}
        {visibleTabs.length > 1 && (
          <Tabs
            tabs={visibleTabs}
            active={tab}
            onChange={(k) => void switchTab(k as Tab)}
            className="mb-5"
          />
        )}

        {tab === 'postings' ? (
          <PostingsPanel
            employeeId={editing?.id ?? null}
            employee={editing}
            readOnly={view}
            onDirtyChange={setPostingsDirty}
          />
        ) : tab === 'salary' ? (
          <SalaryPanel
            employeeId={editing?.id ?? null}
            readOnly={view}
            onDirtyChange={setSalaryDirty}
          />
        ) : tab === 'access' ? (
          login === undefined ? (
            <p className="px-1 py-6 text-sm text-slate-400">Loading login…</p>
          ) : (
            <UserAccessPanel
              user={login}
              employee={loginOwner}
              // A record being VIEWED is being read, not administered — the
              // same rule the rest of the drawer follows.
              readOnly={view}
              onSaved={(u) => setLogin(u)}
              onDeleted={() => setLogin(null)}
              onDirtyChange={setAccessDirty}
            />
          )
        ) : (
          <ReadOnlyFieldset readOnly={view}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* ---- the photograph and who this record is ---- */}
              {/* No label: the photograph and the name under it say what this is
                more plainly than the word "Photograph" ever did. */}
              <div className="sm:col-span-2">
                <div className="flex items-center gap-4">
                  {/*
                  A div rather than a button on purpose: in View mode this whole
                  form sits inside a disabled fieldset, which would make a button
                  inert — and looking at somebody's photograph is exactly what
                  view mode is for.
                */}
                  <div
                    className={cn(
                      'flex h-28 w-28 flex-none items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800',
                      form.photoUrl && 'cursor-zoom-in',
                    )}
                    onClick={() => form.photoUrl && setPhotoOpen(true)}
                    title={form.photoUrl ? 'Click to enlarge' : undefined}
                  >
                    {form.photoUrl ? (
                      // contain, not cover: the whole photograph fits in the box
                      // rather than being cropped to fill it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(form.photoUrl)}
                        alt="Photograph"
                        className="h-full w-full rounded-lg object-contain"
                      />
                    ) : (
                      <UserIcon className="h-10 w-10 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {/*
                    Who this record is, beside their face. Read from the FORM,
                    not the saved row, so it names whoever is being typed in
                    rather than lagging a field behind. Set tight: four lines
                    that belong together should read as one block, not fill the
                    top of the drawer.
                  */}
                    <p className="truncate text-xl font-bold leading-tight text-brand-700 dark:text-brand-300">
                      {form.name.trim() || 'New employee'}
                    </p>
                    <p className="truncate text-base font-semibold leading-tight text-amber-600 dark:text-amber-400">
                      {designationName(form.designationId) ||
                        'No designation yet'}
                    </p>
                    {/* The code and where they stand, on one line. Read from
                        the FORM, not the saved row, so changing the status on
                        the Posting Details block shows here at once rather
                        than after a save. */}
                    {(editing || statusLabel) && (
                      <p className="flex flex-wrap items-center gap-2 leading-tight">
                        {editing && (
                          <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                            {editing.code}
                          </span>
                        )}
                        {statusLabel && (
                          <Badge color={statusColor(statusLabel)}>
                            {statusLabel}
                          </Badge>
                        )}
                      </p>
                    )}
                    {/* How to reach them — the other thing anybody opens this
                      record for. Hidden until there is something to show. */}
                    {(form.phone.trim() || form.email.trim()) && (
                      <p className="flex flex-wrap items-center gap-x-4 text-sm leading-tight text-slate-500 dark:text-slate-400">
                        {form.phone.trim() && (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 flex-none" />
                            {form.phone.trim()}
                          </span>
                        )}
                        {form.email.trim() && (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 flex-none" />
                            <span className="truncate">
                              {form.email.trim()}
                            </span>
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
                      PNG, JPG or WEBP — up to 5 MB. Can follow later.
                    </span>
                  </div>
                </div>
              </div>

              {/* ---- the person ---- */}
              <FormSection>Personal Details</FormSection>

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
                label="Gender"
                value={form.sex}
                onChange={(e) => setForm({ ...form, sex: e.target.value })}
                placeholder="— Not stated —"
                sortOptions={false}
                options={GENDERS}
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
              <Select
                label="Blood Group"
                value={form.bloodGroupId}
                onChange={(e) =>
                  setForm({ ...form, bloodGroupId: e.target.value })
                }
                placeholder="— Not stated —"
                // Left in the order the lookup holds them (by type, positive
                // before negative). A→Z would read A+, A-, AB+, AB-, B+ …
                sortOptions={false}
                options={asOptions(bloodGroupValues).map((o) => ({
                  ...o,
                  value: String(o.value),
                }))}
              />
              {/* The two addresses on ONE row, a column each — they are read
                  against each other far more often than either is read alone,
                  so nothing is allowed between them. Everything after them
                  follows in order; Aadhaar sits below rather than above so the
                  pair starts a row of its own. */}
              <Textarea
                label="Permanent Address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
              <Textarea
                label="Present Address"
                rows={2}
                value={form.presentAddress}
                onChange={(e) =>
                  setForm({ ...form, presentAddress: e.target.value })
                }
                placeholder="If different from the permanent address"
              />
              <Input
                label="Aadhaar Number"
                value={form.aadhaarNumber}
                onChange={(e) =>
                  setForm({
                    ...form,
                    // Digits only, 12 of them — typed spaces are the usual reason
                    // an otherwise valid number is rejected.
                    aadhaarNumber: e.target.value
                      .replace(/\D/g, '')
                      .slice(0, 12),
                  })
                }
                placeholder="12 digits"
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
              {/* What they bring. Three lists rather than free text so a search
                  for everybody who speaks Tamil, or can decorate a cake, has
                  something to match on. The lists themselves live in
                  HR → Lookups. */}
              <MultiSelect
                label="Education"
                value={form.educationIds}
                onChange={(v) =>
                  setForm({ ...form, educationIds: v.map(Number) })
                }
                placeholder="Select qualifications"
                options={asOptions(educationValues)}
              />
              <MultiSelect
                label="Skills"
                value={form.skillIds}
                onChange={(v) => setForm({ ...form, skillIds: v.map(Number) })}
                placeholder="Select skills"
                options={asOptions(skillValues)}
              />
              <MultiSelect
                label="Languages Known"
                value={form.languageIds}
                onChange={(v) =>
                  setForm({ ...form, languageIds: v.map(Number) })
                }
                placeholder="Select languages"
                options={asOptions(languageValues)}
              />

              {/* Last in the block, and a pair of their own: this is who to
                  ring when something happens at work, not another way to reach
                  the employee. */}
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
              <FormSection>Posting Details</FormSection>

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
                  setForm({
                    ...form,
                    groupId: e.target.value,
                    designationId: '',
                  })
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
              {/* How they are ENGAGED, next to what they do — the same job can
                  be held on permanent, part-time or temporary terms. */}
              <Select
                label="Employee Type"
                value={form.employeeTypeId}
                onChange={(e) =>
                  setForm({ ...form, employeeTypeId: e.target.value })
                }
                placeholder="— Not stated —"
                sortOptions={false}
                options={asOptions(employeeTypeValues).map((o) => ({
                  ...o,
                  value: String(o.value),
                }))}
              />

              {/* Beside the designation, not derived from it: two people can
                  hold the same designation on different grades, which is the
                  whole point of having one. */}
              <Select
                label="Employee Grade"
                value={form.gradeId}
                onChange={(e) => setForm({ ...form, gradeId: e.target.value })}
                placeholder="— None —"
                sortOptions={false}
                options={asOptions(gradeValues).map((o) => ({
                  ...o,
                  value: String(o.value),
                }))}
              />

              <Select
                label="Reporting To"
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

              {/* Where they stand today. Entered rather than worked out: it is
                  not the Active flag below, nor a missing confirmation date —
                  it is what HR say the position is. */}
              <Select
                label="Employee Status"
                value={form.statusId}
                onChange={(e) => {
                  const next = e.target.value;
                  const chosen = statusValues.find(
                    (v) => String(v.id) === next,
                  );
                  const leaving =
                    !!chosen &&
                    ['RESIGNED', 'TERMINATED'].includes(String(chosen.value));
                  // Moving back to a working status drops the last working day
                  // with it, rather than leaving a date behind on somebody who
                  // has not gone. The server does the same on save.
                  setForm({
                    ...form,
                    statusId: next,
                    lastWorkingDay: leaving ? form.lastWorkingDay : '',
                  });
                }}
                placeholder="— Not stated —"
                sortOptions={false}
                options={asOptions(statusValues).map((o) => ({
                  ...o,
                  value: String(o.value),
                }))}
              />
              {/* Only asked for once the status says they have gone. Left on
                  the form but disabled rather than hidden, so the field does
                  not appear and disappear as the status changes — and so its
                  place in the run of fields stays put. */}
              <DateInput
                label="Last Working Day"
                value={form.lastWorkingDay}
                onChange={(iso) => setForm({ ...form, lastWorkingDay: iso })}
                disabled={!hasLeft}
                placeholder={
                  hasLeft ? undefined : 'Set when resigned or terminated'
                }
              />

              {/* The dates of the engagement itself, after the shape of the job
                  above them. */}
              <DateInput
                label="Date of Join"
                required
                value={form.dateOfJoin}
                onChange={(iso) => setForm({ ...form, dateOfJoin: iso })}
              />
              <Input
                label="Probation Period (months)"
                type="number"
                min={0}
                max={120}
                value={form.probationMonths}
                onChange={(e) =>
                  setForm({ ...form, probationMonths: e.target.value })
                }
                placeholder="e.g. 6"
              />
              {/* What was AGREED above, what actually HAPPENED here — they part
                  company often enough (a confirmation early for good work, late
                  for a review that slipped) that one cannot be read off the
                  other. */}
              <DateInput
                label="Date of Confirmation"
                value={form.dateOfConfirmation}
                onChange={(iso) =>
                  setForm({ ...form, dateOfConfirmation: iso })
                }
              />

              {/* The hours THIS person works, where they are not the branch's.
                  Blank for almost everybody: attendance sheets fill themselves
                  in from the branch's working day, and this is the override for
                  the baker who starts at four every morning. Not a roster — a
                  genuine rota, where the same person works mornings one week
                  and nights the next, is a different thing entirely. */}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Time In (their own hours)
                </span>
                <input
                  type="time"
                  className="input-base"
                  value={form.defaultTimeIn}
                  onChange={(e) =>
                    setForm({ ...form, defaultTimeIn: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Time Out (their own hours)
                </span>
                <input
                  type="time"
                  className="input-base"
                  value={form.defaultTimeOut}
                  onChange={(e) =>
                    setForm({ ...form, defaultTimeOut: e.target.value })
                  }
                />
              </label>

              {/* Whether this person is drawn on the organisation chart. Yes
                  for almost everybody — the chart is of the whole staff — with
                  an off switch for the records that would clutter it rather
                  than explain it. */}
              <Select
                label="Show in Organization Chart"
                value={form.showInOrgChart ? 'yes' : 'no'}
                onChange={(e) =>
                  setForm({ ...form, showInOrgChart: e.target.value === 'yes' })
                }
                sortOptions={false}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
              />

              {/* Bottom-aligned with the picker beside it: a checkbox has no
                  label above it, so left to itself it would float level with
                  that field's LABEL rather than its input. */}
              <div className="flex items-end pb-2">
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
        )}
      </Drawer>

      {/*
        The photograph, full size. Rendered OUTSIDE the drawer: in view mode the
        form sits in a disabled fieldset, and a close button inside it would be
        inert. Above the drawer's own z-50, and any click anywhere dismisses it.
      */}
      {photoOpen && form.photoUrl && (
        <div
          className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-slate-900/80 p-6 backdrop-blur-sm"
          onClick={() => setPhotoOpen(false)}
        >
          <div
            className="relative max-h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(form.photoUrl)}
              alt={form.name.trim() || 'Photograph'}
              className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain"
            />
            <div
              className="absolute -right-3 -top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
              onClick={() => setPhotoOpen(false)}
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-white">
              {form.name.trim()}
              {designationName(form.designationId) && (
                <span className="font-normal text-slate-300">
                  {' '}
                  — {designationName(form.designationId)}
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
