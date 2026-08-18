'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
  Building2,
  Layers,
  ChevronDown,
  Smartphone,
  Globe,
  GitBranch,
  Bell,
  KeyRound,
  Trash2,
  UserPlus,
  UserCheck,
  UserX,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { resolveIcon } from '@/lib/icons';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Badge } from '@/components/ui/Badge';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import type {
  AppUser,
  Company,
  CompanyModule,
  UserGroup,
  SecurityType,
  Branch,
  AlertCategory,
  AlertPreference,
} from '@/lib/types';

/**
 * A login, and everything it can reach: security, the companies it may enter,
 * the role (user group) it holds in each, the modules and branches that follow
 * from that role, and which alerts reach it.
 *
 * ONE implementation, two hosts. Logins are set up on the person's own record —
 * HR → Employee Master → User Access — because an account with nobody behind it
 * is how a login outlives the person who held it. Cpanel → Users & Data Security
 * mounts the same panel read-only, so it stays the register of who has access
 * without being a second place to grant it.
 *
 * Privileges themselves are NOT here: they belong to the user group, one set per
 * role rather than per person, and are edited in Cpanel → User Groups &
 * Privileges. Picking the role here is what decides what this person can do.
 */

/**
 * The alert kinds an admin can switch on or off per user, in the order the
 * Alerts screen lists them. Labelled for somebody administering a user rather
 * than reading their own bell — "Approvals" is the category, not the screen.
 *
 * PAYMENT and LEAVE are here with no publisher behind them yet (Accounts and HR
 * will raise them); a category that exists in the model and not in the editor
 * would be one nobody could ever switch off.
 */
const ALERT_CATEGORIES: { key: AlertCategory; label: string }[] = [
  { key: 'APPROVAL', label: 'Approvals' },
  { key: 'TASK', label: 'Tasks' },
  { key: 'STOCK', label: 'Stock' },
  { key: 'EXPIRY', label: 'Expiry' },
  { key: 'PAYMENT', label: 'Payments' },
  { key: 'LEAVE', label: 'Leave' },
  { key: 'MESSAGE', label: 'Messages' },
  { key: 'SYSTEM', label: 'System' },
];

/** Everything on — what no stored row means, and so what a new user gets. */
const allAlertsOn = (): Record<AlertCategory, boolean> =>
  Object.fromEntries(ALERT_CATEGORIES.map((c) => [c.key, true])) as Record<
    AlertCategory,
    boolean
  >;

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
  // Which alert categories reach this user. Saved through the notification
  // module's own endpoint after the user is saved, not in the user payload —
  // alerts are a different domain, and the User service has no business
  // writing its rows.
  alertPrefs: allAlertsOn(),
};

/** The employee a login belongs to, as much of them as this panel needs. */
export interface UserAccessEmployee {
  id: number;
  code: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Where they work — the company their login starts out able to enter. */
  companyId?: number;
  branchId?: number | null;
}

export interface UserAccessPanelProps {
  /** The login as it stands, or null where this employee has none yet. */
  user: AppUser | null;
  /** Who it belongs to. Required before one can be created. */
  employee?: UserAccessEmployee | null;
  /**
   * Show, do not touch. True on the Cpanel register, and for anybody who is not
   * a super admin — granting access is still a super admin's to do, whichever
   * screen it is done from.
   */
  readOnly?: boolean;
  /** After a successful save, with the login as it now stands. */
  onSaved?: (user: AppUser) => void;
  /** After the login has been deleted. */
  onDeleted?: () => void;
  /**
   * Whether there is unsaved work in here. Told to the host so the drawer
   * around this panel can ask before closing on top of it — pass a stable
   * function (a setState is ideal), since it is called from an effect.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

export function UserAccessPanel({
  user,
  employee,
  readOnly = false,
  onSaved,
  onDeleted,
  onDirtyChange,
}: UserAccessPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user: signedIn } = useAuth();

  /**
   * Nobody switches off the account they are signed in with.
   *
   * The server checks `isActive` on every request, not only at sign-in, so this
   * would take the administrator's own next click away from them — including
   * the one that would put it back.
   */
  const isSelf = !!user && !!signedIn && user.id === signedIn.id;

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

  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  /** True while the activate / deactivate switch is being written. */
  const [switching, setSwitching] = useState(false);
  /**
   * True once "Give this employee a login" has been pressed. Until then an
   * employee with no account sees a short invitation rather than a blank form —
   * most staff never sign in, so an empty login form is the wrong default.
   */
  const [creating, setCreating] = useState(false);
  /** Which login the async preference fetch belongs to. */
  const loadedRef = useRef<number | null>(null);

