'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useSoftwareInfo } from '@/providers/SoftwareInfoProvider';
import { SoftwareInfoDialog } from './SoftwareInfoDialog';
import { LOGO_SIZE_DEFAULT } from '@/lib/software-info';
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
  const { info } = useSoftwareInfo();
  const pathname = usePathname();
  const [infoOpen, setInfoOpen] = useState(false);

  // Every main menu starts EXPANDED so its sub-menus are visible — including a
  // menu with a single sub-menu. Recompute when the module's set of menus
  // changes (switching modules, or a newly added menu) so new menus appear
  // expanded; manual collapses persist while navigating within the same set.
  const computeAllOpen = () => {
    const set = new Set<string>();
    activeModule?.menus.forEach((menu) =>
      set.add(`${activeModule.id}-${menu.id}`),
    );
    return set;
  };
  const [openMenus, setOpenMenus] = useState<Set<string>>(computeAllOpen);
  const menuSig = activeModule
    ? `${activeModule.id}:${activeModule.menus.map((m) => m.id).join(',')}`
    : '';
  useEffect(() => {
    setOpenMenus(computeAllOpen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuSig]);

  // Brand mark = the SOFTWARE logo + name (set in Cpanel → Software Information).
  // Clicking it opens the software-info panel. Falls back to the committed
  // /brand-logo.png + a generic name until configured.
  const softwareLogo = info?.logoUrl ?? null;
  const softwareName = info?.softwareName || 'ERP';
  const logoPx = info?.logoSize ?? LOGO_SIZE_DEFAULT;
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => {
    setLogoBroken(false); // retry the image when the logo changes
  }, [softwareLogo]);

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
      {/* Brand — software logo with its name centered underneath; click to view
          software information. */}
      <button
        type="button"
        onClick={() => setInfoOpen(true)}
        title="Software information"
        className="flex min-h-[4rem] flex-none flex-col items-center justify-start gap-0.5 border-b border-[#efe7db] px-3 pb-2 pt-2 text-center transition hover:bg-[#f6eee3] dark:border-slate-800 dark:hover:bg-slate-800"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={!logoBroken && softwareLogo ? mediaUrl(softwareLogo) : '/brand-logo.png'}
          alt="Logo"
          onError={() => setLogoBroken(true)}
          style={{ height: logoPx, width: logoPx }}
          className="flex-none rounded-lg object-contain"
        />
        {!collapsed && (
          <span className="max-w-full truncate text-xs font-semibold leading-tight tracking-tight text-slate-700 dark:text-slate-200">
            {softwareName}
          </span>
        )}
      </button>

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
      <SoftwareInfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        info={info}
      />

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
