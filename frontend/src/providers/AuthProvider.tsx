'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  api,
  getToken,
  setToken,
  clearToken,
  getCompanyId,
  setCompanyId,
  setBranchId,
} from '@/lib/api';
import type {
  User,
  NavModule,
  Permissions,
  LoginResponse,
  MeResponse,
  Permission,
  CompanyLite,
  BranchLite,
} from '@/lib/types';
import { moduleLandingRoute } from '@/lib/nav';

interface AuthContextValue {
  user: User | null;
  navigation: NavModule[];
  permissions: Permissions;
  loading: boolean;
  /** Companies this user can access + the active one. */
  companies: CompanyLite[];
  activeCompanyId: number | null;
  activeCompany: CompanyLite | null;
  switchCompany: (id: number) => Promise<void>;
  /** Branches of the active company this user can access + the active one.
   * Empty unless the active company is branch-applicable. */
  branches: BranchLite[];
  activeBranchId: number | null;
  activeBranch: BranchLite | null;
  switchBranch: (id: number) => Promise<void>;
  /** Re-fetch the profile for the active company/branch (e.g. after branches
   * change in Company Master) so the top-bar switcher stays in sync. */
  refreshProfile: () => Promise<void>;
  /** Currently selected module (drives the sidebar). */
  activeModule: NavModule | null;
  activeModuleId: number | null;
  setActiveModule: (id: number) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (route: string, action: keyof Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PUBLIC_ROUTES = ['/login'];
const ACTIVE_MODULE_KEY = 'erpgrip.activeModule';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [navigation, setNavigation] = useState<NavModule[]>([]);
  const [permissions, setPermissions] = useState<Permissions>({});
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<number | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null);

  // Apply a login/me payload to state, keeping the company header in sync.
  const applyProfile = useCallback(
    (p: {
      user: User;
      companies: CompanyLite[];
      activeCompanyId: number | null;
      branches?: BranchLite[];
      activeBranchId?: number | null;
      navigation: NavModule[];
      permissions: Permissions;
    }) => {
      setUser(p.user);
      setCompanies(p.companies || []);
      setActiveCompanyId(p.activeCompanyId);
      setCompanyId(p.activeCompanyId); // persist for the X-Company-Id header
      setBranches(p.branches || []);
      setActiveBranchId(p.activeBranchId ?? null);
      setBranchId(p.activeBranchId ?? null); // persist for the X-Branch-Id header
      setNavigation(p.navigation || []);
      setPermissions(p.permissions || {});
    },
    [],
  );

  const bootstrap = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      // getCompanyId() (if stored) is sent as X-Company-Id automatically.
      const me = await api.get<MeResponse>('/auth/me', { silent401: true });
      applyProfile(me);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [applyProfile]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Keep a valid active module selected for the active company's navigation.
  useEffect(() => {
    if (!navigation.length) {
      setActiveModuleId(null);
      return;
    }
    setActiveModuleId((cur) => {
      if (cur && navigation.some((m) => m.id === cur)) return cur;
      const byPath = navigation.find(
        (m) =>
          m.menus.some((menu) => menu.items.some((it) => it.route === pathname)) ||
          (m.dashboards ?? []).some((d) => d.route === pathname),
      );
      if (byPath) return byPath.id;
      const def = user?.defaultModuleId ?? null;
      if (def && navigation.some((m) => m.id === def)) return def;
      let stored: number | null = null;
      try {
        stored = Number(localStorage.getItem(ACTIVE_MODULE_KEY)) || null;
      } catch {
        stored = null;
      }
      if (stored && navigation.some((m) => m.id === stored)) return stored;
      return navigation[0].id;
    });
  }, [navigation, pathname, user]);

  const setActiveModule = useCallback((id: number) => {
    setActiveModuleId(id);
    try {
      localStorage.setItem(ACTIVE_MODULE_KEY, String(id));
    } catch {
      /* ignore */
    }
  }, []);

