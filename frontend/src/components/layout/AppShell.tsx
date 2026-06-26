'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/utils';
import { Layers } from 'lucide-react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // While bootstrapping auth, or when unauthenticated (redirect in flight),
  // show a minimal loading screen instead of the shell.
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-brand-600 text-white">
            <Layers className="h-6 w-6" />
          </div>
          <p className="text-sm">Loading Erp Grid8...</p>
        </div>
      </div>
    );
  }

  return (
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
  );
}
