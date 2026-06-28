'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeft,
  Search,
  LogOut,
  ChevronDown,
  UserCircle,
  LayoutGrid,
  Building2,
  GitBranch,
  Check,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { resolveIcon } from '@/lib/icons';
import { initials, cn } from '@/lib/utils';
import { moduleLandingRoute } from '@/lib/nav';

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
  const menuRef = useRef<HTMLDivElement>(null);
  const modRef = useRef<HTMLDivElement>(null);
  const coRef = useRef<HTMLDivElement>(null);
  const brRef = useRef<HTMLDivElement>(null);

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
    <header className="sticky top-0 z-20 flex h-16 flex-none items-center gap-3 border-b border-[#efe7db] bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
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

      {/* Search */}
      <div className="relative hidden flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search..."
          className="input-base w-full max-w-md border-[#e9dfd0] bg-[#fcfbf8] pl-9 dark:bg-slate-900"
        />
      </div>

      <div className="flex flex-1 items-center justify-end gap-1 md:flex-none">
        {/* Company switcher — selects the active company (scopes everything) */}
        {companies.length > 0 && (
          <div className="relative" ref={coRef}>
            <button
              onClick={() => setCoOpen((v) => !v)}
              className="flex h-11 items-center gap-2.5 rounded-xl border border-[#e7ddd0] bg-white px-3 text-left transition hover:bg-[#f6eee3] dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              title="Switch company"
            >
              <Building2 className="h-[18px] w-[18px] flex-none text-brand-600" />
              <span className="hidden min-w-0 flex-col justify-center sm:flex">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-[#a79b8c]">
                  Company
                </span>
                <span className="mt-0.5 max-w-[12rem] truncate text-[13px] font-semibold leading-tight text-[#2f2a26] dark:text-slate-200">
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
              <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
              className="flex h-11 items-center gap-2.5 rounded-xl border border-[#e7ddd0] bg-white px-3 text-left transition hover:bg-[#f6eee3] dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              title="Switch branch"
            >
              <GitBranch className="h-[18px] w-[18px] flex-none text-brand-600" />
              <span className="hidden min-w-0 flex-col justify-center sm:flex">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-[#a79b8c]">
                  Branch
                </span>
                <span className="mt-0.5 max-w-[12rem] truncate text-[13px] font-semibold leading-tight text-[#2f2a26] dark:text-slate-200">
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
              <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
              className="flex h-11 items-center gap-2.5 rounded-xl border border-[#e7ddd0] bg-white px-3 text-left transition hover:bg-[#f6eee3] dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              title="Switch module"
            >
              <LayoutGrid className="h-[18px] w-[18px] flex-none text-brand-600" />
              <span className="hidden min-w-0 flex-col justify-center sm:flex">
                <span className="text-[9px] font-semibold uppercase leading-none tracking-wider text-[#a79b8c]">
                  Module
                </span>
                <span className="mt-0.5 max-w-[12rem] truncate text-[13px] font-semibold leading-tight text-[#2f2a26] dark:text-slate-200">
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
              <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
            <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
