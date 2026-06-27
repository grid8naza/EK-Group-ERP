'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus,
  LayoutDashboard,
  Trash2,
  GripVertical,
  Star,
  LayoutGrid,
  GitBranch,
  Paintbrush,
  RotateCcw,
  EyeOff,
} from 'lucide-react';
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
import { Input, Select, Checkbox, Textarea } from '@/components/ui/Field';
import { IconPicker } from '@/components/ui/IconPicker';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { resolveIcon } from '@/lib/icons';
import { isStatWidget } from '@/components/dashboard/WidgetView';
import {
  resolveDashboardHeader,
  HEADER_THEME_OPTIONS,
  HEADER_SIZES,
  HEADER_ALIGNMENTS,
} from '@/lib/dashboard-header';
import type {
  Module,
  DashboardSummary,
  DashboardDetail,
  DashboardHeaderStyle,
  WidgetType,
} from '@/lib/types';

const ROUTE = '/cpanel/dashboards';

interface Widget {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  type?: WidgetType;
}

const emptyForm = {
  name: '',
  icon: 'layout-dashboard',
  branchId: '',
  isDefault: false,
  isActive: true,
};

const emptyHeader: DashboardHeaderStyle = {
  theme: 'blue',
  gradientFrom: '#2563eb',
  gradientTo: '#3b82f6',
  solid: false,
  subtitle: '',
  pattern: true,
  align: 'left',
  size: 'md',
  hidden: false,
};

