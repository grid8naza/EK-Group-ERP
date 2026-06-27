'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Box, BarChart3, Link2, StickyNote, Globe, Sigma } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { RowActions } from '@/components/ui/RowActions';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  resolveWidgetStyle,
  WIDGET_ACCENTS,
  FONT_FAMILIES,
  VALUE_SIZES,
  VALUE_WEIGHTS,
  WIDGET_SHAPES,
} from '@/lib/widget-style';
import type {
  Module,
  MetricOption,
  WidgetCatalogItem,
  WidgetType,
  WidgetStyle,
} from '@/lib/types';

const ROUTE = '/cpanel/widgets';

const TYPE_OPTIONS = [
  { value: 'METRIC', label: 'Metric — value from this module’s data' },
  { value: 'LINKS', label: 'Quick Links — module screens' },
  { value: 'NOTE', label: 'Note — free text' },
  { value: 'EMBED', label: 'Embed — external page (URL)' },
];

const TYPE_META: Record<WidgetType, { label: string; color: 'blue' | 'violet' | 'amber' | 'green' | 'slate'; icon: React.ReactNode }> = {
  METRIC: { label: 'Metric', color: 'green', icon: <Sigma className="h-4 w-4" /> },
  LINKS: { label: 'Links', color: 'violet', icon: <Link2 className="h-4 w-4" /> },
  NOTE: { label: 'Note', color: 'amber', icon: <StickyNote className="h-4 w-4" /> },
  EMBED: { label: 'Embed', color: 'slate', icon: <Globe className="h-4 w-4" /> },
};

const empty = {
  name: '',
  type: 'METRIC' as WidgetType,
  description: '',
  isActive: true,
  metric: '',
  hint: '',
  text: '',
  url: '',
  height: 240,
  // ---- appearance ----
  accent: 'blue' as WidgetStyle['accent'],
  valueColorOn: false,
  valueColor: '#2563eb',
  bgOn: false,
  background: '#ffffff',
  fontFamily: 'sans' as WidgetStyle['fontFamily'],
  fontSize: 'md' as WidgetStyle['fontSize'],
  fontWeight: 'bold' as WidgetStyle['fontWeight'],
  shape: 'rounded' as WidgetStyle['shape'],
  border: true,
  shadow: true,
};

