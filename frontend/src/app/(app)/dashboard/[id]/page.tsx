'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
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
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, RotateCcw, Save, LayoutDashboard } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { resolveIcon } from '@/lib/icons';
import {
  WidgetView,
  isStatGadget,
  type DashAggregates,
} from '@/components/dashboard/WidgetView';
import type {
  DashboardDetail,
  DashboardWidget,
  ObjectListResponse,
  Module,
  UserGroup,
  AppUser,
} from '@/lib/types';

export default function DashboardViewPage() {
  const params = useParams();
  const id = Number(params?.id);
  const { user, activeModule } = useAuth();
  const toast = useToast();

  const [detail, setDetail] = useState<DashboardDetail | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [agg, setAgg] = useState<DashAggregates | null>(null);
  const [aggLoading, setAggLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const loadDashboard = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await api.get<DashboardDetail>(`/dashboards/${id}`);
      setDetail(d);
      setWidgets((d.widgets ?? []).filter((w) => !w.hidden));
      setDirty(false);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Aggregate counts powering the stat widgets (company-scoped via header).
  useEffect(() => {
    let cancelled = false;
    setAggLoading(true);
    (async () => {
      const moduleId = detail?.moduleId;
      const [
        objects,
        modules,
        groups,
        users,
        companies,
        recent,
        modObjects,
        units,
        categories,
      ] = await Promise.allSettled([
        api.get<ObjectListResponse>('/objects?page=1&pageSize=1'),
        api.get<Module[]>('/companies/enabled-modules'),
        api.get<UserGroup[]>('/user-groups'),
        api.get<AppUser[]>('/users'),
        api.get<unknown[]>('/companies'),
        api.get<ObjectListResponse>('/objects?page=1&pageSize=5'),
        moduleId
          ? api.get<ObjectListResponse>(
              `/objects?moduleId=${moduleId}&page=1&pageSize=1`,
            )
          : Promise.resolve(null),
        api.get<unknown[]>('/units'),
        api.get<unknown[]>('/categories'),
      ]);
      if (cancelled) return;
      const ok = <T,>(r: PromiseSettledResult<T>): T | null =>
        r.status === 'fulfilled' ? r.value : null;
      const counts = ok(objects)?.counts ?? { forms: 0, reports: 0, tables: 0 };
      setAgg({
        forms: counts.forms ?? 0,
        reports: counts.reports ?? 0,
        tables: counts.tables ?? 0,
        dashboards: counts.dashboards ?? 0,
        modules: ok(modules)?.length ?? 0,
        groups: ok(groups)?.length ?? 0,
        users: ok(users)?.length ?? 0,
        companies: ok(companies)?.length ?? 0,
        recent: ok(recent)?.data ?? [],
        moduleObjects:
          ok(modObjects as PromiseSettledResult<ObjectListResponse>)?.total ?? 0,
        units: ok(units)?.length ?? 0,
        categories: ok(categories)?.length ?? 0,
      });
      setAggLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [detail?.moduleId]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setWidgets((items) => {
      const oldIndex = items.findIndex((w) => w.gadgetId === active.id);
      const newIndex = items.findIndex((w) => w.gadgetId === over.id);
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
    setDirty(true);
  };

  const saveLayout = async () => {
    setSaving(true);
    try {
      const res = await api.put<DashboardDetail>(`/dashboards/${id}/my-layout`, {
        widgets: widgets.map((w) => ({ gadgetId: w.gadgetId })),
      });
      setDetail(res);
      setDirty(false);
      toast.success('Layout saved.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save layout.');
    } finally {
      setSaving(false);
    }
  };

  const resetLayout = async () => {
    setSaving(true);
    try {
      const res = await api.delete<DashboardDetail>(`/dashboards/${id}/my-layout`);
      setDetail(res);
      setWidgets((res.widgets ?? []).filter((w) => !w.hidden));
      setDirty(false);
      toast.success('Layout reset to default.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to reset.');
    } finally {
      setSaving(false);
    }
  };

  const DashIcon = useMemo(
    () => resolveIcon(detail?.icon) || LayoutDashboard,
    [detail?.icon],
  );

  if (!loading && !detail) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <LayoutDashboard className="h-8 w-8" />
          <p className="text-sm">Dashboard not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="card mb-6 overflow-hidden">
        <div className="relative bg-gradient-to-r from-brand-600 to-brand-500 p-6 text-white sm:p-8">
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-brand-100">
                <DashIcon className="h-4 w-4" />
                {detail?.module?.name ?? activeModule?.name ?? 'Dashboard'}
                {detail?.userGroup ? ` · ${detail.userGroup.name}` : ''}
              </p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
                {detail?.name ?? 'Dashboard'}
              </h1>
              <p className="mt-2 max-w-lg text-sm text-brand-50">
                Drag widgets by their handle to arrange your personal layout.
              </p>
            </div>
            <div className="flex flex-none flex-wrap items-center justify-end gap-2">
              {dirty && (
                <button
                  onClick={saveLayout}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-2 text-sm font-medium backdrop-blur transition hover:bg-white/30"
                >
                  <Save className="h-4 w-4" /> Save layout
                </button>
              )}
              {detail?.isCustomized && (
                <button
                  onClick={resetLayout}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium backdrop-blur transition hover:bg-white/20"
                  title="Reset to the default layout"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card h-28 animate-pulse" />
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <LayoutDashboard className="h-8 w-8" />
          <p className="text-sm">This dashboard has no widgets yet.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={widgets.map((w) => w.gadgetId)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {widgets.map((w) => (
                <SortableWidget
                  key={w.gadgetId}
                  widget={w}
                  data={agg}
                  loading={aggLoading}
                  user={user}
                  activeModule={activeModule}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableWidget({
  widget,
  data,
  loading,
  user,
  activeModule,
}: {
  widget: DashboardWidget;
  data: DashAggregates | null;
  loading: boolean;
  user: ReturnType<typeof useAuth>['user'];
  activeModule: ReturnType<typeof useAuth>['activeModule'];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.gadgetId });

  const wide = widget.width >= 2 && !isStatGadget(widget.code, widget.type);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'group relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900',
        wide ? 'sm:col-span-2 xl:col-span-2' : '',
        isDragging ? 'opacity-80 ring-2 ring-brand-400' : '',
      ].join(' ')}
    >
      <button
        {...attributes}
        {...listeners}
        className="absolute right-2 top-2 z-10 cursor-grab rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100 active:cursor-grabbing dark:hover:bg-slate-800"
        title="Drag to reorder"
        aria-label="Drag handle"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <WidgetView
        code={widget.code}
        name={widget.name}
        description={widget.description}
        type={widget.type}
        config={widget.config}
        data={data}
        loading={loading}
        user={user}
        activeModule={activeModule}
      />
    </div>
  );
}
