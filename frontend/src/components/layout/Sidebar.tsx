'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Layers, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { api } from '@/lib/api';
import { mediaUrl } from '@/lib/login-screen';
import { resolveIcon } from '@/lib/icons';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onMobileClose }: SidebarProps) {
  const { activeModule } = useAuth();
  const pathname = usePathname();

  // Track which menu groups are expanded. Default: expand the one containing the active route.
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    activeModule?.menus.forEach((menu) => {
      if (menu.items.some((it) => it.route === pathname)) {
        set.add(`${activeModule.id}-${menu.id}`);
      }
    });
    return set;
  }, [activeModule, pathname]);

  const [openMenus, setOpenMenus] = useState<Set<string>>(initialOpen);

  // Reuse the login-screen logo as the sidebar brand mark.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api
      .get<{ config: { logoUrl?: string | null } | null }>('/login-screen')
      .then((res) => active && setLogoUrl(res.config?.logoUrl ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const toggle = (key: string) => {
    setOpenMenus((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const content = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-16 flex-none items-center gap-2.5 border-b border-[#efe7db] px-4 dark:border-slate-800">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(logoUrl)}
            alt="Logo"
            className="h-9 w-9 flex-none rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
            <Layers className="h-5 w-5" />
          </div>
        )}
        {!collapsed && (
          <span className="text-base font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
            Regency Bake House
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {!activeModule && !collapsed && (
          <p className="px-2 text-xs text-slate-400">No navigation available</p>
        )}
        {/* Dashboards for the active module (selectable from the left panel).
            Split into Company (company-wide) and Branch dashboards when both
            kinds are present; otherwise show a single "Dashboards" group. */}
        {activeModule &&
          (() => {
            const all = activeModule.dashboards ?? [];
            if (all.length === 0) return null;
            const company = all.filter((d) => !d.branchId);
            const branch = all.filter((d) => d.branchId);
            const split = company.length > 0 && branch.length > 0;

            const renderGroup = (label: string, list: typeof all) =>
              list.length > 0 && (
                <div>
                  {!collapsed && (
                    <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {label}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {list.map((d) => {
                      const DIcon = resolveIcon(d.icon) || LayoutDashboard;
                      return (
                        <NavLink
                          key={`dash-${d.id}`}
                          href={d.route}
                          label={d.name}
                          icon={<DIcon className="h-[18px] w-[18px]" />}
                          active={d.route === pathname}
                          collapsed={collapsed}
                          onClick={onMobileClose}
                        />
                      );
                    })}
                  </div>
                </div>
              );

            return split ? (
              <div className="space-y-4">
                {renderGroup('Company Dashboards', company)}
                {renderGroup('Branch Dashboards', branch)}
              </div>
            ) : (
              renderGroup('Dashboards', all)
            );
          })()}

        {activeModule && (
          <div>
            {!collapsed && (
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {activeModule.name}
              </p>
            )}
            <div className="space-y-0.5">
              {activeModule.menus.map((menu) => {
                const key = `${activeModule.id}-${menu.id}`;
                const MenuIcon = resolveIcon(menu.icon);
                const isOpen = openMenus.has(key);
                const hasActive = menu.items.some(
                  (it) => it.route === pathname,
                );

                // If the menu has a single item, render it as a direct link.
                if (menu.items.length === 1) {
                  const item = menu.items[0];
                  const ItemIcon = resolveIcon(item.icon || menu.icon);
                  const active = item.route === pathname;
                  return (
                    <NavLink
                      key={key}
                      href={item.route}
                      label={menu.name}
                      icon={<ItemIcon className="h-[18px] w-[18px]" />}
                      active={active}
                      collapsed={collapsed}
                      onClick={onMobileClose}
                    />
                  );
                }

                return (
                  <div key={key}>
                    <button
                      onClick={() => toggle(key)}
                      title={collapsed ? menu.name : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border-l-4 border-transparent px-3 py-2 text-sm font-medium transition',
                        hasActive
                          ? 'text-[#8b5e34] dark:text-brand-300'
                          : 'text-[#5d5a56] hover:bg-[#f6eee3] hover:text-[#8b5e34] dark:text-slate-300 dark:hover:bg-slate-800',
                        collapsed && 'justify-center',
                      )}
                    >
                      <MenuIcon className="h-[18px] w-[18px] flex-none" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left">{menu.name}</span>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform',
                              isOpen && 'rotate-180',
                            )}
                          />
                        </>
                      )}
                    </button>
                    {!collapsed && (
                      <div
                        className={cn(
                          'grid transition-[grid-template-rows] duration-200 ease-in-out',
                          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="mt-0.5 space-y-0.5 border-l border-[#efe7db] pl-3 dark:border-slate-800">
                            {menu.items.map((item) => {
                              const ItemIcon = resolveIcon(item.icon);
                              const active = item.route === pathname;
                              return (
                                <NavLink
                                  key={item.id}
                                  href={item.route}
                                  label={item.name}
                                  icon={
                                    <ItemIcon className="h-[16px] w-[16px]" />
                                  }
                                  active={active}
                                  collapsed={false}
                                  sub
                                  onClick={onMobileClose}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-none border-r border-[#efe7db] bg-[#fcfbf8] transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-900 lg:block',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        {content}
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        <div
          className={cn(
            'absolute inset-0 bg-slate-900/50 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={onMobileClose}
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 w-64 border-r border-[#efe7db] bg-[#fcfbf8] transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {content}
        </aside>
      </div>
    </>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
  collapsed,
  sub,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed: boolean;
  sub?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href || '#'}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg border-l-4 border-transparent px-3 py-2 text-sm transition',
        active
          ? 'border-[#a06a2c] bg-[#f7ebd7] font-medium text-[#8b5e34] dark:border-brand-500 dark:bg-brand-950 dark:text-brand-200'
          : 'text-[#5d5a56] hover:bg-[#f6eee3] hover:text-[#8b5e34] dark:text-slate-300 dark:hover:bg-slate-800',
        collapsed && 'justify-center',
        sub && !active && 'text-[#7b746c] dark:text-slate-400',
      )}
    >
      <span className="flex-none">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