  /**
   * The form as it stood when it was last loaded or saved.
   *
   * Compared against, rather than a touched-a-field flag, because this decides
   * whether SAVE is offered: a field clicked into and back out of has changed
   * nothing, and a button that lights up for it invites a pointless write. It
   * also has to go quiet again after saving, which a touch flag cannot do.
   */
  const baselineRef = useRef('');
  const snapshot = JSON.stringify(form);
  // Empty until the form has been loaded, which is one render later than the
  // first — and an unloaded form is not unsaved work, it is nothing yet.
  const dirty = baselineRef.current !== '' && snapshot !== baselineRef.current;

  /** Is there a form on screen at all? */
  const showForm = user != null || creating;

  // Let the host know, so the drawer around this panel can ask before closing
  // on top of unsaved work. Only while a form is actually on screen: the
  // invitation to create a login has nothing to lose.
  useEffect(() => {
    onDirtyChange?.(showForm && dirty);
  }, [showForm, dirty, onDirtyChange]);

  // Anything left unsaved goes when the panel does — switching tabs unmounts
  // it, and a host still holding `true` would guard work that is already gone.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    api
      .get<Company[]>('/companies')
      .then((c) => setCompanies(c ?? []))
      .catch(() => {});
  }, []);

  // ------------------------------------------------------------- load form --

  /** A blank login, seeded from the employee it will belong to. */
  const seeded = useCallback((): typeof empty => {
    const companyIds = employee?.companyId ? [employee.companyId] : [];
    return {
      ...empty,
      // Their employee code doubles as the user code: one identifier per person
      // beats two that have to be kept in step.
      userCode: employee?.code ?? '',
      name: employee?.name ?? '',
      email: employee?.email ?? '',
      mobile: employee?.phone ?? '',
      companyIds,
      defaultCompanyId: companyIds[0] ?? null,
      branchIds: employee?.branchId ? [employee.branchId] : [],
      defaultBranchIds: employee?.branchId ? [employee.branchId] : [],
      alertPrefs: allAlertsOn(),
      moduleAssignments: {},
      defaultModuleByCompany: {},
    };
  }, [employee]);

  /**
   * Put a form on screen and treat it as the saved state. Everything that is
   * not a user edit goes through here, so "dirty" means somebody typed.
   */
  const load = useCallback((next: typeof empty) => {
    baselineRef.current = JSON.stringify(next);
    setForm(next);
  }, []);

  /**
   * Fold in data that ARRIVED rather than was typed — late-loading alert
   * preferences, a module list pruned to what the chosen roles allow.
   *
   * Rebased only while nothing has been typed yet: doing it unconditionally
   * would absorb a fast typist's change into the baseline and lose their work
   * to a Close that never asked.
   */
  const settle = useCallback((next: typeof empty, previous: typeof empty) => {
    if (JSON.stringify(previous) === baselineRef.current) {
      baselineRef.current = JSON.stringify(next);
    }
    return next;
  }, []);

  useEffect(() => {
    if (!user) {
      loadedRef.current = null;
      load(seeded());
      setExpanded(
        Object.fromEntries(
          (employee?.companyId ? [employee.companyId] : []).map((id) => [
            id,
            true,
          ]),
        ),
      );
      return;
    }

    const companyIds =
      user.companyIds ?? user.companies?.map((c) => c.id) ?? [];
    const defaultCompanyId =
      user.defaultCompanyId ??
      user.companies?.find((c) => c.isDefault)?.id ??
      null;
    const moduleAssignments: Record<number, number[]> = {};
    const defaultModuleByCompany: Record<number, number | null> = {};
    for (const a of user.moduleAssignments ?? []) {
      moduleAssignments[a.companyId] = a.moduleIds;
      defaultModuleByCompany[a.companyId] = a.defaultModuleId ?? null;
    }
    setExpanded(Object.fromEntries(companyIds.map((id) => [id, true])));
    load({
      userCode: user.userCode,
      username: user.username,
      name: user.name,
      email: user.email ?? '',
      password: '',
      mobile: user.mobile ?? '',
      mobileMac: user.mobileMac ?? '',
      webEnabled: user.webEnabled,
      mobileEnabled: user.mobileEnabled ?? false,
      computerMac: user.computerMac ?? '',
      securityType: user.securityType,
      isActive: user.isActive,
      remarks: user.remarks ?? '',
      companyIds,
      defaultCompanyId,
      groupIds: user.groupIds ?? user.groups?.map((g) => g.id) ?? [],
      branchIds: user.branchIds ?? [],
      defaultBranchIds: user.defaultBranchIds ?? [],
      moduleAssignments,
      defaultModuleByCompany,
      // Replaced when the fetch below lands. Starting from all-on rather than
      // blank means the boxes never render in a state this user is not in:
      // no stored row IS on.
      alertPrefs: allAlertsOn(),
    });
    setCreating(false);

    // Alert preferences live in the notification module, so they are fetched
    // beside the user rather than arriving with it.
    loadedRef.current = user.id;
    api
      .get<AlertPreference[]>(`/notifications/preferences/${user.id}`)
      .then((rows) => {
        // Opening a second login before the first one's preferences arrive
        // would otherwise paint one person's settings onto another.
        if (loadedRef.current !== user.id) return;
        setForm((f) =>
          settle(
            {
              ...f,
              alertPrefs: {
                ...allAlertsOn(),
                ...Object.fromEntries(rows.map((r) => [r.category, r.inApp])),
              },
            },
            f,
          ),
        );
      })
      .catch(() => {
        // Leave the defaults showing; saving still writes what is on screen.
      });
  }, [user, employee, seeded, load, settle]);

  // ------------------------------------------------------ lazy access data --

  // Fetch groups for every selected company (only the ones not yet loaded).
  useEffect(() => {
    if (!showForm) return;
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
  }, [showForm, form.companyIds, groupsByCompany]);

  // Fetch the enabled modules for every selected company (lazy, cached).
  useEffect(() => {
    if (!showForm) return;
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
  }, [showForm, form.companyIds, modulesByCompany]);

  // Fetch branches for every selected branch-applicable company (lazy, cached).
  useEffect(() => {
    if (!showForm) return;
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
  }, [showForm, form.companyIds, companies, branchesByCompany]);

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
    // Never normalize in read-only mode — the panel must show exactly what is
    // saved, not a re-pruned version of it.
    if (!showForm || readOnly) return;
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
          def != null && pruned.includes(def) ? def : (pruned[0] ?? null);
        if (newDef !== def) {
          nextDefaults[cid] = newDef;
          changed = true;
        }
      }
      // Pruning is the data arriving, not somebody editing — a login opened and
      // left alone must not offer to save itself.
      return changed
        ? settle(
            {
              ...f,
              moduleAssignments: next,
              defaultModuleByCompany: nextDefaults,
            },
            f,
          )
        : f;
    });
  }, [
    showForm,
    readOnly,
    settle,
    form.groupIds,
    form.companyIds,
    groupsByCompany,
    modulesByCompany,
    availableModuleIds,
  ]);

  // ---------------------------------------------------------------- edits --

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

  const setDefaultCompany = (id: number) =>
    setForm((f) => ({ ...f, defaultCompanyId: id }));

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

  const setDefaultModule = (companyId: number, moduleId: number) =>
    setForm((f) => ({
      ...f,
      defaultModuleByCompany: {
        ...f.defaultModuleByCompany,
        [companyId]: moduleId,
      },
    }));

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

  // ----------------------------------------------------------------- save --

  const save = async () => {
    if (!employee && !user) {
      toast.error('Open an employee before setting up their login.');
      return;
    }
    if (!form.userCode.trim() || !form.username.trim() || !form.name.trim()) {
      toast.error('User Code, Username and Name are required.');
      return;
    }
    if (!user && !form.password.trim() && form.securityType === 'PASSWORD') {
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
        // Who this login belongs to. Sent on every save, not just the first:
        // the server re-checks it, and that is what keeps an account from
        // outliving the employee record behind it.
        employeeId: user?.employeeId ?? employee?.id,
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

      const saved = user
        ? await api.patch<AppUser>(`/users/${user.id}`, payload)
        : await api.post<AppUser>('/users', payload);
      toast.success(user ? 'Login updated.' : 'Login created.');

      // Alerts, second and separately: they belong to the notification module,
      // which the User service has no business writing for. Only after the user
      // exists — a new one has no id until then. A failure here does not undo
      // the save, so it says exactly what did not apply rather than implying
      // the whole thing failed.
      try {
        await api.put(`/notifications/preferences/${saved.id}`, {
          items: ALERT_CATEGORIES.map(({ key }) => ({
            category: key,
            inApp: form.alertPrefs[key] ?? true,
          })),
        });
      } catch {
        toast.error('The login was saved, but its alert settings were not.');
      }

      // Saved is the new baseline, so the button goes quiet until something
      // else is typed. The password box is cleared with it — it is write-only,
      // and leaving the typed one on screen would make a saved form look
      // different from what was stored.
      setForm((f) => {
        const next = { ...f, password: '' };
        baselineRef.current = JSON.stringify(next);
        return next;
      });
      setCreating(false);
      onSaved?.(saved);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Switch a login off, or back on again.
   *
   * The answer to "this person has gone on leave / is under investigation /
   * has left, but their work must stay theirs". Removing the login destroys the
   * account; deactivating keeps it, its roles and everything raised in its name
   * intact, and simply refuses the sign-in. Reversible in one click, which is
   * exactly what removal is not.
   *
   * It writes ON ITS OWN rather than waiting for Save — suspending access is
   * something an administrator does NOW, and making it wait behind an unrelated
   * half-finished edit is how somebody stays signed in who should not be. The
   * server refuses the next request as well as the next sign-in, so it takes
   * effect on a session already open.
   */
  const setLoginActive = async (next: boolean) => {
    if (!user || isSelf) return;
    const ok = await confirm({
      title: next ? 'Activate login' : 'Deactivate login',
      message: next
        ? `Let "${user.username}" sign in again? Everything the account had — its companies, roles and modules — is still as it was.`
        : `Stop "${user.username}" signing in? The account and everything raised in its name stays; ${user.name} simply cannot get in until it is activated again. Any session they have open stops working at once.`,
      danger: !next,
      confirmText: next ? 'Activate' : 'Deactivate',
    });
    if (!ok) return;
    // Read before the awaits: whether there is unsaved work decides what may be
    // handed back to the host below.
    const wasDirty = dirty;
    setSwitching(true);
    try {
      const saved = await api.patch<AppUser>(`/users/${user.id}`, {
        isActive: next,
      });
      toast.success(next ? 'Login activated.' : 'Login deactivated.');
      // Fold the new state into the form AND into the baseline, so the switch
      // itself never reads as unsaved work — while anything actually typed
      // stays both on screen and still unsaved.
      setForm((f) => {
        const base = baselineRef.current
          ? (JSON.parse(baselineRef.current) as typeof empty)
          : f;
        baselineRef.current = JSON.stringify({ ...base, isActive: next });
        return { ...f, isActive: next };
      });
      // Telling the host re-seeds this form from the server, which would throw
      // away a half-finished edit. Left to the next Save when there is one.
      if (!wasDirty) onSaved?.(saved);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSwitching(false);
    }
  };

  const removeLogin = async () => {
    if (!user) return;
    const ok = await confirm({
      title: 'Remove login',
      message: `Remove the login "${user.username}"? ${user.name} stays on the employee register — they simply lose their way in.`,
      danger: true,
      confirmText: 'Remove login',
    });
    if (!ok) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('Login removed.');
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  // ----------------------------------------------------------------- view --

  const showMac = form.securityType === 'MAC' || form.securityType === 'MACOTP';

  // Companies the user has access to, in catalog order, for the groups section.
  const selectedCompanies = companies.filter((c) =>
    form.companyIds.includes(c.id),
  );

  // Nobody has a login here yet, and nothing is being typed — say so plainly
  // rather than showing an empty form. Most staff never sign in.
  if (!showForm) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
        <KeyRound className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
        <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          {employee ? employee.name : 'This employee'} has no login.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
          Most staff never sign in — their attendance is marked and their leave
          raised for them. Give a login only to somebody who needs to work in
          the system themselves.
        </p>
        {!readOnly && employee && (
          <button
            type="button"
            className="btn-primary mx-auto mt-4 inline-flex items-center gap-2"
            onClick={() => setCreating(true)}
          >
            <UserPlus className="h-4 w-4" /> Give them a login
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Who this account belongs to. Not editable from either host: the link is
          made by opening the employee, and re-pointing it elsewhere is how one
          person ends up signing in as another. */}
      {(user?.employee || employee) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
          <KeyRound className="h-4 w-4 flex-none text-brand-600" />
          <span className="text-slate-500 dark:text-slate-400">Login for</span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            {user?.employee?.name ?? employee?.name}
          </span>
          <span className="font-mono text-xs text-slate-400">
            {user?.employee?.code ?? employee?.code}
          </span>
          {/* Whether they can actually get in, beside whose account it is —
              the first thing anybody opening this panel wants to know. */}
          {user && (
            <Badge color={form.isActive ? 'green' : 'red'} className="ml-auto">
              {form.isActive ? 'Login active' : 'Login deactivated'}
            </Badge>
          )}
        </div>
      )}

      {/* Said plainly as well as badged: a suspended account otherwise looks
          exactly like a working one, and "why can they not sign in" is the
          question this panel exists to answer. */}
      {user && !form.isActive && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <UserX className="mt-0.5 h-4 w-4 flex-none" />
          <p>
            This login is deactivated — {user.name} cannot sign in, on the web
            or the mobile app. Everything the account holds is untouched and
            comes back the moment it is activated again.
          </p>
        </div>
      )}

      <ReadOnlyFieldset readOnly={readOnly}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="User Code"
              required
              value={form.userCode}
              onChange={(e) => setForm({ ...form, userCode: e.target.value })}
            />
            <Input
              label="Username"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
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
              label={user ? 'Password (leave blank to keep)' : 'Password'}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
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
                  {/* Whether the account is switched on at all is NOT a
                      channel, and an existing login turns it off through the
                      button below — one place, that acts at once. Offered here
                      only while the login is being created, where there is no
                      saved account to act on yet. */}
                  {!user && (
                    <>
                      <span className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
                      <Checkbox
                        label="Active from the start"
                        checked={form.isActive}
                        onChange={(e) =>
                          setForm({ ...form, isActive: e.target.checked })
                        }
                      />
                    </>
                  )}
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
              Select the companies this user can log into — any of them, not
              only the one they are on the books of. Mark one as the default
              company that loads automatically at login.
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

          {/* Access per company: role + the modules it manages (collapsible) */}
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <ShieldCheck className="h-4 w-4 text-brand-600" /> Roles &amp;
              Access per Company
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              For each company, first pick the user&apos;s roles (user groups);
              the modules those roles manage then appear below to assign. What
              they may DO on each screen — view, add, edit, delete — comes from
              the role, and is set once per role in Cpanel &rarr; User Groups
              &amp; Privileges rather than per person here.
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
                          const allowed = availableModuleIds(
                            c.id,
                            form.groupIds,
                          );
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
                          {/* Roles */}
                          <div>
                            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <ShieldCheck className="h-3.5 w-3.5" /> Roles
                              (User Groups)
                            </p>
                            {groups === undefined ? (
                              <p className="text-sm text-slate-400">
                                Loading...
                              </p>
                            ) : groups.length === 0 ? (
                              <p className="text-sm text-slate-400">
                                No roles for this company.
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
                                Select a role above to choose modules.
                              </p>
                            ) : mods.length === 0 ? (
                              <p className="text-sm text-slate-400">
                                The selected role(s) manage no modules here.
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

          {/* Which alerts reach this user (SRS §8.11, FR-COM-05) */}
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Bell className="h-4 w-4 text-brand-600" /> Alerts
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Which kinds of alert reach this user, on the bell and the Alerts
              screen. Switched off means the alert is never raised for them —
              there is nothing kept back for them to find later. Set here rather
              than by the user, because whether somebody is told about a
              stock-out is an operational decision.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ALERT_CATEGORIES.map(({ key, label }) => {
                const on = form.alertPrefs[key] ?? true;
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition',
                      on
                        ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                    )}
                  >
                    <Checkbox
                      label={label}
                      checked={on}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          alertPrefs: { ...f.alertPrefs, [key]: !on },
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            {!user && (
              <p className="mt-2 text-xs text-slate-400">
                Applied when the login is created.
              </p>
            )}
          </div>

          <Textarea
            label="Remarks"
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
        </div>
      </ReadOnlyFieldset>

      {/* The panel's own actions. OUTSIDE the fieldset above so they are never
          disabled along with the fields they act on. */}
      {!readOnly && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          {user ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Before Remove, and the milder of the two: somebody reaching
                  for "they must not get in" should meet the reversible one
                  first. */}
              <button
                type="button"
                className={cn(
                  'btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50',
                  form.isActive ? 'text-amber-600' : 'text-emerald-600',
                )}
                onClick={() => setLoginActive(!form.isActive)}
                disabled={switching || isSelf}
                title={
                  isSelf
                    ? 'This is the login you are signed in with — switching it off would lock you out'
                    : undefined
                }
              >
                {form.isActive ? (
                  <>
                    <UserX className="h-4 w-4" />{' '}
                    {switching ? 'Deactivating…' : 'Deactivate login'}
                  </>
                ) : (
                  <>
                    <UserCheck className="h-4 w-4" />{' '}
                    {switching ? 'Activating…' : 'Activate login'}
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                onClick={removeLogin}
              >
                <Trash2 className="h-4 w-4" /> Remove login
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          )}
          {/* Nothing typed, nothing to save. Disabled rather than hidden so the
              button stays where it was and says why. */}
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={save}
            disabled={saving || !dirty}
            title={
              !dirty && !saving
                ? 'Nothing has changed since this was last saved'
                : undefined
            }
          >
            <KeyRound className="h-4 w-4" />
            {saving ? 'Saving…' : user ? 'Save login' : 'Create login'}
          </button>
        </div>
      )}
    </div>
  );
}
