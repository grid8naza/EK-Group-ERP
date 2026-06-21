'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { moduleLandingRoute } from '@/lib/nav';

/**
 * The app index does not show a dashboard list — it redirects to the active
 * module's default dashboard (or first available screen). A minimal state is
 * shown only while resolving, or when the user has nowhere to land.
 */
export default function HomePage() {
  const router = useRouter();
  const { activeModule, navigation, loading, user } = useAuth();

  const target = moduleLandingRoute(activeModule);

  useEffect(() => {
    if (loading) return;
    if (target !== '/') router.replace(target);
  }, [loading, target, router]);

  // Genuinely nowhere to go: no modules, or the active module has no dashboards
  // and no menus.
  const nowhere =
    !loading && (navigation.length === 0 || (!!activeModule && target === '/'));

  if (nowhere) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card flex flex-col items-center justify-center gap-2 p-12 text-center text-slate-400">
          <LayoutDashboard className="h-8 w-8" />
          <p className="text-sm">No dashboards are configured for this module.</p>
          {!user?.isSuperAdmin && (
            <p className="text-xs">
              Ask an administrator to set up a default dashboard for your user
              group.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Redirecting…
  return (
    <div className="flex h-[60vh] items-center justify-center text-slate-400">
      <div className="flex items-center gap-2 text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
        Loading…
      </div>
    </div>
  );
}
