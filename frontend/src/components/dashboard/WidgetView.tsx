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
  Ruler,
  Tags,
} from 'lucide-react';
import { StatCard } from '@/components/ui/StatCard';
import type { NavModule, ErpObject, GadgetType, GadgetConfig } from '@/lib/types';

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

// Built-in stat gadget codes → card config.
const STAT: Record<
  string,
  { label: string; pick: (d: DashAggregates) => number; icon: React.ReactNode; accent: any; hint: string }
> = {
  USERS_COUNT: { label: 'Users', pick: (d) => d.users, icon: <Users className="h-6 w-6" />, accent: 'slate', hint: 'System users' },
  GROUPS_COUNT: { label: 'User Groups', pick: (d) => d.groups, icon: <ShieldCheck className="h-6 w-6" />, accent: 'rose', hint: 'Privilege groups' },
  MODULES_COUNT: { label: 'Modules', pick: (d) => d.modules, icon: <Layers className="h-6 w-6" />, accent: 'emerald', hint: 'Enabled modules' },
  COMPANIES_COUNT: { label: 'Companies', pick: (d) => d.companies, icon: <Building2 className="h-6 w-6" />, accent: 'blue', hint: 'Registered companies' },
  FORMS_COUNT: { label: 'Forms', pick: (d) => d.forms, icon: <FileText className="h-6 w-6" />, accent: 'blue', hint: 'Form objects' },
  REPORTS_COUNT: { label: 'Reports', pick: (d) => d.reports, icon: <BarChart3 className="h-6 w-6" />, accent: 'violet', hint: 'Report objects' },
  TABLES_COUNT: { label: 'Tables', pick: (d) => d.tables, icon: <Table2 className="h-6 w-6" />, accent: 'amber', hint: 'Table objects' },
  CRM_ENQUIRIES: { label: 'Enquiries', pick: (d) => d.moduleObjects, icon: <Inbox className="h-6 w-6" />, accent: 'blue', hint: 'Objects in this module' },
  UNITS_COUNT: { label: 'Units', pick: (d) => d.units, icon: <Ruler className="h-6 w-6" />, accent: 'blue', hint: 'Units of measure' },
  CATEGORIES_COUNT: { label: 'Categories', pick: (d) => d.categories, icon: <Tags className="h-6 w-6" />, accent: 'violet', hint: 'Item & product categories' },
};

// Sources an admin can pick for a STAT-type gadget.
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

// True when a gadget should occupy a single (stat-sized) cell.
export function isStatGadget(code: string, type?: GadgetType) {
  if (type) return type === 'STAT' || (type === 'BUILTIN' && !!STAT[code]);
  return !!STAT[code];
}
// Back-compat alias.
export const isStatWidget = (code: string) => !!STAT[code];

export function WidgetView({
  code,
  name,
  description,
  type,
  config,
  data,
  loading,
  user,
  activeModule,
}: {
  code: string;
  name: string;
  description?: string | null;
  type?: GadgetType;
  config?: GadgetConfig | null;
  data: DashAggregates | null;
  loading: boolean;
  user: WidgetUser | null;
  activeModule: NavModule | null;
}) {
  const v = (n?: number) => (loading || n == null ? '—' : n.toLocaleString());

  // ---- Configurable (admin-created) gadget types ----
  if (type === 'STAT') {
    const src = STAT_SOURCES[config?.source ?? ''];
    return (
      <StatCard
        label={name}
        value={data && src ? v(src.pick(data)) : '—'}
        icon={src?.icon ?? <BarChart3 className="h-6 w-6" />}
        accent={src?.accent ?? 'blue'}
        hint={config?.hint || description || src?.label || ''}
      />
    );
  }

  if (type === 'NOTE') {
    return (
      <Card title={name} subtitle={description}>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
          {config?.text || 'Empty note.'}
        </p>
      </Card>
    );
  }

  if (type === 'EMBED') {
    const url = config?.url;
    return (
      <Card title={name} subtitle={description}>
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
      </Card>
    );
  }

  if (type === 'LINKS') {
    return <QuickLinks name={name} description={description} activeModule={activeModule} />;
  }

  // ---- Built-in gadgets (rendered by code) ----
  const stat = STAT[code];
  if (stat) {
    return (
      <StatCard
        label={stat.label}
        value={data ? v(stat.pick(data)) : '—'}
        icon={stat.icon}
        accent={stat.accent}
        hint={stat.hint}
      />
    );
  }

  if (code === 'QUICK_LINKS' || code === 'CRM_QUICK_LINKS') {
    return <QuickLinks name={name} description={description} activeModule={activeModule} />;
  }

  if (code === 'ACCOUNT_INFO') {
    return (
      <Card title="Account">
        <dl className="mt-4 space-y-3 text-sm">
          <Row label="Name" value={user?.name} />
          <Row label="Username" value={user?.username} />
          <Row label="User Code" value={user?.userCode} />
          <Row label="Email" value={user?.email} />
          <Row label="Role" value={user?.isSuperAdmin ? 'Super Administrator' : 'User'} />
        </dl>
      </Card>
    );
  }

  if (code === 'RECENT_OBJECTS') {
    const recent = data?.recent ?? [];
    return (
      <Card title={name} subtitle={description}>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No objects yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {o.objectName}
                </span>
                <span className="text-xs text-slate-400">{o.objectType}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <Card title={name} subtitle={description}>
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <LayoutDashboard className="h-4 w-4" />
        The <span className="font-medium">{name}</span> widget for{' '}
        {activeModule?.name}.
      </p>
    </Card>
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
    <Card title={name} subtitle={description}>
      {links.length === 0 ? (
        <p className="text-sm text-slate-400">No screens available.</p>
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
    </Card>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="p-1">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800 dark:text-slate-100">
        {value || '-'}
      </dd>
    </div>
  );
}