export default function DashboardsPage() {
  const { can, activeCompanyId, branches } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [branchFilter, setBranchFilter] = useState(''); // '' = all branches
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // dashboard drawer
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DashboardSummary | null>(null);
  const [view, setView] = useState(false); // read-only view (e.g. for locked records)
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  // widget editor drawer
  const [wOpen, setWOpen] = useState(false);
  const [wDashboard, setWDashboard] = useState<DashboardSummary | null>(null);
  const [catalog, setCatalog] = useState<Widget[]>([]);
  const [selected, setSelected] = useState<number[]>([]); // widget ids, ordered
  const [wSaving, setWSaving] = useState(false);

  // header design drawer
  const [hOpen, setHOpen] = useState(false);
  const [hDashboard, setHDashboard] = useState<DashboardSummary | null>(null);
  const [hForm, setHForm] = useState<DashboardHeaderStyle>({ ...emptyHeader });
  const [hSaving, setHSaving] = useState(false);

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
      setDashboards([]);
      return;
    }
    setLoading(true);
    try {
      const bq = branchFilter ? `&branchId=${branchFilter}` : '';
      const res = await api.get<DashboardSummary[]>(
        `/dashboards?moduleId=${moduleId}${bq}`,
      );
      setDashboards(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load dashboards.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, branchFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const { canToggle, toggleLock, guardEdit, guardDelete } =
    useLock<DashboardSummary>({
      endpoint: '/dashboards',
      noun: 'dashboard',
      nameOf: (d) => d.name,
      reload: load,
    });

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.name }));
  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }));
  // Core modules (e.g. Cpanel) are global: their dashboards aren't company- or
  // branch-scoped, so the branch controls don't apply.
  const isCoreModule = !!modules.find((m) => String(m.id) === moduleId)?.isCore;
  const hasBranches = branches.length > 0 && !isCoreModule;

  // ---- Dashboard CRUD ----
  const openAdd = () => {
    if (!moduleId) {
      toast.error('Select a module first.');
      return;
    }
    setEditing(null);
    setView(false);
    // Pre-fill the branch from the active filter for convenience.
    setForm({ ...emptyForm, branchId: branchFilter });
    setOpen(true);
  };
  const formFrom = (d: DashboardSummary) => ({
    name: d.name,
    icon: d.icon ?? 'layout-dashboard',
    branchId: d.branchId ? String(d.branchId) : '',
    isDefault: d.isDefault,
    isActive: d.isActive,
  });
  const openEdit = (d: DashboardSummary) => {
    setEditing(d);
    setView(false);
    setForm(formFrom(d));
    setOpen(true);
  };
  // Read-only view — works for locked records without unlocking them.
  const openView = (d: DashboardSummary) => {
    setEditing(d);
    setView(true);
    setForm(formFrom(d));
    setOpen(true);
  };
  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        moduleId: Number(moduleId),
        name: form.name,
        icon: form.icon || null,
        branchId: form.branchId ? Number(form.branchId) : null,
        isDefault: form.isDefault,
        isActive: form.isActive,
      };
      if (editing) {
        await api.patch(`/dashboards/${editing.id}`, payload);
        toast.success('Dashboard updated.');
      } else {
        await api.post('/dashboards', payload);
        toast.success('Dashboard created.');
      }
      await load();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (d: DashboardSummary) => {
    const ok = await confirm({
      title: 'Delete dashboard',
      message: `Delete "${d.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/dashboards/${d.id}`);
      toast.success('Dashboard deleted.');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- Widget editor ----
  const openWidgets = async (d: DashboardSummary) => {
    setWDashboard(d);
    setWOpen(true);
    setCatalog([]);
    setSelected([]);
    try {
      const [cat, detail] = await Promise.all([
        api.get<Widget[]>(`/dashboards/widgets?moduleId=${d.moduleId}`),
        api.get<DashboardDetail>(`/dashboards/${d.id}`),
      ]);
      setCatalog(cat ?? []);
      setSelected((detail.widgets ?? []).map((w) => w.widgetId));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load widgets.');
    }
  };
  const toggleWidget = (widgetId: number, checked: boolean) => {
    setSelected((cur) =>
      checked ? [...cur, widgetId] : cur.filter((id) => id !== widgetId),
    );
  };
  const onReorderWidgets = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSelected((cur) => {
      const oldIndex = cur.indexOf(Number(active.id));
      const newIndex = cur.indexOf(Number(over.id));
      if (oldIndex < 0 || newIndex < 0) return cur;
      return arrayMove(cur, oldIndex, newIndex);
    });
  };
  const saveWidgets = async () => {
    if (!wDashboard) return;
    setWSaving(true);
    try {
      const byId = new Map(catalog.map((g) => [g.id, g]));
      const widgets = selected.map((widgetId) => {
        const g = byId.get(widgetId);
        return {
          widgetId,
          width: g && isStatWidget(g.type) ? 1 : 2,
        };
      });
      await api.put(`/dashboards/${wDashboard.id}/widgets`, { widgets });
      toast.success('Widgets saved.');
      setWOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save widgets.');
    } finally {
      setWSaving(false);
    }
  };

  // ---- Header design ----
  const openHeader = (d: DashboardSummary) => {
    setHDashboard(d);
    setHForm({ ...emptyHeader, ...(d.header ?? {}) });
    setHOpen(true);
  };
  const saveHeader = async () => {
    if (!hDashboard) return;
    setHSaving(true);
    try {
      await api.patch(`/dashboards/${hDashboard.id}/header`, { header: hForm });
      toast.success('Header saved.');
      setHOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save header.');
    } finally {
      setHSaving(false);
    }
  };
  const resetHeader = () => setHForm({ ...emptyHeader });

  const headerPreview = resolveDashboardHeader(hForm);
  const isCustomTheme = hForm.theme === 'custom';

  const catalogById = new Map(catalog.map((g) => [g.id, g]));
  const unselected = catalog.filter((g) => !selected.includes(g.id));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dashboards"
        description="Create dashboards per module; assign them to user groups, who pick them from the left panel"
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Select
              wrapClassName="w-52"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              placeholder="Select module"
              options={moduleOptions}
            />
            {hasBranches && (
              <Select
                wrapClassName="w-44"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                placeholder="All branches"
                options={branchOptions}
              />
            )}
            {canAdd && (
              <button className="btn-primary" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Dashboard
              </button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-32 animate-pulse" />
          ))}
        </div>
      ) : dashboards.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <LayoutDashboard className="h-8 w-8" />
          <p className="text-sm">No dashboards for this module yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => {
            const Icon = resolveIcon(d.icon) || LayoutDashboard;
            return (
              <div key={d.id} className="card flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-semibold text-slate-800 dark:text-slate-100">
                      {d.name}
                      {d.isDefault && (
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {d._count?.widgets ?? 0} widgets
                    </p>
                    {hasBranches && (
                      <span className="mt-1 inline-flex items-center gap-1 text-xs">
                        <GitBranch className="h-3 w-3 text-slate-400" />
                        {d.branch ? (
                          <Badge color="blue">{d.branch.name}</Badge>
                        ) : (
                          <Badge color="slate">All branches</Badge>
                        )}
                      </span>
                    )}
                  </div>
                  {!d.isActive && <Badge color="slate">Inactive</Badge>}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <RowActions
                    before={
                      <>
                        <button
                          onClick={() => openWidgets(d)}
                          className="btn-secondary flex-1 !py-1.5"
                        >
                          <LayoutGrid className="h-4 w-4" /> Widgets
                        </button>
                        <button
                          onClick={() => guardEdit(d, () => openHeader(d))}
                          className="btn-secondary flex-1 !py-1.5"
                          title="Design the header banner"
                        >
                          <Paintbrush className="h-4 w-4" /> Header
                        </button>
                      </>
                    }
                    onView={() => openView(d)}
                    onEdit={() => guardEdit(d, () => openEdit(d))}
                    onDelete={() => guardDelete(d, () => remove(d))}
                    canView={canView}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    lock={
                      <LockButton
                        locked={d.isLocked}
                        canToggle={canToggle}
                        onToggle={() => toggleLock(d)}
                      />
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dashboard form drawer */}
      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View Dashboard' : editing ? 'Edit Dashboard' : 'New Dashboard'}
        subtitle="Dashboard"
        icon={<LayoutDashboard className="h-5 w-5" />}
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
          {isCoreModule && (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-950 dark:text-brand-300 sm:col-span-2">
              This is a core module — its dashboards are global and shared across
              all companies.
            </p>
          )}
          {hasBranches && (
            <Select
              label="Branch"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              placeholder="All branches (company-wide)"
              options={branchOptions}
            />
          )}
          <IconPicker
            label="Icon"
            value={form.icon}
            onChange={(icon) => setForm({ ...form, icon })}
          />
          <div className="pb-2 sm:col-span-2">
            <div className="flex items-end gap-4">
              <Checkbox
                label="Default"
                checked={form.isDefault}
                onChange={(e) =>
                  setForm({ ...form, isDefault: e.target.checked })
                }
              />
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              The default dashboard loads automatically when this module opens.
              Only one dashboard per module {hasBranches && 'and branch '}can be
              the default — marking this one clears it on the others.
              {hasBranches && (
                <>
                  {' '}
                  A “company-wide” dashboard shows on every branch — but only to
                  users who can access all of the company’s branches. Users with
                  access to just some branches see only that branch’s dashboards.
                </>
              )}
            </p>
          </div>
        </div>
        </ReadOnlyFieldset>
      </Drawer>

      {/* Widget editor drawer */}
      <Drawer
        open={wOpen}
        onClose={() => setWOpen(false)}
        title="Edit Widgets"
        subtitle={wDashboard?.name}
        icon={<LayoutGrid className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setWOpen(false)}
            onSave={saveWidgets}
            saving={wSaving}
            saveLabel="Save Widgets"
          />
        }
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Selected widgets — drag to order
            </h3>
            {selected.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400 dark:border-slate-700">
                No widgets selected yet
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onReorderWidgets}
              >
                <SortableContext
                  items={selected}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {selected.map((id) => {
                      const g = catalogById.get(id);
                      if (!g) return null;
                      return (
                        <WidgetRow
                          key={id}
                          id={id}
                          label={g.name}
                          type={g.type}
                          onRemove={() => toggleWidget(id, false)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Available widgets
            </h3>
            {unselected.length === 0 ? (
              <p className="text-sm text-slate-400">All widgets are in use.</p>
            ) : (
              <div className="space-y-1">
                {unselected.map((g) => (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  >
                    <Checkbox
                      checked={false}
                      onChange={(e) => toggleWidget(g.id, e.target.checked)}
                    />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {g.name}
                    </span>
                    <span className="ml-auto text-xs text-slate-400">
                      {isStatWidget(g.type) ? 'stat' : 'wide'}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* Header design drawer */}
      <Drawer
        open={hOpen}
        onClose={() => setHOpen(false)}
        title="Design Header"
        subtitle={hDashboard?.name}
        icon={<Paintbrush className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setHOpen(false)}
            onSave={saveHeader}
            saving={hSaving}
            saveLabel="Save Header"
          />
        }
      >
        <div className="space-y-5">
          {/* Live preview */}
          <div>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
              Preview
              <button
                type="button"
                onClick={resetHeader}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Reset to the default brand header"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </h3>
            {headerPreview.hidden ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
                <EyeOff className="h-4 w-4" />
                Header hidden — widgets show without a banner.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl">
                <div
                  className={cn(headerPreview.containerClass, 'p-5')}
                  style={headerPreview.containerStyle}
                >
                  {headerPreview.pattern && (
                    <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
                  )}
                  <div
                    className={cn(
                      'relative',
                      headerPreview.align === 'center' && 'text-center',
                    )}
                  >
                    <p
                      className={cn(
                        'text-xs font-medium',
                        headerPreview.labelClass,
                      )}
                    >
                      {hDashboard?.module?.name ?? 'Module'}
                    </p>
                    <h2 className="mt-0.5 text-lg font-bold text-white">
                      {hDashboard?.name ?? 'Dashboard'}
                    </h2>
                    <p
                      className={cn(
                        'mt-1 text-xs',
                        headerPreview.align === 'center' && 'mx-auto',
                        headerPreview.subtitleClass,
                      )}
                    >
                      {headerPreview.subtitle}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Theme"
              value={hForm.theme}
              onChange={(e) =>
                setHForm({
                  ...hForm,
                  theme: e.target.value as DashboardHeaderStyle['theme'],
                })
              }
              options={HEADER_THEME_OPTIONS}
            />
            {isCustomTheme ? (
              <Checkbox
                label="Solid fill (no gradient)"
                className="mt-7"
                checked={!!hForm.solid}
                onChange={(e) =>
                  setHForm({ ...hForm, solid: e.target.checked })
                }
              />
            ) : (
              <div />
            )}
            {isCustomTheme && (
              <>
                <Input
                  label="From colour"
                  type="color"
                  className="h-10 p-1"
                  value={hForm.gradientFrom ?? '#2563eb'}
                  onChange={(e) =>
                    setHForm({ ...hForm, gradientFrom: e.target.value })
                  }
                />
                <Input
                  label={hForm.solid ? 'Colour (unused)' : 'To colour'}
                  type="color"
                  className="h-10 p-1"
                  disabled={hForm.solid}
                  value={hForm.gradientTo ?? '#3b82f6'}
                  onChange={(e) =>
                    setHForm({ ...hForm, gradientTo: e.target.value })
                  }
                />
              </>
            )}
            <Select
              label="Size"
              value={hForm.size}
              onChange={(e) =>
                setHForm({
                  ...hForm,
                  size: e.target.value as DashboardHeaderStyle['size'],
                })
              }
              options={HEADER_SIZES.map((s) => ({ value: s.key, label: s.label }))}
            />
            <Select
              label="Alignment"
              value={hForm.align}
              onChange={(e) =>
                setHForm({
                  ...hForm,
                  align: e.target.value as DashboardHeaderStyle['align'],
                })
              }
              options={HEADER_ALIGNMENTS.map((a) => ({
                value: a.key,
                label: a.label,
              }))}
            />
            <Textarea
              label="Subtitle"
              wrapClassName="sm:col-span-2"
              placeholder="Drag widgets by their handle to arrange your personal layout."
              value={hForm.subtitle ?? ''}
              onChange={(e) =>
                setHForm({ ...hForm, subtitle: e.target.value })
              }
            />
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-4">
                <Checkbox
                  label="Decorative pattern"
                  checked={hForm.pattern !== false}
                  onChange={(e) =>
                    setHForm({ ...hForm, pattern: e.target.checked })
                  }
                />
                <Checkbox
                  label="Hide header banner"
                  checked={!!hForm.hidden}
                  onChange={(e) =>
                    setHForm({ ...hForm, hidden: e.target.checked })
                  }
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Hiding the banner shows the widgets without a header (the layout
                controls still appear when you rearrange widgets). Leave the
                subtitle empty to use the default text. Custom colours apply only
                when the theme is set to “Custom”.
              </p>
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

function WidgetRow({
  id,
  label,
  type,
  onRemove,
}: {
  id: number;
  label: string;
  type?: WidgetType;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900',
        isDragging && 'ring-2 ring-brand-400',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        aria-label="Drag"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <span className="ml-auto text-xs text-slate-400">
        {isStatWidget(type) ? 'stat' : 'wide'}
      </span>
      <button
        onClick={onRemove}
        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
        title="Remove"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
