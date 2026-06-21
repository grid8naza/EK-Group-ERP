'use client';

import Link from 'next/link';
import { LayoutDashboard, ArrowUpRight, Star } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { resolveIcon } from '@/lib/icons';

export default function HomePage() {
  const { user, activeModule, activeCompany, navigation } = useAuth();

  const ModIcon = resolveIcon(activeModule?.icon);
  const moduleDashboards = activeModule?.dashboards ?? [];

  // Other modules that also have dashboards, so the user can jump across them.
  const otherModules = navigation.filter(
    (m) => m.id !== activeModule?.id && (m.dashboards?.length ?? 0) > 0,
  );

  return (
    <div className="mx-auto max-w-7xl">
      {/* Welcome panel */}
      <div className="card mb-6 overflow-hidden">
        <div className="relative bg-gradient-to-r from-brand-600 to-brand-500 p-6 text-white sm:p-8">
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-16 right-24 h-44 w-44 rounded-full bg-white/10" />
          <div className="relative">
            <p className="flex items-center gap-2 text-sm font-medium text-brand-100">
              <ModIcon className="h-4 w-4" />
              {activeCompany?.name ?? 'Erp Grid8'}
              {activeModule ? ` · ${activeModule.name}` : ''}
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              Welcome back, {user?.name}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-brand-50">
              Pick a dashboard to get started, or use the left panel to navigate.
            </p>
          </div>
        </div>
      </div>

      {moduleDashboards.length === 0 && otherModules.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 p-12 text-center text-slate-400">
          <LayoutDashboard className="h-8 w-8" />
          <p className="text-sm">
            No dashboards are configured for this module.
          </p>
          {!user?.isSuperAdmin && (
            <p className="text-xs">
              Ask an administrator to create dashboards for your user group.
            </p>
          )}
        </div>
      ) : (
        <>
          {moduleDashboards.length > 0 && (
            <>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                {activeModule?.name} Dashboards
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {moduleDashboards.map((d) => {
                  const Icon = resolveIcon(d.icon) || LayoutDashboard;
                  return (
                    <Link
                      key={d.id}
                      href={d.route}
                      className="card group flex items-center gap-4 p-5 transition hover:border-brand-300 hover:shadow-md dark:hover:border-brand-800"
                    >
                      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                        <Icon className="h-6 w-6" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate font-semibold text-slate-800 dark:text-slate-100">
                          {d.name}
                          {d.isDefault && (
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          )}
                        </p>
                        <p className="text-xs text-slate-400">Open dashboard</p>
                      </div>
                      <ArrowUpRight className="h-5 w-5 flex-none text-slate-300 transition group-hover:text-brand-600" />
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {otherModules.map((m) => (
            <div key={m.id} className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                {m.name} Dashboards
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {m.dashboards!.map((d) => {
                  const Icon = resolveIcon(d.icon) || LayoutDashboard;
                  return (
                    <Link
                      key={d.id}
                      href={d.route}
                      className="card group flex items-center gap-4 p-5 transition hover:border-brand-300 hover:shadow-md dark:hover:border-brand-800"
                    >
                      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
                        <Icon className="h-6 w-6" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                          {d.name}
                        </p>
                        <p className="text-xs text-slate-400">Open dashboard</p>
                      </div>
                      <ArrowUpRight className="h-5 w-5 flex-none text-slate-300 transition group-hover:text-brand-600" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