export default function WidgetsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [widgets, setWidgets] = useState<WidgetCatalogItem[]>([]);
  const [metricOptions, setMetricOptions] = useState<MetricOption[]>([]);
  const [loading, setLoading] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WidgetCatalogItem | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  useEffect(() => {
    api
      .get<Module[]>('/companies/enabled-modules')
      .then((m) => {
        setModules(m ?? []);
        setModuleId((cur) => (m && m.length ? String(m[0].id) : ''));
      })
      .catch(() => {});
  }, [activeCompanyId]);

  const load = useCallback(async () => {
    if (!moduleId) {
      setWidgets([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<WidgetCatalogItem[]>(`/widgets?moduleId=${moduleId}`);
      setWidgets(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load widgets.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  useEffect(() => {
    load();
  }, [load]);

  // Metrics offered by the selected module (for the METRIC type's dropdown).
  useEffect(() => {
    if (!moduleId) {
      setMetricOptions([]);
      return;
    }
    api
      .get<MetricOption[]>(`/widgets/metrics?moduleId=${moduleId}`)
      .then((m) => setMetricOptions(m ?? []))
      .catch(() => setMetricOptions([]));
  }, [moduleId]);

  const { canToggle, toggleLock, guardEdit, guardDelete } =
    useLock<WidgetCatalogItem>({
      endpoint: '/widgets',
      noun: 'widget',
      nameOf: (w) => w.name,
      reload: load,
    });

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.name }));

  const openAdd = () => {
    if (!moduleId) {
      toast.error('Select a module first.');
      return;
    }
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setOpen(true);
  };
  const formFrom = (w: WidgetCatalogItem) => {
    const st = w.config?.style;
    return {
      name: w.name,
      type: w.type,
      description: w.description ?? '',
      isActive: w.isActive,
      metric: w.config?.metric ?? '',
      hint: w.config?.hint ?? '',
      text: w.config?.text ?? '',
      url: w.config?.url ?? '',
      height: w.config?.height ?? 240,
      accent: st?.accent ?? 'blue',
      valueColorOn: st?.valueColor != null,
      valueColor: st?.valueColor ?? '#2563eb',
      bgOn: st?.background != null,
      background: st?.background ?? '#ffffff',
      fontFamily: st?.fontFamily ?? 'sans',
      fontSize: st?.fontSize ?? 'md',
      fontWeight: st?.fontWeight ?? 'bold',
      shape: st?.shape ?? 'rounded',
      border: st?.border !== false,
      shadow: st?.shadow !== false,
    };
  };
  const openEdit = (w: WidgetCatalogItem) => {
    setEditing(w);
    setView(false);
    setForm(formFrom(w));
    setOpen(true);
  };
  // Read-only view — works for locked records without unlocking them.
  const openView = (w: WidgetCatalogItem) => {
    setEditing(w);
    setView(true);
    setForm(formFrom(w));
    setOpen(true);
  };

  const buildStyle = (): WidgetStyle => ({
    accent: form.accent,
    ...(form.valueColorOn ? { valueColor: form.valueColor } : {}),
    ...(form.bgOn ? { background: form.background } : {}),
    fontFamily: form.fontFamily,
    fontSize: form.fontSize,
    fontWeight: form.fontWeight,
    shape: form.shape,
    border: form.border,
    shadow: form.shadow,
  });

  const buildConfig = () => {
    const style = buildStyle();
    const base = (() => {
      switch (form.type) {
        case 'METRIC':
          return { metric: form.metric, hint: form.hint || undefined };
        case 'NOTE':
          return { text: form.text };
        case 'EMBED':
          return { url: form.url, height: Number(form.height) || 240 };
        default:
          return {};
      }
    })();
    return { ...base, style };
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.type === 'METRIC' && !form.metric) {
      toast.error('Pick a metric.');
      return;
    }
    if (form.type === 'EMBED' && !form.url.trim()) {
      toast.error('Embed widgets need a URL.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        moduleId: Number(moduleId),
        name: form.name,
        type: form.type,
        description: form.description || null,
        isActive: form.isActive,
        config: buildConfig(),
      };
      if (editing) {
        await api.patch(`/widgets/${editing.id}`, payload);
        toast.success('Widget updated.');
      } else {
        await api.post('/widgets', payload);
        toast.success('Widget created.');
      }
      await load();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w: WidgetCatalogItem) => {
    const ok = await confirm({
      title: 'Delete widget',
      message: `Delete "${w.name}"? It will be removed from any dashboards using it.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/widgets/${w.id}`);
      toast.success('Widget deleted.');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Live preview of the current appearance choices.
  const isValueType = form.type === 'METRIC';
  const pr = resolveWidgetStyle(buildStyle());

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Widgets"
        description="Create dashboard widgets — counts, links, notes or embeds — per module"
        icon={<Box className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Select
              wrapClassName="w-52"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              placeholder="Select module"
              options={moduleOptions}
            />
            {canAdd && (
              <button className="btn-primary" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Widget
              </button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-28 animate-pulse" />
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <Box className="h-8 w-8" />
          <p className="text-sm">No widgets for this module yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {widgets.map((w) => {
            const meta = TYPE_META[w.type];
            return (
              <div key={w.id} className="card flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
                    {meta?.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                      {w.name}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {w.code} · {w._count?.placements ?? 0} dashboards
                    </p>
                  </div>
                  {meta && <Badge color={meta.color}>{meta.label}</Badge>}
                </div>
                {w.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                    {w.description}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-end gap-1">
                  <RowActions
                    before={!w.isActive ? <Badge color="slate">Inactive</Badge> : undefined}
                    onView={() => openView(w)}
                    onEdit={() => guardEdit(w, () => openEdit(w))}
                    onDelete={() => guardDelete(w, () => remove(w))}
                    canView={canView}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    lock={
                      <LockButton
                        locked={w.isLocked}
                        canToggle={canToggle}
                        onToggle={() => toggleLock(w)}
                      />
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View Widget' : editing ? 'Edit Widget' : 'New Widget'}
        subtitle="Dashboard widget"
        icon={<Box className="h-5 w-5" />}
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter onCancel={closeDrawer} onSave={save} saving={saving} />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            required
            wrapClassName="sm:col-span-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select label="Module" value={moduleId} disabled options={moduleOptions} />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as WidgetType })
            }
            options={TYPE_OPTIONS}
          />

          {/* Type-specific config */}
          {form.type === 'METRIC' && (
            <>
              <Select
                label="Metric"
                required
                value={form.metric}
                onChange={(e) => setForm({ ...form, metric: e.target.value })}
                placeholder={
                  metricOptions.length ? 'Select a metric' : 'No metrics for this module'
                }
                options={metricOptions.map((m) => ({ value: m.key, label: m.label }))}
              />
              <Input
                label="Hint (subtitle)"
                value={form.hint}
                onChange={(e) => setForm({ ...form, hint: e.target.value })}
                placeholder="e.g. This month"
              />
              <p className="text-xs text-slate-400 sm:col-span-2">
                Pulls a live value (or calculation) from this module&apos;s data,
                scoped to the active company. The list comes from the module&apos;s
                metric registry.
              </p>
            </>
          )}
          {form.type === 'NOTE' && (
            <Textarea
              label="Text"
              wrapClassName="sm:col-span-2"
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              placeholder="Anything you want to show on the dashboard…"
            />
          )}
          {form.type === 'EMBED' && (
            <>
              <Input
                label="URL"
                wrapClassName="sm:col-span-2"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/report"
              />
              <Input
                label="Height (px)"
                type="number"
                value={form.height}
                onChange={(e) =>
                  setForm({ ...form, height: Number(e.target.value) })
                }
              />
            </>
          )}
          {form.type === 'LINKS' && (
            <p className="text-xs text-slate-400 sm:col-span-2">
              Shows quick links to the current module&apos;s screens. No extra
              configuration needed.
            </p>
          )}

          <Textarea
            label="Description"
            wrapClassName="sm:col-span-2"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex items-end pb-2">
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          </div>

          {/* ---- Appearance: colours, fonts, shape ---- */}
          <div className="mt-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800 sm:col-span-2">
            <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Appearance
            </p>

            {/* Live preview */}
            <div className="mb-4">
              <div className={cn(pr.containerClass, 'max-w-sm')} style={pr.containerStyle}>
                {isValueType ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {form.name || 'Widget'}
                      </p>
                      <p
                        className={cn('mt-1 text-slate-900 dark:text-white', pr.valueClass)}
                        style={pr.valueStyle}
                      >
                        1,234
                      </p>
                      {form.hint && (
                        <p className="mt-1 text-xs text-slate-400">{form.hint}</p>
                      )}
                    </div>
                    <div
                      className={cn(
                        'flex h-12 w-12 flex-none items-center justify-center rounded-xl',
                        pr.accentChip,
                      )}
                    >
                      <BarChart3 className="h-6 w-6" />
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                      {form.name || 'Widget'}
                    </h2>
                    {form.type === 'NOTE' && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                        {form.text || 'Empty note.'}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Accent"
                value={form.accent}
                onChange={(e) =>
                  setForm({ ...form, accent: e.target.value as WidgetStyle['accent'] })
                }
                options={WIDGET_ACCENTS.map((a) => ({ value: a.key, label: a.label }))}
              />
              <Select
                label="Shape"
                value={form.shape}
                onChange={(e) =>
                  setForm({ ...form, shape: e.target.value as WidgetStyle['shape'] })
                }
                options={WIDGET_SHAPES.map((s) => ({ value: s.key, label: s.label }))}
              />
              <Select
                label="Font"
                value={form.fontFamily}
                onChange={(e) =>
                  setForm({
                    ...form,
                    fontFamily: e.target.value as WidgetStyle['fontFamily'],
                  })
                }
                options={FONT_FAMILIES.map((f) => ({ value: f.key, label: f.label }))}
              />
              {isValueType && (
                <Select
                  label="Value size"
                  value={form.fontSize}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fontSize: e.target.value as WidgetStyle['fontSize'],
                    })
                  }
                  options={VALUE_SIZES.map((s) => ({ value: s.key, label: s.label }))}
                />
              )}
              {isValueType && (
                <Select
                  label="Value weight"
                  value={form.fontWeight}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fontWeight: e.target.value as WidgetStyle['fontWeight'],
                    })
                  }
                  options={VALUE_WEIGHTS.map((w) => ({ value: w.key, label: w.label }))}
                />
              )}
            </div>

            {/* Optional custom colours */}
            <div className="mt-4 space-y-3">
              {isValueType && (
                <ColorRow
                  label="Custom value colour"
                  on={form.valueColorOn}
                  color={form.valueColor}
                  onToggle={(v) => setForm({ ...form, valueColorOn: v })}
                  onColor={(c) => setForm({ ...form, valueColor: c })}
                />
              )}
              <ColorRow
                label="Custom background"
                on={form.bgOn}
                color={form.background}
                onToggle={(v) => setForm({ ...form, bgOn: v })}
                onColor={(c) => setForm({ ...form, background: c })}
              />
              <div className="flex items-center gap-6">
                <Checkbox
                  label="Border"
                  checked={form.border}
                  onChange={(e) => setForm({ ...form, border: e.target.checked })}
                />
                <Checkbox
                  label="Shadow"
                  checked={form.shadow}
                  onChange={(e) => setForm({ ...form, shadow: e.target.checked })}
                />
              </div>
            </div>
          </div>
        </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}

// A toggle + native colour picker for an optional custom colour. When the
// toggle is off the colour is omitted from the saved style (inherits default).
function ColorRow({
  label,
  on,
  color,
  onToggle,
  onColor,
}: {
  label: string;
  on: boolean;
  color: string;
  onToggle: (v: boolean) => void;
  onColor: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Checkbox
        label={label}
        checked={on}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <input
        type="color"
        value={color}
        disabled={!on}
        onChange={(e) => onColor(e.target.value)}
        className={cn(
          'h-7 w-10 cursor-pointer rounded border border-slate-300 bg-transparent dark:border-slate-700',
          !on && 'cursor-not-allowed opacity-40',
        )}
        aria-label={label}
      />
      {on && (
        <span className="text-xs text-slate-400">{color}</span>
      )}
    </div>
  );
}
