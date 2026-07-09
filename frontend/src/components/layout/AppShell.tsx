'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '@/providers/AuthProvider';
import { SoftwareInfoProvider } from '@/providers/SoftwareInfoProvider';
import { API_URL } from '@/lib/api';
import { mediaUrl } from '@/lib/login-screen';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Brand logo for the splash (public endpoint — works pre-auth).
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/login-screen/public`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && setLogoUrl(d?.config?.logoUrl ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // While bootstrapping auth, or when unauthenticated (redirect in flight),
  // show a minimal loading screen instead of the shell.
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf7f2] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          {/* Premium ring spinner around the brand logo. */}
          <div className="relative flex h-20 w-20 items-center justify-center">
            <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600 dark:border-slate-800 dark:border-t-brand-500" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={!logoBroken && logoUrl ? mediaUrl(logoUrl) : '/brand-logo.png'}
              alt="Logo"
              onError={() => setLogoBroken(true)}
              className="h-12 w-12 rounded-lg object-contain"
            />
          </div>
          <p className="text-sm font-medium tracking-wide text-[#7b746c] dark:text-slate-400">
            Loading…
          </p>
        </div>
      </div>
    );
  }

  return (
    <SoftwareInfoProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            'flex h-screen flex-col transition-[padding] duration-200',
            collapsed ? 'lg:pl-[76px]' : 'lg:pl-64',
          )}
        >
          <Topbar
            collapsed={collapsed}
            onToggleSidebar={() => setCollapsed((v) => !v)}
            onToggleMobile={() => setMobileOpen((v) => !v)}
          />
          {/* Scroll container for page content. Pages that want a frozen header +
              internally-scrolling table use an `h-full` flex column + DataTable
              `fillHeight`; normal pages just scroll here. */}
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </SoftwareInfoProvider>
  );
}
