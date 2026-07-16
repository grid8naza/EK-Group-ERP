'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  ChevronDown,
  UserCircle,
  LayoutGrid,
  Building2,
  GitBranch,
  Check,
  Bell,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { resolveIcon } from '@/lib/icons';
import { mediaUrl } from '@/lib/login-screen';
import { initials, cn, formatDate } from '@/lib/utils';
import { moduleLandingRoute } from '@/lib/nav';
import { api } from '@/lib/api';
import type { WorkflowNotification } from '@/lib/types';

interface TopbarProps {
  onToggleSidebar: () => void;
  onToggleMobile: () => void;
  collapsed: boolean;
}

export function Topbar({
  onToggleSidebar,
  onToggleMobile,
  collapsed,
}: TopbarProps) {
  const router = useRouter();
  const {
    user,
    logout,
    navigation,
    activeModule,
    setActiveModule,
    companies,
    activeCompany,
    switchCompany,
    branches,
    activeBranch,
    switchBranch,
  } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [coOpen, setCoOpen] = useState(false);
  const [brOpen, setBrOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [coLogoBroken, setCoLogoBroken] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const modRef = useRef<HTMLDivElement>(null);
  const coRef = useRef<HTMLDivElement>(null);
  const brRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Workflow notifications: unread count polls every 30s; the list is loaded
  // lazily when the bell dropdown is opened.
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<WorkflowNotification[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get<{ count: number }>(
          '/workflow/notifications/unread-count',
        );
        if (alive) setUnread(res.count);
      } catch {
        // ignore — transient/unauthorized fetches shouldn't disrupt the topbar
      }
    };
    void load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Retry the company logo image whenever the active company changes.
  useEffect(() => {
    setCoLogoBroken(false);
  }, [activeCompany?.logo]);

  const openNotifications = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (!next) return;
    try {
      const list = await api.get<WorkflowNotification[]>(
        '/workflow/notifications',
      );
      setNotifs(list);
    } catch {
      // ignore
    }
  };

  const openNotification = async (n: WorkflowNotification) => {
    setNotifOpen(false);
    if (!n.isRead) {
      try {
        await api.post(`/workflow/notifications/${n.id}/read`);
        setUnread((c) => Math.max(0, c - 1));
      } catch {
        // ignore
      }
    }
    router.push('/workflow/approvals');
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (modRef.current && !modRef.current.contains(e.target as Node)) {
        setModOpen(false);
      }
      if (coRef.current && !coRef.current.contains(e.target as Node)) {
        setCoOpen(false);
      }
      if (brRef.current && !brRef.current.contains(e.target as Node)) {
        setBrOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectModule = (id: number) => {
    setActiveModule(id);
    setModOpen(false);
    const mod = navigation.find((m) => m.id === id);
    // Land on the module's default dashboard (falls back to first menu/dash).
    router.push(moduleLandingRoute(mod));
  };

  const selectCompany = (id: number) => {
    setCoOpen(false);
    void switchCompany(id);
  };

  const selectBranch = (id: number) => {
    setBrOpen(false);
    void switchBranch(id);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-none items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      {/* Mobile menu button */}
      <button
        onClick={onToggleMobile}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
        aria-label="Open menu"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {/* Desktop collapse button */}
      <button
        onClick={onToggleSidebar}
        className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:block"
        aria-label="Collapse sidebar"
      >
        {collapsed ? (
          <PanelLeft className="h-5 w-5" />
        ) : (
          <PanelLeftClose className="h-5 w-5" />
        )}
      </button>

      {/* Active company brand — logo + name (replaces the old search box) */}
      <div className="flex flex-1 items-center gap-2.5">
        {activeCompany && (
          <>
            {activeCompany.logo && !coLogoBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(activeCompany.logo)}
                alt=""
                onError={() => setCoLogoBroken(true)}
                className="h-9 w-9 flex-none rounded-lg object-contain"
              />
            ) : (
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950">
                <Building2 className="h-5 w-5" />
              </span>
            )}
            <span className="hidden flex-col justify-center sm:flex">
              <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-slate-400">
                Company
              </span>
              <span className="mt-0.5 text-sm font-bold leading-tight text-slate-800 dark:text-slate-100">
                {activeCompany.legalName || activeCompany.name}
              </span>
            </span>
          </>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-1 md:flex-none">
        {/* Company switcher — selects the active company (scopes everything) */}
        {companies.length > 0 && (
          <div className="relative" ref={coRef}>
            <button
              onClick={() => setCoOpen((v) => !v)}
              className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              title="Switch company"
            >
              <Building2 className="h-[18px] w-[18px] flex-none text-brand-600" />
              <span className="hidden min-w-0 flex-col justify-center sm:flex">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-slate-400">
                  Company
                </span>
                <span className="mt-0.5 max-w-[12rem] truncate text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-200">
                  {activeCompany?.name || 'Select company'}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 flex-none text-slate-400 transition-transform',
                  coOpen && 'rotate-180',
                )}
              />
            </button>

            {coOpen && (
              <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 dark:border-slate-800 dark:bg-slate-900">
                <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Companies
                </p>
                {companies.map((co) => {
                  const active = co.id === activeCompany?.id;
                  return (
                    <button
                      key={co.id}
                      onClick={() => selectCompany(co.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-4 py-2 text-sm transition',
                        active
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      <Building2 className="h-[18px] w-[18px] flex-none" />
                      <span className="flex-1 truncate text-left">
                        {co.name}
                        <span className="ml-1 text-xs text-slate-400">
                          {co.code}
                        </span>
                      </span>
                      {active && <Check className="h-4 w-4 flex-none" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Branch switcher — only when the active company is branch-applicable */}
        {branches.length > 0 && (
          <div className="relative" ref={brRef}>
            <button
              onClick={() => setBrOpen((v) => !v)}
              className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              title="Switch branch"
            >
              <GitBranch className="h-[18px] w-[18px] flex-none text-brand-600" />
              <span className="hidden min-w-0 flex-col justify-center sm:flex">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-slate-400">
                  Branch
                </span>
                <span className="mt-0.5 max-w-[12rem] truncate text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-200">
                  {activeBranch?.name || 'Select branch'}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 flex-none text-slate-400 transition-transform',
                  brOpen && 'rotate-180',
                )}
              />
            </button>

            {brOpen && (
              <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 dark:border-slate-800 dark:bg-slate-900">
                <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Branches
                </p>
                {branches.map((br) => {
                  const active = br.id === activeBranch?.id;
                  return (
                    <button
                      key={br.id}
                      onClick={() => selectBranch(br.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-4 py-2 text-sm transition',
                        active
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      <GitBranch className="h-[18px] w-[18px] flex-none" />
                      <span className="flex-1 truncate text-left">
                        {br.name}
                        <span className="ml-1 text-xs text-slate-400">
                          {br.code}
                        </span>
                      </span>
                      {active && <Check className="h-4 w-4 flex-none" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Module switcher — lists only the modules enabled for the company */}
        {navigation.length > 0 && (
          <div className="relative" ref={modRef}>
            <button
              onClick={() => setModOpen((v) => !v)}
              className="flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              title="Switch module"
            >
              <LayoutGrid className="h-[18px] w-[18px] flex-none text-brand-600" />
              <span className="hidden min-w-0 flex-col justify-center sm:flex">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-slate-400">
                  Module
                </span>
                <span className="mt-0.5 max-w-[12rem] truncate text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-200">
                  {activeModule?.name || 'Modules'}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 flex-none text-slate-400 transition-transform',
                  modOpen && 'rotate-180',
                )}
              />
            </button>

            {modOpen && (
              <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 dark:border-slate-800 dark:bg-slate-900">
                <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Modules
                </p>
                {navigation.map((mod) => {
                  const ModIcon = resolveIcon(mod.icon);
                  const active = mod.id === activeModule?.id;
                  return (
                    <button
                      key={mod.id}
                      onClick={() => selectModule(mod.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-4 py-2 text-sm transition',
                        active
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      <ModIcon className="h-[18px] w-[18px] flex-none" />
                      <span className="flex-1 truncate text-left">
                        {mod.name}
                      </span>
                      {active && <Check className="h-4 w-4 flex-none" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Notification bell — workflow approvals awaiting the user */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={openNotifications}
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <p className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                Notifications
              </p>
              <div className="max-h-80 overflow-y-auto py-1">
                {notifs.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">
                    No notifications.
                  </p>
                ) : (
                  notifs.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800',
                        !n.isRead && 'bg-brand-50/60 dark:bg-brand-950/40',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {!n.isRead && (
                          <span className="h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />
                        )}
                        <span
                          className={cn(
                            'flex-1 truncate text-sm',
                            n.isRead
                              ? 'text-slate-600 dark:text-slate-300'
                              : 'font-medium text-slate-800 dark:text-slate-100',
                          )}
                        >
                          {n.title}
                        </span>
                      </span>
                      {n.body && (
                        <span className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                          {n.body}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {formatDate(n.createdAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                onClick={() => {
                  setNotifOpen(false);
                  router.push('/workflow/approvals');
                }}
                className="block w-full border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-slate-50 dark:border-slate-800 dark:text-brand-400 dark:hover:bg-slate-800"
              >
                View all approvals
              </button>
            </div>
          )}
        </div>

        <ThemeToggle />

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg p-1.5 pr-2 transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {initials(user?.name)}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-medium leading-tight text-slate-800 dark:text-slate-100">
                {user?.name || 'User'}
              </span>
              <span className="block text-xs leading-tight text-slate-400">
                {user?.isSuperAdmin ? 'Super Admin' : user?.username}
              </span>
            </span>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {initials(user?.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {user?.name}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {user?.email}
                  </p>
                </div>
              </div>
              <div className="p-1.5">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  <UserCircle className="h-4 w-4" />
                  {user?.userCode}
                </div>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
