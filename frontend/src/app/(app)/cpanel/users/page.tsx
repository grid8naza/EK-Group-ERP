'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Users,
  ShieldCheck,
  Building2,
  Layers,
  ChevronDown,
  Smartphone,
  Globe,
  GitBranch,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter, type SaveMode } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { resolveIcon } from '@/lib/icons';
import type {
  AppUser,
  Company,
  CompanyModule,
  UserGroup,
  SecurityType,
  Branch,
} from '@/lib/types';

const ROUTE = '/cpanel/users';

const empty = {
  userCode: '',
  username: '',
  name: '',
  email: '',
  password: '',
  mobile: '',
  mobileMac: '',
  webEnabled: true,
  mobileEnabled: false,
  computerMac: '',
  securityType: 'PASSWORD' as SecurityType,
  isActive: true,
  remarks: '',
  companyIds: [] as number[],
  defaultCompanyId: null as number | null,
  groupIds: [] as number[],
  branchIds: [] as number[],
  defaultBranchIds: [] as number[],
  // companyId -> assigned module ids
  moduleAssignments: {} as Record<number, number[]>,
  // companyId -> the module that loads automatically in that company
  defaultModuleByCompany: {} as Record<number, number | null>,
};

export default function UsersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  // Groups keyed by companyId.
  const [groupsByCompany, setGroupsByCompany] = useState<
    Record<number, UserGroup[]>
  >({});
  // Enabled modules keyed by companyId.
  const [modulesByCompany, setModulesByCompany] = useState<
    Record<number, CompanyModule[]>
  >({});
  // Branches keyed by companyId (only for branch-applicable companies).
  const [branchesByCompany, setBranchesByCompany] = useState<
    Record<number, Branch[]>
  >({});
  // Which company panels are expanded in the access section.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await api.get<AppUser[]>(`/users${q}`);
      setUsers(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load users.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<AppUser>({
    endpoint: '/users',
    route: ROUTE,
    noun: 'user',
    nameOf: (u) => u.name,
    reload: load,
  });

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api
      .get<Company[]>('/companies')
      .then((c) => setCompanies(c ?? []))
      .catch(() => {});
  }, []);

  // Fetch groups for every selected company (only the ones not yet loaded).
  useEffect(() => {
    if (!open) return;
    const missing = form.companyIds.filter((id) => !groupsByCompany[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        api
          .get<UserGroup[]>(`/user-groups?companyId=${id}`)
          .then((g) => [id, g ?? []] as const)
          .catch(() => [id, [] as UserGroup[]] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setGroupsByCompany((prev) => {
        const next = { ...prev };
        for (const [id, g] of results) next[id] = g;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.companyIds, groupsByCompany]);

  // Fetch the enabled modules for every selected company (lazy, cached).
  useEffect(() => {
    if (!open) return;
    const missing = form.companyIds.filter((id) => !modulesByCompany[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        api
          .get<CompanyModule[]>(`/companies/${id}/modules`)
          // Exclude core modules — they are super-admin only.
          .then(
            (m) =>
              [id, (m ?? []).filter((x) => x.enabled && !x.isCore)] as const,
          )
          .catch(() => [id, [] as CompanyModule[]] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setModulesByCompany((prev) => {
        const next = { ...prev };
        for (const [id, m] of results) next[id] = m;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.companyIds, modulesByCompany]);

  // Fetch branches for every selected branch-applicable company (lazy, cached).
  useEffect(() => {
    if (!open) return;
    const missing = form.companyIds.filter((id) => {
      const co = companies.find((c) => c.id === id);
      return co?.branchApplicable && !branchesByCompany[id];
    });
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        api
          .get<Branch[]>(`/branches?companyId=${id}`)
          .then((b) => [id, (b ?? []).filter((x) => x.isActive)] as const)
          .catch(() => [id, [] as Branch[]] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setBranchesByCompany((prev) => {
        const next = { ...prev };
        for (const [id, b] of results) next[id] = b;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.companyIds, companies, branchesByCompany]);

  // Modules a company offers this user = enabled modules that are also managed
  // by at least one of the user's currently-selected groups for that company.
  const availableModuleIds = useCallback(
    (companyId: number, groupIds: number[]) => {
      const groups = groupsByCompany[companyId] ?? [];
      const fromGroups = new Set(
        groups
          .filter((g) => groupIds.includes(g.id))
          .flatMap((g) => (g.modules ?? []).map((m) => m.id)),
      );
      return new Set(
        (modulesByCompany[companyId] ?? [])
          .filter((m) => fromGroups.has(m.id))
          .map((m) => m.id),
      );
    },
    [groupsByCompany, modulesByCompany],
  );

  // Keep module assignments within what the selected groups allow. Runs when
  // groups, companies, or the loaded group/module data change.
  useEffect(() => {
    // Never normalize in read-only View mode — the drawer must show exactly
    // what is saved, not a re-pruned version of it.
    if (!open || view) return;
    setForm((f) => {
      let changed = false;
      const next = { ...f.moduleAssignments };
      const nextDefaults = { ...f.defaultModuleByCompany };
      for (const cid of f.companyIds) {
        if (!groupsByCompany[cid] || !modulesByCompany[cid]) continue;
        const allowed = availableModuleIds(cid, f.groupIds);
        const cur = next[cid] ?? [];
        const pruned = cur.filter((id) => allowed.has(id));
        if (pruned.length !== cur.length) {
          next[cid] = pruned;
          changed = true;
        }
        // Keep the default within the (possibly pruned) assigned modules.
        const def = nextDefaults[cid] ?? null;
        const newDef =
          def != null && pruned.includes(def)
            ? def
            : (pruned[0] ?? null);
        if (newDef !== def) {
          nextDefaults[cid] = newDef;
          changed = true;
        }
      }
      return changed
        ? { ...f, moduleAssignments: next, defaultModuleByCompany: nextDefaults }
        : f;
    });
  }, [open, view, form.groupIds, form.companyIds, groupsByCompany, modulesByCompany, availableModuleIds]);

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty, moduleAssignments: {}, defaultModuleByCompany: {} });
    setExpanded({});
    setOpen(true);
  };
  const loadInto = (u: AppUser) => {
    setEditing(u);
    const companyIds = u.companyIds ?? u.companies?.map((c) => c.id) ?? [];
    const defaultCompanyId =
      u.defaultCompanyId ??
      u.companies?.find((c) => c.isDefault)?.id ??
      null;
    const moduleAssignments: Record<number, number[]> = {};
    const defaultModuleByCompany: Record<number, number | null> = {};
    for (const a of u.moduleAssignments ?? []) {
      moduleAssignments[a.companyId] = a.moduleIds;
      defaultModuleByCompany[a.companyId] = a.defaultModuleId ?? null;
    }
    // Expand every accessible company panel by default.
    setExpanded(Object.fromEntries(companyIds.map((id) => [id, true])));
    setForm({
      userCode: u.userCode,
      username: u.username,
      name: u.name,
      email: u.email,
      password: '',
      mobile: u.mobile ?? '',
      mobileMac: u.mobileMac ?? '',
      webEnabled: u.webEnabled,
      mobileEnabled: u.mobileEnabled ?? false,
      computerMac: u.computerMac ?? '',
      securityType: u.securityType,
      isActive: u.isActive,
      remarks: u.remarks ?? '',
      companyIds,
      defaultCompanyId,
      groupIds: u.groupIds ?? u.groups?.map((g) => g.id) ?? [],
      branchIds: u.branchIds ?? [],
      defaultBranchIds: u.defaultBranchIds ?? [],
      moduleAssignments,
      defaultModuleByCompany,
    });
    setOpen(true);
  };

  const openEdit = (u: AppUser) => {
    setView(false);
    loadInto(u);
  };

  // Read-only view — works for locked records without unlocking them.
  const openView = (u: AppUser) => {
    setView(true);
    loadInto(u);
  };

  const toggleCompany = (id: number) => {
    setForm((f) => {
      const has = f.companyIds.includes(id);
      if (has) {
        // Remove company: drop its groups + module assignment + defaults + branches.
        const companyGroupIds = (groupsByCompany[id] ?? []).map((g) => g.id);
        const companyBranchIds = (branchesByCompany[id] ?? []).map((b) => b.id);
        const moduleAssignments = { ...f.moduleAssignments };
        delete moduleAssignments[id];
        const defaultModuleByCompany = { ...f.defaultModuleByCompany };
        delete defaultModuleByCompany[id];
        return {
          ...f,
          companyIds: f.companyIds.filter((c) => c !== id),
          groupIds: f.groupIds.filter((g) => !companyGroupIds.includes(g)),
          branchIds: f.branchIds.filter((b) => !companyBranchIds.includes(b)),
          defaultBranchIds: f.defaultBranchIds.filter(
            (b) => !companyBranchIds.includes(b),
          ),
          moduleAssignments,
          defaultModuleByCompany,
          defaultCompanyId:
            f.defaultCompanyId === id ? null : f.defaultCompanyId,
        };
      }
      const companyIds = [...f.companyIds, id];
      setExpanded((ex) => ({ ...ex, [id]: true }));
      // First company selected becomes the default automatically.
      return {
        ...f,
        companyIds,
        defaultCompanyId: f.defaultCompanyId ?? id,
      };
    });
  };

  const setDefaultCompany = (id: number) => {
    setForm((f) => ({ ...f, defaultCompanyId: id }));
  };

  const toggleGroup = (id: number) => {
    setForm((f) => ({
      ...f,
      groupIds: f.groupIds.includes(id)
        ? f.groupIds.filter((g) => g !== id)
        : [...f.groupIds, id],
    }));
  };

  const toggleBranch = (id: number, companyId: number) => {
    setForm((f) => {
      const companyBranchIds = (branchesByCompany[companyId] ?? []).map(
        (b) => b.id,
      );
      if (f.branchIds.includes(id)) {
        // Removing: drop it; if it was this company's default, promote another
        // selected branch of the same company to default.
        const branchIds = f.branchIds.filter((b) => b !== id);
        let defaultBranchIds = f.defaultBranchIds.filter((b) => b !== id);
        if (f.defaultBranchIds.includes(id)) {
          const next = branchIds.find((b) => companyBranchIds.includes(b));
          if (next != null) defaultBranchIds = [...defaultBranchIds, next];
        }
        return { ...f, branchIds, defaultBranchIds };
      }
      // Adding: select it; if the company has no default yet, make this it.
      const hasDefault = f.defaultBranchIds.some((b) =>
        companyBranchIds.includes(b),
      );
      return {
        ...f,
        branchIds: [...f.branchIds, id],
        defaultBranchIds: hasDefault
          ? f.defaultBranchIds
          : [...f.defaultBranchIds, id],
      };
    });
  };

  // Mark one branch as the user's default for its company (replaces any prior
  // default among that company's branches).
  const setDefaultBranch = (id: number, companyId: number) => {
    setForm((f) => {
      const companyBranchIds = (branchesByCompany[companyId] ?? []).map(
        (b) => b.id,
      );
      return {
        ...f,
        defaultBranchIds: [
          ...f.defaultBranchIds.filter((b) => !companyBranchIds.includes(b)),
          id,
        ],
      };
    });
  };

  const toggleModule = (companyId: number, moduleId: number) => {
    setForm((f) => {
      const cur = f.moduleAssignments[companyId] ?? [];
      const next = cur.includes(moduleId)
        ? cur.filter((m) => m !== moduleId)
        : [...cur, moduleId];
      // Keep the default valid: clear it if its module was removed; if nothing
      // is the default yet, the first assigned module becomes it.
      let def = f.defaultModuleByCompany[companyId] ?? null;
      if (def != null && !next.includes(def)) def = null;
      if (def == null && next.length) def = next[0];
      return {
        ...f,
        moduleAssignments: { ...f.moduleAssignments, [companyId]: next },
        defaultModuleByCompany: {
          ...f.defaultModuleByCompany,
          [companyId]: def,
        },
      };
    });
  };

  const setDefaultModule = (companyId: number, moduleId: number) => {
    setForm((f) => ({
      ...f,
      defaultModuleByCompany: {
        ...f.defaultModuleByCompany,
        [companyId]: moduleId,
      },
    }));
  };

  const setAllModules = (companyId: number, all: boolean) => {
    setForm((f) => {
      const next = all
        ? Array.from(availableModuleIds(companyId, f.groupIds))
        : [];
      let def = f.defaultModuleByCompany[companyId] ?? null;
      if (def != null && !next.includes(def)) def = null;
      if (def == null && next.length) def = next[0];
      return {
        ...f,
        moduleAssignments: { ...f.moduleAssignments, [companyId]: next },
        defaultModuleByCompany: {
          ...f.defaultModuleByCompany,
          [companyId]: def,
        },
      };
    });
  };

  const toggleExpand = (id: number) =>
    setExpanded((ex) => ({ ...ex, [id]: !ex[id] }));

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.userCode.trim() || !form.username.trim() || !form.name.trim()) {
      toast.error('User Code, Username and Name are required.');
      return;
    }
    if (!editing && !form.password.trim() && form.securityType === 'PASSWORD') {
      toast.error('Password is required for new password-based users.');
      return;
    }
    if (!form.webEnabled && !form.mobileEnabled) {
      toast.error('Select at least one access channel (Web or Mobile).');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        userCode: form.userCode,
        username: form.username,
        name: form.name,
        email: form.email,
        mobile: form.mobile || null,
        mobileMac: form.mobileMac || null,
        webEnabled: form.webEnabled,
        mobileEnabled: form.mobileEnabled,
        computerMac: form.computerMac || null,
        securityType: form.securityType,
        isActive: form.isActive,
        remarks: form.remarks || null,
        companyIds: form.companyIds,
        defaultCompanyId: form.defaultCompanyId,
        groupIds: form.groupIds,
        branchIds: form.branchIds,
        defaultBranchIds: form.defaultBranchIds,
        // Only send assignments for companies the user actually has access to.
        moduleAssignments: form.companyIds.map((companyId) => ({
          companyId,
          moduleIds: form.moduleAssignments[companyId] ?? [],
          defaultModuleId: form.defaultModuleByCompany[companyId] ?? null,
        })),
      };
      if (form.password.trim()) payload.password = form.password;

      let saved: AppUser;
      if (editing) {
        saved = await api.patch<AppUser>(`/users/${editing.id}`, payload);
        toast.success('User updated.');
      } else {
        saved = await api.post<AppUser>('/users', payload);
        toast.success('User created.');
      }
      await load();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm({ ...empty });
      } else if (mode === 'save') {
        loadInto(saved);
      } else setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: AppUser) => {
    const ok = await confirm({
      title: 'Delete user',
      message: `Delete "${u.name}" (${u.username})?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success('User deleted.');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<AppUser>[] = [
    { key: 'userCode', header: 'Code', accessor: (r) => r.userCode },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">
            {r.name}
          </p>
          <p className="text-xs text-slate-400">{r.username}</p>
        </div>
      ),
    },
    { key: 'email', header: 'Email', accessor: (r) => r.email },
    { key: 'mobile', header: 'Mobile', accessor: (r) => r.mobile },
    {
      key: 'companies',
      header: 'Companies',
      render: (r) => {
        const list = r.companies ?? [];
        if (list.length === 0)
          return <span className="text-xs text-slate-400">None</span>;
        return (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-slate-400" />
            <span
              className="text-sm text-slate-600 dark:text-slate-300"
              title={list.map((c) => c.name).join(', ')}
            >
              {list.length === 1 ? list[0].name : `${list.length} companies`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'securityType',
      header: 'Security',
      render: (r) => <Badge color="blue">{r.securityType}</Badge>,
    },
    {
      key: 'access',
      header: 'Access',
      render: (r) => {
        const channels: React.ReactNode[] = [];
        if (r.webEnabled)
          channels.push(
            <span
              key="w"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Web access"
            >
              <Globe className="h-3 w-3" /> Web
            </span>,
          );
        if (r.mobileEnabled)
          channels.push(
            <span
              key="m"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Mobile access"
            >
              <Smartphone className="h-3 w-3" /> Mobile
            </span>,
          );
        return channels.length ? (
          <div className="flex flex-wrap gap-1">{channels}</div>
        ) : (
          <span className="text-xs text-slate-400">None</span>
        );
      },
    },
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

  const showMac = form.securityType === 'MAC' || form.securityType === 'MACOTP';

  // Companies the user has access to, in catalog order, for the groups section.
  const selectedCompanies = companies.filter((c) =>
    form.companyIds.includes(c.id),
  );

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Users & Data Security"
        description="Manage system users, security and group assignments"
        icon={<Users className="h-5 w-5" />}
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
        rows={users}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={load}
        search={search}
        onSearchChange={setSearch}
        serverSearch
        searchPlaceholder="Search users..."
        onView={openView}
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
            // The super admin account is permanently locked — never offer unlock.
            canUnlock={r.isSuperAdmin ? false : canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No users found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View User' : editing ? 'Edit User' : 'New User'}
        subtitle="User & data security"
        icon={<Users className="h-5 w-5" />}
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
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="User Code"
              required
              value={form.userCode}
              onChange={(e) =>
                setForm({ ...form, userCode: e.target.value })
              }
            />
            <Input
              label="Username"
              required
              value={form.username}
              onChange={(e) =>
                setForm({ ...form, username: e.target.value })
              }
            />
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label={editing ? 'Password (leave blank to keep)' : 'Password'}
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm({ ...form, password: e.target.value })
              }
              autoComplete="new-password"
            />
            <Input
              label="Mobile"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            />
          </div>

          {/* Security */}
          <div className="card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <ShieldCheck className="h-4 w-4 text-brand-600" /> Data Security
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Security Type"
                value={form.securityType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    securityType: e.target.value as SecurityType,
                  })
                }
                options={[
                  { value: 'PASSWORD', label: 'Password' },
                  { value: 'MAC', label: 'MAC' },
                  { value: 'MACOTP', label: 'MAC + OTP' },
                ]}
              />
              <div className="sm:col-span-2">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <Smartphone className="h-3.5 w-3.5" /> Access Channels
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <Checkbox
                    label="Web App"
                    checked={form.webEnabled}
                    onChange={(e) =>
                      setForm({ ...form, webEnabled: e.target.checked })
                    }
                  />
                  <Checkbox
                    label="Mobile App"
                    checked={form.mobileEnabled}
                    onChange={(e) =>
                      setForm({ ...form, mobileEnabled: e.target.checked })
                    }
                  />
                  <span className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
                  <Checkbox
                    label="Active"
                    checked={form.isActive}
                    onChange={(e) =>
                      setForm({ ...form, isActive: e.target.checked })
                    }
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  Web-only users can sign in here; mobile-only users use the
                  mobile app. Enable both for full access.
                </p>
              </div>
              {showMac && (
                <>
                  <Input
                    label="Computer MAC"
                    value={form.computerMac}
                    onChange={(e) =>
                      setForm({ ...form, computerMac: e.target.value })
                    }
                    placeholder="00:1A:2B:3C:4D:5E"
                  />
                  <Input
                    label="Mobile MAC"
                    value={form.mobileMac}
                    onChange={(e) =>
                      setForm({ ...form, mobileMac: e.target.value })
                    }
                  />
                </>
              )}
            </div>
          </div>

          {/* Company access + default */}
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Building2 className="h-4 w-4 text-brand-600" /> Company Access
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Select the companies this user can log into. Mark one as the
              default company that loads automatically at login.
            </p>
            {companies.length === 0 ? (
              <p className="text-sm text-slate-400">No companies available</p>
            ) : (
              <div className="space-y-1.5">
                {companies.map((c) => {
                  const active = form.companyIds.includes(c.id);
                  const isDefault = form.defaultCompanyId === c.id;
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition',
                        active
                          ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                      )}
                    >
                      <Checkbox
                        label={`${c.name} (${c.code})`}
                        checked={active}
                        onChange={() => toggleCompany(c.id)}
                      />
                      {active && (
                        <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <input
                            type="radio"
                            name="defaultCompany"
                            className="h-3.5 w-3.5 border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                            checked={isDefault}
                            onChange={() => setDefaultCompany(c.id)}
                          />
                          Default
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Access per company: groups + assigned modules (collapsible) */}
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <ShieldCheck className="h-4 w-4 text-brand-600" /> Access per
              Company
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              For each company, first pick the user&apos;s groups; the modules
              those groups manage then appear below to assign. The top module
              dropdown shows the modules selected here. Mark one as
              &ldquo;Default&rdquo; to load it automatically when the user
              enters that company.
            </p>
            {selectedCompanies.length === 0 ? (
              <p className="text-sm text-slate-400">
                Select a company above to configure its access.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedCompanies.map((c) => {
                  const groups = groupsByCompany[c.id];
                  const enabledMods = modulesByCompany[c.id];
                  const hasGroupSelected = (groups ?? []).some((g) =>
                    form.groupIds.includes(g.id),
                  );
                  // Modules offered = enabled ∩ managed by the selected groups.
                  const mods =
                    groups === undefined || enabledMods === undefined
                      ? undefined
                      : (() => {
                          const allowed = availableModuleIds(c.id, form.groupIds);
                          return enabledMods.filter((m) => allowed.has(m.id));
                        })();
                  const assigned = form.moduleAssignments[c.id] ?? [];
                  const isOpen = expanded[c.id] ?? true;
                  return (
                    <div
                      key={c.id}
                      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
                    >
                      {/* Collapsible header */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(c.id)}
                        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800"
                      >
                        <Building2 className="h-4 w-4 flex-none text-brand-600" />
                        <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                          {c.name}{' '}
                          <span className="text-xs font-normal text-slate-400">
                            ({c.code})
                          </span>
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          {assigned.length}/{mods?.length ?? 0} modules
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 flex-none text-slate-400 transition-transform',
                            isOpen && 'rotate-180',
                          )}
                        />
                      </button>

                      {isOpen && (
                        <div className="space-y-4 px-3 py-3">
                          {/* Groups */}
                          <div>
                            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <ShieldCheck className="h-3.5 w-3.5" /> User Groups
                            </p>
                            {groups === undefined ? (
                              <p className="text-sm text-slate-400">
                                Loading...
                              </p>
                            ) : groups.length === 0 ? (
                              <p className="text-sm text-slate-400">
                                No groups for this company.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {groups.map((g) => {
                                  const active = form.groupIds.includes(g.id);
                                  return (
                                    <button
                                      key={g.id}
                                      type="button"
                                      onClick={() => toggleGroup(g.id)}
                                      className={cn(
                                        'rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                                        active
                                          ? 'border-brand-600 bg-brand-600 text-white'
                                          : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                                      )}
                                    >
                                      {g.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Modules */}
                          <div>
                            <div className="mb-2 flex items-center justify-between">
                              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <Layers className="h-3.5 w-3.5" /> Modules
                              </p>
                              {mods && mods.length > 0 && (
                                <div className="flex items-center gap-2 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => setAllModules(c.id, true)}
                                    className="font-medium text-brand-600 hover:underline"
                                  >
                                    All
                                  </button>
                                  <span className="text-slate-300">|</span>
                                  <button
                                    type="button"
                                    onClick={() => setAllModules(c.id, false)}
                                    className="font-medium text-slate-500 hover:underline"
                                  >
                                    None
                                  </button>
                                </div>
                              )}
                            </div>
                            {mods === undefined ? (
                              <p className="text-sm text-slate-400">
                                Loading...
                              </p>
                            ) : !hasGroupSelected ? (
                              <p className="text-sm text-slate-400">
                                Select a user group above to choose modules.
                              </p>
                            ) : mods.length === 0 ? (
                              <p className="text-sm text-slate-400">
                                The selected group(s) manage no modules here.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                {mods.map((m) => {
                                  const MIcon = resolveIcon(m.icon);
                                  const active = assigned.includes(m.id);
                                  const isDefault =
                                    form.defaultModuleByCompany[c.id] === m.id;
                                  return (
                                    <div
                                      key={m.id}
                                      className={cn(
                                        'flex items-center gap-2 rounded-lg border px-3 py-2 transition',
                                        active
                                          ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/40',
                                      )}
                                    >
                                      <label className="flex flex-1 cursor-pointer items-center gap-2">
                                        <Checkbox
                                          checked={active}
                                          onChange={() =>
                                            toggleModule(c.id, m.id)
                                          }
                                        />
                                        <MIcon className="h-4 w-4 flex-none text-slate-500 dark:text-slate-400" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                          {m.name}
                                        </span>
                                      </label>
                                      {active && (
                                        <label
                                          className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
                                          title="Load this module automatically in this company"
                                        >
                                          <input
                                            type="radio"
                                            name={`defaultModule-${c.id}`}
                                            className="h-3.5 w-3.5 border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                                            checked={isDefault}
                                            onChange={() =>
                                              setDefaultModule(c.id, m.id)
                                            }
                                          />
                                          Default
                                        </label>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Branches — only for branch-applicable companies */}
                          {c.branchApplicable && (
                            <div>
                              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <GitBranch className="h-3.5 w-3.5" /> Branches
                              </p>
                              {branchesByCompany[c.id] === undefined ? (
                                <p className="text-sm text-slate-400">
                                  Loading...
                                </p>
                              ) : branchesByCompany[c.id].length === 0 ? (
                                <p className="text-sm text-slate-400">
                                  No branches defined for this company.
                                </p>
                              ) : (
                                <>
                                  <div className="flex flex-wrap gap-2">
                                    {branchesByCompany[c.id].map((b) => {
                                      const active = form.branchIds.includes(
                                        b.id,
                                      );
                                      return (
                                        <button
                                          key={b.id}
                                          type="button"
                                          onClick={() =>
                                            toggleBranch(b.id, c.id)
                                          }
                                          className={cn(
                                            'rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                                            active
                                              ? 'border-brand-600 bg-brand-600 text-white'
                                              : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                                          )}
                                        >
                                          {b.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {/* Default branch among the selected ones */}
                                  {(() => {
                                    const selected = branchesByCompany[
                                      c.id
                                    ].filter((b) =>
                                      form.branchIds.includes(b.id),
                                    );
                                    if (selected.length === 0) return null;
                                    return (
                                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <span className="font-medium">
                                          Default branch:
                                        </span>
                                        {selected.map((b) => (
                                          <label
                                            key={b.id}
                                            className="inline-flex cursor-pointer select-none items-center gap-1.5"
                                          >
                                            <input
                                              type="radio"
                                              name={`defaultBranch-${c.id}`}
                                              className="h-3.5 w-3.5 border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                                              checked={form.defaultBranchIds.includes(
                                                b.id,
                                              )}
                                              onChange={() =>
                                                setDefaultBranch(b.id, c.id)
                                              }
                                            />
                                            {b.name}
                                          </label>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Textarea
            label="Remarks"
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
        </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
