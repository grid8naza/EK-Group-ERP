/**
 * Port — how a module publishes dashboard *metrics* (named, computed values
 * drawn from its own tables) WITHOUT any other module importing its internals.
 *
 * Each feature module owns an adapter (modules/<m>/<m>-metrics.adapter.ts) that
 * implements this port over its own Prisma tables and returns small, stable
 * metric definitions. Adapters are registered as a multi-provider in
 * contracts/contracts.module.ts; the widget module's MetricRegistryService
 * injects them ALL via the token below and never imports any feature module.
 *
 * This is the safe answer to "show real / calculated table data on a widget":
 * the SQL stays inside the owning module behind an allowlist of named keys, so
 * there is no arbitrary-query surface and module isolation is preserved.
 *
 * Rules (same spirit as user-lookup.port.ts):
 *   - No Prisma types or entities leak through this interface — a metric is a
 *     `key`, human label, owning module code, a display format, and an async
 *     `compute` returning a single number.
 *   - `compute` is async so a remote implementation can drop in unchanged.
 */

/** DI token for metric providers. Inject the array with `@Inject(METRIC_PROVIDER)`. */
export const METRIC_PROVIDER = Symbol('METRIC_PROVIDER');

/** How a metric's value should be displayed. */
export type MetricFormat = 'number' | 'percent' | 'currency';

/** The scope a metric is computed for (the active company / branch). */
export interface MetricContext {
  companyId: number;
  branchId?: number | null;
}

/** One named metric a module exposes to the dashboard widget builder. */
export interface MetricDef {
  /** Globally unique, dotted key, e.g. 'production.orders.planned'. */
  key: string;
  /** Human label shown in the widget builder's metric dropdown. */
  label: string;
  /** Owning module's code (e.g. 'PRODUCTION') — filters the dropdown by module. */
  moduleCode: string;
  /** Display format; defaults to 'number'. */
  format?: MetricFormat;
  /** Compute the metric's value for the given company/branch scope. */
  compute(ctx: MetricContext): Promise<number>;
}

export interface MetricProviderPort {
  /** The metric definitions this module publishes. */
  metrics(): MetricDef[];
}
