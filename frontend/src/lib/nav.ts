import type { NavModule } from './types';

/**
 * The route to land on when a module becomes active (e.g. after switching
 * company or module). Prefers the module's default dashboard, then falls back
 * to its first menu item, then its first dashboard, then the app home.
 */
export function moduleLandingRoute(mod: NavModule | null | undefined): string {
  if (!mod) return '/';
  const defaultDashboard = (mod.dashboards ?? []).find((d) => d.isDefault);
  if (defaultDashboard) return defaultDashboard.route;
  return mod.menus?.[0]?.items?.[0]?.route ?? mod.dashboards?.[0]?.route ?? '/';
}
