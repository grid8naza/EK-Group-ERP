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
} from '@/lib/api';
import type {
  User,
  NavModule,
  Permissions,
  LoginResponse,
  MeResponse,
  Permission,
  CompanyLite,
} from '@/lib/types';

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
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null);

  // Apply a login/me payload to state, keeping the company header in sync.
  const applyProfile = useCallback(
    (p: {
      user: User;
      companies: CompanyLite[];
      activeCompanyId: number | null;
      navigation: NavModule[];
      permissions: Permissions;
    }) => {
      setUser(p.user);
      setCompanies(p.companies || []);
      setActiveCompanyId(p.activeCompanyId);
      setCompanyId(p.activeCompanyId); // persist for the X-Company-Id header
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
        router.replace('/');
      } finally {
        setLoading(false);
      }
    },
    [activeCompanyId, applyProfile, router],
  );

  const activeModule = useMemo(
    () => navigation.find((m) => m.id === activeModuleId) ?? null,
    [navigation, activeModuleId],
  );
  const activeCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId) ?? null,
    [companies, activeCompanyId],
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
      router.replace('/');
    },
    [router, applyProfile],
  );

  const logout = useCallback(() => {
    clearToken();
    setCompanyId(null);
    setUser(null);
    setNavigation([]);
    setPermissions({});
    setCompanies([]);
    setActiveCompanyId(null);
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
