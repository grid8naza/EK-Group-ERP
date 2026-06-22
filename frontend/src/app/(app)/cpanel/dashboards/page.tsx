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
  Pencil,
  Trash2,
  GripVertical,
  Star,
  LayoutGrid,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { IconPicker } from '@/components/ui/IconPicker';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { resolveIcon } from '@/lib/icons';
import { isStatGadget } from '@/components/dashboard/WidgetView';
import type {
  Module,
  UserGroup,
  DashboardSummary,
  DashboardDetail,
  GadgetType,
} from '@/lib/types';

const ROUTE = '/cpanel/dashboards';

interface Gadget {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  type?: GadgetType;
}

const emptyForm = {
  name: '',
  icon: 'layout-dashboard',
  userGroupId: '',
  isDefault: false,
  isActive: true,
};

export default function DashboardsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // dashboard drawer
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DashboardSummary | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // widget editor drawer
  const [wOpen, setWOpen] = useState(false);
  const [wDashboard, setWDashboard] = useState<DashboardSummary | null>(null);
  const [catalog, setCatalog] = useState<Gadget[]>([]);
  const [selected, setSelected] = useState<number[]>([]); // gadget ids, ordered
  const [wSaving, setWSaving] = useState(false);

  useEffect(() => {
    api
      .get<Module[]>('/companies/enabled-modules')
      .then((m) => {
        setModules(m ?? []);
        setModuleId((cur) => (m && m.length ? String(m[0].id) : ''));
      })
      .catch(() => {});
  }, [activeCompanyId]);

  useEffect(() => {
    api
      .get<UserGroup[]>('/user-groups')
      .then((g) => setGroups(g ?? []))
      .catch(() => setGroups([]));
  }, [activeCompanyId]);

  const load = useCallback(async () => {
    if (!moduleId) {
      setDashboards([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<DashboardSummary[]>(
        `/dashboards?moduleId=${moduleId}`,
      );
      setDashboards(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load dashboards.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

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
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));

  // ---- Dashboard CRUD ----
  const openAdd = () => {
    if (!moduleId) {
      toast.error('Select a module first.');
      return;
    }
    setEditing(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };
  const openEdit = (d: DashboardSummary) => {
    setEditing(d);
    setForm({
      name: d.name,
      icon: d.icon ?? 'layout-dashboard',
      userGroupId: d.userGroupId ? String(d.userGroupId) : '',
      isDefault: d.isDefault,
      isActive: d.isActive,
    });
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
        userGroupId: form.userGroupId ? Number(form.userGroupId) : null,
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
        api.get<Gadget[]>(`/dashboards/gadgets?moduleId=${d.moduleId}`),
        api.get<DashboardDetail>(`/dashboards/${d.id}`),
      ]);
      setCatalog(cat ?? []);
      setSelected((detail.widgets ?? []).map((w) => w.gadgetId));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load widgets.');
    }
  };
  const toggleWidget = (gadgetId: number, checked: boolean) => {
    setSelected((cur) =>
      checked ? [...cur, gadgetId] : cur.filter((id) => id !== gadgetId),
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
      const widgets = selected.map((gadgetId) => {
        const g = byId.get(gadgetId);
        return {
          gadgetId,
          width: g && isStatGadget(g.code, g.type) ? 1 : 2,
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

  const catalogById = new Map(catalog.map((g) => [g.id, g]));
  const unselected = catalog.filter((g) => !selected.includes(g.id));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dashboards"
        description="Create dashboards per module & user group; users pick them from the left panel"
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
                      {d.userGroup?.name ?? 'All groups'} · {d._count?.widgets ?? 0}{' '}
                      widgets
                    </p>
                  </div>
                  {!d.isActive && <Badge color="slate">Inactive</Badge>}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => openWidgets(d)}
                    className="btn-secondary flex-1 !py-1.5"
                  >
                    <LayoutGrid className="h-4 w-4" /> Widgets
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => guardEdit(d, () => openEdit(d))}
                      className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => guardDelete(d, () => remove(d))}
                      className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <LockButton
                    locked={d.isLocked}
                    canToggle={canToggle}
                    onToggle={() => toggleLock(d)}
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
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Dashboard' : 'New Dashboard'}
        subtitle="Dashboard"
        icon={<LayoutDashboard className="h-5 w-5" />}
        footer={
          <DrawerFooter onCancel={() => setOpen(false)} onSave={save} saving={saving} />
        }
      >
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
            label="User Group"
            value={form.userGroupId}
            onChange={(e) => setForm({ ...form, userGroupId: e.target.value })}
            placeholder="All groups"
            options={groupOptions}
          />
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
              Only one dashboard per module can be the default — marking this one
              clears it on the others.
            </p>
          </div>
        </div>
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
                          code={g.code}
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
                      {isStatGadget(g.code, g.type) ? 'stat' : 'wide'}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}

function WidgetRow({
  id,
  label,
  code,
  type,
  onRemove,
}: {
  id: number;
  label: string;
  code: string;
  type?: GadgetType;
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
        {isStatGadget(code, type) ? 'stat' : 'wide'}
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
