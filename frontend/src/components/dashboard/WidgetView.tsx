'use client';

import Link from 'next/link';
import {
  FileText,
  BarChart3,
  Table2,
  Layers,
  Users,
  ShieldCheck,
  Building2,
  Inbox,
  ArrowUpRight,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveWidgetStyle } from '@/lib/widget-style';
import type {
  NavModule,
  ErpObject,
  WidgetType,
  WidgetConfig,
  MetricValue,
} from '@/lib/types';

export interface DashAggregates {
  forms: number;
  reports: number;
  tables: number;
  dashboards: number;
  modules: number;
  groups: number;
  users: number;
  companies: number;
  recent: ErpObject[];
  moduleObjects: number;
  units: number;
  categories: number;
}

export interface WidgetUser {
  name?: string;
  username?: string;
  userCode?: string;
  email?: string;
  isSuperAdmin?: boolean;
}

// Sources an admin can pick for a STAT-type widget.
export const STAT_SOURCES: Record<
  string,
  { label: string; pick: (d: DashAggregates) => number; icon: React.ReactNode; accent: any }
> = {
  users: { label: 'Users', pick: (d) => d.users, icon: <Users className="h-6 w-6" />, accent: 'slate' },
  groups: { label: 'User Groups', pick: (d) => d.groups, icon: <ShieldCheck className="h-6 w-6" />, accent: 'rose' },
  modules: { label: 'Modules', pick: (d) => d.modules, icon: <Layers className="h-6 w-6" />, accent: 'emerald' },
  companies: { label: 'Companies', pick: (d) => d.companies, icon: <Building2 className="h-6 w-6" />, accent: 'blue' },
  forms: { label: 'Forms', pick: (d) => d.forms, icon: <FileText className="h-6 w-6" />, accent: 'blue' },
  reports: { label: 'Reports', pick: (d) => d.reports, icon: <BarChart3 className="h-6 w-6" />, accent: 'violet' },
  tables: { label: 'Tables', pick: (d) => d.tables, icon: <Table2 className="h-6 w-6" />, accent: 'amber' },
  dashboards: { label: 'Dashboards', pick: (d) => d.dashboards, icon: <LayoutDashboard className="h-6 w-6" />, accent: 'emerald' },
  moduleObjects: { label: 'Module Objects', pick: (d) => d.moduleObjects, icon: <Inbox className="h-6 w-6" />, accent: 'blue' },
};

// True when a widget should occupy a single (stat-sized) cell.
export function isStatWidget(type?: WidgetType) {
  return type === 'STAT' || type === 'METRIC';
}

// Format a metric value for display per its declared format.
function formatMetric(m: MetricValue | undefined, loading: boolean): string {
  if (loading || !m) return '—';
  if (m.format === 'percent') return `${m.value.toLocaleString()}%`;
  return m.value.toLocaleString();
}

export function WidgetView({
  name,
  description,
  type,
  config,
  data,
  metrics,
  loading,
  activeModule,
}: {
  code: string;
  name: string;
  description?: string | null;
  type?: WidgetType;
  config?: WidgetConfig | null;
  data: DashAggregates | null;
  metrics?: Record<string, MetricValue> | null;
  loading: boolean;
  user: WidgetUser | null;
  activeModule: NavModule | null;
}) {
  const r = resolveWidgetStyle(config?.style);
  const v = (n?: number) => (loading || n == null ? '—' : n.toLocaleString());

  // The styled card shell every widget renders inside.
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className={r.containerClass} style={r.containerStyle}>
      {children}
    </div>
  );

  // Single-value card body shared by STAT and METRIC.
  const StatBody = ({ value, icon }: { value: React.ReactNode; icon: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {name}
        </p>
        <p
          className={cn('mt-1 text-slate-900 dark:text-white', r.valueClass)}
          style={r.valueStyle}
        >
          {value}
        </p>
        {(config?.hint || description) && (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {config?.hint || description}
          </p>
        )}
      </div>
      <div
        className={cn(
          'flex h-12 w-12 flex-none items-center justify-center rounded-xl',
          r.accentChip,
        )}
      >
        {icon}
      </div>
    </div>
  );

  if (type === 'STAT') {
    const src = STAT_SOURCES[config?.source ?? ''];
    return (
      <Shell>
        <StatBody
          value={data && src ? v(src.pick(data)) : '—'}
          icon={src?.icon ?? <BarChart3 className="h-6 w-6" />}
        />
      </Shell>
    );
  }

  if (type === 'METRIC') {
    const m = config?.metric ? metrics?.[config.metric] ?? undefined : undefined;
    return (
      <Shell>
        <StatBody
          value={formatMetric(m, loading)}
          icon={<BarChart3 className="h-6 w-6" />}
        />
      </Shell>
    );
  }

  if (type === 'NOTE') {
    return (
      <Shell>
        <Heading title={name} subtitle={description} />
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
          {config?.text || 'Empty note.'}
        </p>
      </Shell>
    );
  }

  if (type === 'EMBED') {
    const url = config?.url;
    return (
      <Shell>
        <Heading title={name} subtitle={description} />
        {url ? (
          <iframe
            src={url}
            title={name}
            className="mt-3 w-full rounded-lg border border-slate-200 dark:border-slate-800"
            style={{ height: config?.height || 240 }}
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <p className="mt-3 text-sm text-slate-400">No URL configured.</p>
        )}
      </Shell>
    );
  }

  if (type === 'LINKS') {
    return (
      <Shell>
        <QuickLinks name={name} description={description} activeModule={activeModule} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Heading title={name} subtitle={description} />
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <LayoutDashboard className="h-4 w-4" />
        The <span className="font-medium">{name}</span> widget for{' '}
        {activeModule?.name}.
      </p>
    </Shell>
  );
}

function QuickLinks({
  name,
  description,
  activeModule,
}: {
  name: string;
  description?: string | null;
  activeModule: NavModule | null;
}) {
  const links = (activeModule?.menus ?? [])
    .flatMap((m) => m.items)
    .filter((it) => it.route)
    .slice(0, 8);
  return (
    <>
      <Heading title={name} subtitle={description} />
      {links.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No screens available.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {links.map((it) => (
            <Link
              key={it.id}
              href={it.route || '#'}
              className="group flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 dark:border-slate-800 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-950"
            >
              {it.name}
              <ArrowUpRight className="h-4 w-4 text-slate-400 transition group-hover:text-brand-600" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: string | null }) {
  return (
    <>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </>
  );
}
