'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Box, Pencil, Trash2, BarChart3, Link2, StickyNote, Globe, Settings2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Module, GadgetCatalogItem, GadgetType } from '@/lib/types';

const ROUTE = '/cpanel/gadgets';

const TYPE_OPTIONS = [
  { value: 'STAT', label: 'Stat — a single count' },
  { value: 'LINKS', label: 'Quick Links — module screens' },
  { value: 'NOTE', label: 'Note — free text' },
  { value: 'EMBED', label: 'Embed — external page (URL)' },
];

const SOURCE_OPTIONS = [
  { value: 'users', label: 'Users' },
  { value: 'groups', label: 'User Groups' },
  { value: 'modules', label: 'Modules' },
  { value: 'companies', label: 'Companies' },
  { value: 'forms', label: 'Forms' },
  { value: 'reports', label: 'Reports' },
  { value: 'tables', label: 'Tables' },
  { value: 'dashboards', label: 'Dashboards' },
  { value: 'moduleObjects', label: 'Objects in this module' },
];

const TYPE_META: Record<GadgetType, { label: string; color: 'blue' | 'violet' | 'amber' | 'green' | 'slate'; icon: React.ReactNode }> = {
  STAT: { label: 'Stat', color: 'blue', icon: <BarChart3 className="h-4 w-4" /> },
  LINKS: { label: 'Links', color: 'violet', icon: <Link2 className="h-4 w-4" /> },
  NOTE: { label: 'Note', color: 'amber', icon: <StickyNote className="h-4 w-4" /> },
  EMBED: { label: 'Embed', color: 'green', icon: <Globe className="h-4 w-4" /> },
  BUILTIN: { label: 'Built-in', color: 'slate', icon: <Settings2 className="h-4 w-4" /> },
};

const empty = {
  name: '',
  type: 'STAT' as GadgetType,
  description: '',
  isActive: true,
  source: 'users',
  hint: '',
  text: '',
  url: '',
  height: 240,
};

export default function GadgetsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [gadgets, setGadgets] = useState<GadgetCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GadgetCatalogItem | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

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
      setGadgets([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<GadgetCatalogItem[]>(`/gadgets?moduleId=${moduleId}`);
      setGadgets(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load gadgets.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  useEffect(() => {
    load();
  }, [load]);

  const { canToggle, toggleLock, guardEdit, guardDelete } =
    useLock<GadgetCatalogItem>({
      endpoint: '/gadgets',
      noun: 'gadget',
      nameOf: (g) => g.name,
      reload: load,
    });

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.name }));

  const openAdd = () => {
    if (!moduleId) {
      toast.error('Select a module first.');
      return;
    }
    setEditing(null);
    setForm({ ...empty });
    setOpen(true);
  };
  const openEdit = (g: GadgetCatalogItem) => {
    setEditing(g);
    setForm({
      name: g.name,
      type: g.type,
      description: g.description ?? '',
      isActive: g.isActive,
      source: g.config?.source ?? 'users',
      hint: g.config?.hint ?? '',
      text: g.config?.text ?? '',
      url: g.config?.url ?? '',
      height: g.config?.height ?? 240,
    });
    setOpen(true);
  };

  const buildConfig = () => {
    switch (form.type) {
      case 'STAT':
        return { source: form.source, hint: form.hint || undefined };
      case 'NOTE':
        return { text: form.text };
      case 'EMBED':
        return { url: form.url, height: Number(form.height) || 240 };
      default:
        return {};
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.type === 'EMBED' && !form.url.trim()) {
      toast.error('Embed gadgets need a URL.');
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
        await api.patch(`/gadgets/${editing.id}`, payload);
        toast.success('Gadget updated.');
      } else {
        await api.post('/gadgets', payload);
        toast.success('Gadget created.');
      }
      await load();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: GadgetCatalogItem) => {
    const ok = await confirm({
      title: 'Delete gadget',
      message: `Delete "${g.name}"? It will be removed from any dashboards using it.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/gadgets/${g.id}`);
      toast.success('Gadget deleted.');
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const isBuiltin = editing?.type === 'BUILTIN';

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Gadgets"
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
                <Plus className="h-4 w-4" /> Gadget
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
      ) : gadgets.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <Box className="h-8 w-8" />
          <p className="text-sm">No gadgets for this module yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {gadgets.map((g) => {
            const meta = TYPE_META[g.type];
            return (
              <div key={g.id} className="card flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
                      {g.name}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {g.code} · {g._count?.placements ?? 0} dashboards
                    </p>
                  </div>
                  <Badge color={meta.color}>{meta.label}</Badge>
                </div>
                {g.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                    {g.description}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-end gap-1">
                  {!g.isActive && <Badge color="slate">Inactive</Badge>}
                  {canEdit && (
                    <button
                      onClick={() => guardEdit(g, () => openEdit(g))}
                      className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => guardDelete(g, () => remove(g))}
                      className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <LockButton
                    locked={g.isLocked}
                    canToggle={canToggle}
                    onToggle={() => toggleLock(g)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Gadget' : 'New Gadget'}
        subtitle="Dashboard gadget"
        icon={<Box className="h-5 w-5" />}
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
            label="Type"
            value={form.type}
            disabled={isBuiltin}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as GadgetType })
            }
            options={
              isBuiltin
                ? [{ value: 'BUILTIN', label: 'Built-in (rendered by code)' }]
                : TYPE_OPTIONS
            }
          />

          {isBuiltin && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/50 sm:col-span-2">
              This is a system gadget rendered by its code; only its name,
              description and status can be changed.
            </p>
          )}

          {/* Type-specific config */}
          {!isBuiltin && form.type === 'STAT' && (
            <>
              <Select
                label="Count of"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                options={SOURCE_OPTIONS}
              />
              <Input
                label="Hint (subtitle)"
                value={form.hint}
                onChange={(e) => setForm({ ...form, hint: e.target.value })}
                placeholder="e.g. Active records"
              />
            </>
          )}
          {!isBuiltin && form.type === 'NOTE' && (
            <Textarea
              label="Text"
              wrapClassName="sm:col-span-2"
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              placeholder="Anything you want to show on the dashboard…"
            />
          )}
          {!isBuiltin && form.type === 'EMBED' && (
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
          {!isBuiltin && form.type === 'LINKS' && (
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
        </div>
      </Drawer>
    </div>
  );
}