  const switchCompany = useCallback(
    async (id: number) => {
      if (id === activeCompanyId) return;
      setLoading(true);
      setCompanyId(id); // header switches before we refetch the profile
      try {
        const me = await api.get<MeResponse>('/auth/me');
        applyProfile(me);
        setActiveModuleId(null); // recomputed from the new company's nav
        // Land on the new active module's default dashboard. The active module
        // is the user's per-company default (me.user.defaultModuleId) or the
        // first available module.
        const nav = me.navigation || [];
        const defId = me.user?.defaultModuleId ?? null;
        const mod =
          (defId ? nav.find((m) => m.id === defId) : undefined) ??
          nav[0] ??
          null;
        router.replace(moduleLandingRoute(mod));
      } finally {
        setLoading(false);
      }
    },
    [activeCompanyId, applyProfile, router],
  );

  // Switching branch changes which dashboards are visible (dashboards are
  // branch-scoped), so refetch the profile with the new X-Branch-Id and
  // re-apply nav/permissions. Only redirect when the current page is a
  // dashboard route that may no longer exist for the new branch — otherwise
  // leave the user where they are (e.g. mid-form on a cpanel screen).
  const switchBranch = useCallback(
    async (id: number) => {
      if (id === activeBranchId) return;
      setLoading(true);
      setBranchId(id); // header switches before we refetch
      try {
        const me = await api.get<MeResponse>('/auth/me');
        applyProfile(me);
        if (pathname.startsWith('/dashboard/')) {
          const nav = me.navigation || [];
          const defId = me.user?.defaultModuleId ?? null;
          const mod =
            (defId ? nav.find((m) => m.id === defId) : undefined) ??
            nav[0] ??
            null;
          router.replace(moduleLandingRoute(mod));
        }
      } finally {
        setLoading(false);
      }
    },
    [activeBranchId, applyProfile, pathname, router],
  );

  // Re-fetch the profile for the current company/branch headers. Used after
  // mutations that change what the switchers should show (e.g. adding or
  // removing a company's branches), so the UI doesn't need a manual reload.
  const refreshProfile = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/auth/me');
      applyProfile(me);
    } catch {
      /* ignore — a failed refresh just leaves the prior state in place */
    }
  }, [applyProfile]);

  const activeModule = useMemo(
    () => navigation.find((m) => m.id === activeModuleId) ?? null,
    [navigation, activeModuleId],
  );
  const activeCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId) ?? null,
    [companies, activeCompanyId],
  );
  const activeBranch = useMemo(
    () => branches.find((b) => b.id === activeBranchId) ?? null,
    [branches, activeBranchId],
  );

  // Redirect guard.
  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_ROUTES.includes(pathname);
    if (!user && !isPublic) {
      router.replace('/login');
    } else if (user && isPublic) {
      router.replace('/');
    }
  }, [loading, user, pathname, router]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.post<LoginResponse>('/auth/login', {
        username,
        password,
      });
      setToken(res.token);
      applyProfile(res);
      // Land directly on the default module's default dashboard.
      const nav = res.navigation || [];
      const defId = res.user?.defaultModuleId ?? null;
      const mod =
        (defId ? nav.find((m) => m.id === defId) : undefined) ??
        nav[0] ??
        null;
      router.replace(moduleLandingRoute(mod));
    },
    [router, applyProfile],
  );

  const logout = useCallback(() => {
    clearToken();
    setCompanyId(null);
    setBranchId(null);
    setUser(null);
    setNavigation([]);
    setPermissions({});
    setCompanies([]);
    setActiveCompanyId(null);
    setBranches([]);
    setActiveBranchId(null);
    setActiveModuleId(null);
    router.replace('/login');
  }, [router]);

  const can = useCallback(
    (route: string, action: keyof Permission) => {
      if (user?.isSuperAdmin) return true;
      const p = permissions[route];
      if (!p) return false;
      return !!p[action];
    },
    [user, permissions],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        navigation,
        permissions,
        loading,
        companies,
        activeCompanyId,
        activeCompany,
        switchCompany,
        branches,
        activeBranchId,
        activeBranch,
        switchBranch,
        refreshProfile,
        activeModule,
        activeModuleId,
        setActiveModule,
        login,
        logout,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
