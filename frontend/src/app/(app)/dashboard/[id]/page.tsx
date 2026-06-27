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
import { cn } from '@/lib/utils';
import { resolveDashboardHeader } from '@/lib/dashboard-header';
import { WidgetView, isStatWidget } from '@/components/dashboard/WidgetView';
import type {
  DashboardDetail,
  DashboardWidget,
  MetricValue,
} from '@/lib/types';

export default function DashboardViewPage() {
  const params = useParams();
  const id = Number(params?.id);
  const { activeModule } = useAuth();
  const toast = useToast();

  const [detail, setDetail] = useState<DashboardDetail | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricValues, setMetricValues] = useState<Record<string, MetricValue> | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
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

  // Live values for METRIC widgets — computed server-side for the active
  // company/branch from each module's metric registry.
  useEffect(() => {
    const keys = (detail?.widgets ?? [])
      .filter((w) => w.type === 'METRIC' && w.config?.metric)
      .map((w) => w.config!.metric as string);
    if (keys.length === 0) {
      setMetricValues(null);
      setMetricsLoading(false);
      return;
    }
    let cancelled = false;
    setMetricsLoading(true);
    api
      .post<Record<string, MetricValue>>('/widgets/metric-values', { keys })
      .then((res) => {
        if (!cancelled) setMetricValues(res ?? {});
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setWidgets((items) => {
      const oldIndex = items.findIndex((w) => w.widgetId === active.id);
      const newIndex = items.findIndex((w) => w.widgetId === over.id);
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
    setDirty(true);
  };

  const saveLayout = async () => {
    setSaving(true);
    try {
      const res = await api.put<DashboardDetail>(`/dashboards/${id}/my-layout`, {
        widgets: widgets.map((w) => ({ widgetId: w.widgetId })),
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

  const header = useMemo(
    () => resolveDashboardHeader(detail?.header),
    [detail?.header],
  );
  const centered = header.align === 'center';

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
        <div
          className={cn(header.containerClass, header.padClass)}
          style={header.containerStyle}
        >
          {header.pattern && (
            <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
          )}
          <div
            className={cn(
              'relative flex gap-4',
              centered
                ? 'flex-col items-center text-center'
                : 'items-start justify-between',
            )}
          >
            <div className={centered ? 'max-w-2xl' : undefined}>
              <p
                className={cn(
                  'flex items-center gap-2 text-sm font-medium',
                  centered && 'justify-center',
                  header.labelClass,
                )}
              >
                <DashIcon className="h-4 w-4" />
                {detail?.module?.name ?? activeModule?.name ?? 'Dashboard'}
              </p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
                {detail?.name ?? 'Dashboard'}
              </h1>
              <p
                className={cn(
                  'mt-2 max-w-lg text-sm',
                  centered && 'mx-auto',
                  header.subtitleClass,
                )}
              >
                {header.subtitle}
              </p>
            </div>
            <div
              className={cn(
                'flex flex-none flex-wrap items-center gap-2',
                centered ? 'justify-center' : 'justify-end',
              )}
            >
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
            items={widgets.map((w) => w.widgetId)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {widgets.map((w) => (
                <SortableWidget
                  key={w.widgetId}
                  widget={w}
                  metrics={metricValues}
                  loading={metricsLoading}
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
  metrics,
  loading,
  activeModule,
}: {
  widget: DashboardWidget;
  metrics: Record<string, MetricValue> | null;
  loading: boolean;
  activeModule: ReturnType<typeof useAuth>['activeModule'];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.widgetId });

  const wide = widget.width >= 2 && !isStatWidget(widget.type);

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
        'group relative rounded-2xl',
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
        name={widget.name}
        description={widget.description}
        type={widget.type}
        config={widget.config}
        metrics={metrics}
        loading={loading}
        activeModule={activeModule}
      />
    </div>
  );
}
