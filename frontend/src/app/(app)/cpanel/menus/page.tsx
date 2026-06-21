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
  Menu as MenuIcon,
  ChevronRight,
  ListTree,
  Pencil,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { IconPicker } from '@/components/ui/IconPicker';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { resolveIcon } from '@/lib/icons';
import type { Module, MainMenu, SubMenu, ErpObject } from '@/lib/types';

const ROUTE = '/cpanel/menus';

const emptyMain = {
  sortOrder: 0,
  menuName: '',
  objectType: 'FORM',
  isUserMenu: false,
  icon: '',
};
const emptySub = {
  objectId: '',
  sortOrder: 0,
  subMenuName: '',
  objectType: 'FORM',
  description: '',
  route: '',
  icon: '',
};

export default function MenusPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [mainMenus, setMainMenus] = useState<MainMenu[]>([]);
  const [mainLoading, setMainLoading] = useState(false);
  const [selectedMain, setSelectedMain] = useState<MainMenu | null>(null);
  const [subMenus, setSubMenus] = useState<SubMenu[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [objects, setObjects] = useState<ErpObject[]>([]);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // main menu drawer
  const [mOpen, setMOpen] = useState(false);
  const [mEditing, setMEditing] = useState<MainMenu | null>(null);
  const [mForm, setMForm] = useState({ ...emptyMain });
  const [mSaving, setMSaving] = useState(false);

  // sub menu drawer
  const [sOpen, setSOpen] = useState(false);
  const [sEditing, setSEditing] = useState<SubMenu | null>(null);
  const [sForm, setSForm] = useState({ ...emptySub });
  const [sSaving, setSSaving] = useState(false);

  // load the active company's enabled modules; pick first by default
  useEffect(() => {
    api
      .get<Module[]>('/companies/enabled-modules')
      .then((m) => {
        setModules(m ?? []);
        setModuleId((cur) => (m && m.length ? String(m[0].id) : ''));
      })
      .catch(() => {});
  }, [activeCompanyId]);

  const loadMainMenus = useCallback(async () => {
    if (!moduleId) {
      setMainMenus([]);
      return;
    }
    setMainLoading(true);
    try {
      const res = await api.get<MainMenu[]>(`/main-menus?moduleId=${moduleId}`);
      setMainMenus(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load main menus.');
    } finally {
      setMainLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  useEffect(() => {
    setSelectedMain(null);
    setSubMenus([]);
    loadMainMenus();
  }, [loadMainMenus]);

  // load objects for the selected module (used in sub-menu form)
  useEffect(() => {
    if (!moduleId) return;
    api
      .get<{ data: ErpObject[] }>(
        `/objects?moduleId=${moduleId}&page=1&pageSize=500`,
      )
      .then((r) => setObjects(r.data ?? []))
      .catch(() => setObjects([]));
  }, [moduleId]);

  const loadSubMenus = useCallback(async (main: MainMenu) => {
    setSubLoading(true);
    try {
      const res = await api.get<SubMenu[]>(`/sub-menus?mainMenuId=${main.id}`);
      setSubMenus(res ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load sub menus.');
    } finally {
      setSubLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedMain) loadSubMenus(selectedMain);
    else setSubMenus([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMain?.id]);

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.name }));
  const objectOptions = objects
    .filter(
      (o) =>
        !selectedMain?.objectType || o.objectType === selectedMain.objectType,
    )
    .map((o) => ({ value: o.id, label: o.objectName }));

  // ---- Drag reorder ----
  const onReorderMain = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = mainMenus.findIndex((m) => m.id === active.id);
    const newIndex = mainMenus.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(mainMenus, oldIndex, newIndex);
    setMainMenus(next);
    try {
      await api.post('/main-menus/reorder', { ids: next.map((m) => m.id) });
      toast.success('Menu order saved.');
    } catch {
      toast.error('Failed to save order.');
      loadMainMenus();
    }
  };

  const onReorderSub = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = subMenus.findIndex((s) => s.id === active.id);
    const newIndex = subMenus.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(subMenus, oldIndex, newIndex);
    setSubMenus(next);
    try {
      await api.post('/sub-menus/reorder', { ids: next.map((s) => s.id) });
      toast.success('Sub menu order saved.');
    } catch {
      toast.error('Failed to save order.');
      if (selectedMain) loadSubMenus(selectedMain);
    }
  };

  // ---- Main menu CRUD ----
  const openAddMain = () => {
    if (!moduleId) {
      toast.error('Select a module first.');
      return;
    }
    setMEditing(null);
    setMForm({ ...emptyMain, sortOrder: mainMenus.length + 1 });
    setMOpen(true);
  };
  const openEditMain = (m: MainMenu) => {
    setMEditing(m);
    setMForm({
      sortOrder: m.sortOrder ?? 0,
      menuName: m.menuName,
      objectType: m.objectType ?? 'FORM',
      isUserMenu: m.isUserMenu,
      icon: m.icon ?? '',
    });
    setMOpen(true);
  };
  const saveMain = async (again = false) => {
    if (!mForm.menuName.trim()) {
      toast.error('Menu Name is required.');
      return;
    }
    setMSaving(true);
    try {
      const payload = {
        moduleId: Number(moduleId),
        sortOrder: Number(mForm.sortOrder) || 0,
        menuName: mForm.menuName,
        objectType: mForm.objectType,
        isUserMenu: mForm.isUserMenu,
        icon: mForm.icon || null,
      };
      if (mEditing) {
        await api.patch(`/main-menus/${mEditing.id}`, payload);
        toast.success('Main menu updated.');
      } else {
        await api.post('/main-menus', payload);
        toast.success('Main menu created.');
      }
      await loadMainMenus();
      if (again) {
        setMEditing(null);
        setMForm({ ...emptyMain, sortOrder: mainMenus.length + 2 });
      } else setMOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setMSaving(false);
    }
  };
  const removeMain = async (m: MainMenu) => {
    const ok = await confirm({
      title: 'Delete main menu',
      message: `Delete "${m.menuName}" and its sub menus?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/main-menus/${m.id}`);
      toast.success('Main menu deleted.');
      if (selectedMain?.id === m.id) setSelectedMain(null);
      loadMainMenus();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- Sub menu CRUD ----
  const openAddSub = () => {
    if (!selectedMain) return;
    setSEditing(null);
    setSForm({
      ...emptySub,
      sortOrder: subMenus.length + 1,
      objectType: selectedMain.objectType ?? 'FORM',
    });
    setSOpen(true);
  };
  const openEditSub = (s: SubMenu) => {
    setSEditing(s);
    setSForm({
      objectId: s.objectId ? String(s.objectId) : '',
      sortOrder: s.sortOrder ?? 0,
      subMenuName: s.subMenuName,
      objectType: s.objectType ?? 'FORM',
      description: s.description ?? '',
      route: s.route ?? '',
      icon: s.icon ?? '',
    });
    setSOpen(true);
  };
  const saveSub = async (again = false) => {
    if (!selectedMain) return;
    if (!sForm.subMenuName.trim()) {
      toast.error('Sub Menu Name is required.');
      return;
    }
    setSSaving(true);
    try {
      const payload = {
        mainMenuId: selectedMain.id,
        objectId: sForm.objectId ? Number(sForm.objectId) : null,
        sortOrder: Number(sForm.sortOrder) || 0,
        subMenuName: sForm.subMenuName,
        objectType: sForm.objectType,
        description: sForm.description || null,
        route: sForm.route || null,
        icon: sForm.icon || null,
      };
      if (sEditing) {
        await api.patch(`/sub-menus/${sEditing.id}`, payload);
        toast.success('Sub menu updated.');
      } else {
        await api.post('/sub-menus', payload);
        toast.success('Sub menu created.');
      }
      await loadSubMenus(selectedMain);
      if (again) {
        setSEditing(null);
        setSForm({ ...emptySub, sortOrder: subMenus.length + 2 });
      } else setSOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSSaving(false);
    }
  };
  const removeSub = async (s: SubMenu) => {
    const ok = await confirm({
      title: 'Delete sub menu',
      message: `Delete "${s.subMenuName}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/sub-menus/${s.id}`);
      toast.success('Sub menu deleted.');
      if (selectedMain) loadSubMenus(selectedMain);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const onPickObject = (id: string) => {
    const obj = objects.find((o) => String(o.id) === id);
    setSForm((f) => ({
      ...f,
      objectId: id,
      subMenuName: f.subMenuName || obj?.nameInMenu || obj?.objectName || '',
      route: f.route || obj?.route || '',
      objectType: obj?.objectType || f.objectType,
      icon: f.icon || obj?.icon || '',
    }));
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Menu Setup"
        description="Drag the handle to reorder menus; the sidebar follows this order"
        icon={<MenuIcon className="h-5 w-5" />}
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
              <button className="btn-primary" onClick={openAddMain}>
                <Plus className="h-4 w-4" /> Main Menu
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Main menus list */}
        <div className="lg:col-span-5">
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Main Menus
              </h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {mainLoading ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  Loading...
                </p>
              ) : mainMenus.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  No main menus for this module
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onReorderMain}
                >
                  <SortableContext
                    items={mainMenus.map((m) => m.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {mainMenus.map((m) => (
                      <SortableRow key={m.id} id={m.id} disabled={!canEdit}>
                        {(handle) => (
                          <div
                            className={cn(
                              'flex items-center gap-2 border-b border-slate-100 px-2 py-3 transition last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40',
                              selectedMain?.id === m.id &&
                                'bg-brand-50 dark:bg-brand-950/40',
                            )}
                          >
                            {handle}
                            <button
                              onClick={() => setSelectedMain(m)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              {(() => {
                                const Icon = resolveIcon(m.icon);
                                return (
                                  <Icon className="h-[18px] w-[18px] flex-none text-slate-500 dark:text-slate-400" />
                                );
                              })()}
                              <div className="min-w-0">
                                <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                  {m.menuName}
                                  {m.isUserMenu && (
                                    <Badge color="violet">User</Badge>
                                  )}
                                </p>
                                <p className="truncate text-xs text-slate-400">
                                  {m.objectType}
                                </p>
                              </div>
                            </button>
                            <div className="flex flex-none items-center gap-0.5">
                              {canEdit && (
                                <button
                                  onClick={() => openEditMain(m)}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                                  title="Edit"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => removeMain(m)}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                              <ChevronRight
                                className={cn(
                                  'ml-0.5 h-4 w-4 flex-none text-slate-300',
                                  selectedMain?.id === m.id && 'text-brand-500',
                                )}
                              />
                            </div>
                          </div>
                        )}
                      </SortableRow>
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>

        {/* Sub menus */}
        <div className="lg:col-span-7">
          {selectedMain ? (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <ListTree className="h-4 w-4 text-brand-600" />
                  Sub Menus — {selectedMain.menuName}
                </h2>
                {canAdd && (
                  <button className="btn-primary !py-1.5" onClick={openAddSub}>
                    <Plus className="h-4 w-4" /> Sub Menu
                  </button>
                )}
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                {subLoading ? (
                  <p className="p-6 text-center text-sm text-slate-400">
                    Loading...
                  </p>
                ) : subMenus.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-400">
                    No sub menus yet
                  </p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onReorderSub}
                  >
                    <SortableContext
                      items={subMenus.map((s) => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {subMenus.map((s) => (
                        <SortableRow key={s.id} id={s.id} disabled={!canEdit}>
                          {(handle) => (
                            <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-3 transition last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                              {handle}
                              {(() => {
                                const Icon = resolveIcon(s.icon);
                                return (
                                  <Icon className="h-[18px] w-[18px] flex-none text-slate-500 dark:text-slate-400" />
                                );
                              })()}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                  {s.subMenuName}
                                </p>
                                <p className="truncate text-xs text-slate-400">
                                  {s.route || s.objectType}
                                </p>
                              </div>
                              <div className="flex flex-none items-center gap-0.5">
                                {canEdit && (
                                  <button
                                    onClick={() => openEditSub(s)}
                                    className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
                                    title="Edit"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                )}
                                {canDelete && (
                                  <button
                                    onClick={() => removeSub(s)}
                                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </SortableRow>
                      ))}
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </div>
          ) : (
            <div className="card flex h-full min-h-[300px] items-center justify-center p-10 text-center text-sm text-slate-400">
              Select a main menu to view its sub menus
            </div>
          )}
        </div>
      </div>

      {/* Main menu drawer */}
      <Drawer
        open={mOpen}
        onClose={() => setMOpen(false)}
        title={mEditing ? 'Edit Main Menu' : 'New Main Menu'}
        subtitle="Main Menu"
        icon={<MenuIcon className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setMOpen(false)}
            onSave={() => saveMain(false)}
            onSaveNew={mEditing ? undefined : () => saveMain(true)}
            saving={mSaving}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Sort Order"
            type="number"
            value={mForm.sortOrder}
            onChange={(e) =>
              setMForm({ ...mForm, sortOrder: Number(e.target.value) })
            }
          />
          <Input
            label="Menu Name"
            required
            value={mForm.menuName}
            onChange={(e) => setMForm({ ...mForm, menuName: e.target.value })}
          />
          <Select
            label="Module"
            value={moduleId}
            disabled
            options={moduleOptions}
          />
          <Select
            label="Object Type"
            value={mForm.objectType}
            onChange={(e) => setMForm({ ...mForm, objectType: e.target.value })}
            options={[
              { value: 'FORM', label: 'Form' },
              { value: 'REPORT', label: 'Report' },
              { value: 'TABLE', label: 'Table' },
              { value: 'DASHBOARD', label: 'Dashboard' },
            ]}
          />
          <IconPicker
            label="Icon"
            value={mForm.icon}
            onChange={(icon) => setMForm({ ...mForm, icon })}
          />
          <div className="flex items-end pb-2">
            <Checkbox
              label="User Menu"
              checked={mForm.isUserMenu}
              onChange={(e) =>
                setMForm({ ...mForm, isUserMenu: e.target.checked })
              }
            />
          </div>
        </div>
      </Drawer>

      {/* Sub menu drawer */}
      <Drawer
        open={sOpen}
        onClose={() => setSOpen(false)}
        title={sEditing ? 'Edit Sub Menu' : 'New Sub Menu'}
        subtitle={selectedMain?.menuName}
        icon={<ListTree className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setSOpen(false)}
            onSave={() => saveSub(false)}
            onSaveNew={sEditing ? undefined : () => saveSub(true)}
            saving={sSaving}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Sort Order"
            type="number"
            value={sForm.sortOrder}
            onChange={(e) =>
              setSForm({ ...sForm, sortOrder: Number(e.target.value) })
            }
          />
          <Select
            label={
              selectedMain?.objectType
                ? `Object (${selectedMain.objectType})`
                : 'Object'
            }
            value={sForm.objectId}
            onChange={(e) => onPickObject(e.target.value)}
            placeholder="Select object (optional)"
            options={objectOptions}
          />
          <Input
            label="Sub Menu Name"
            required
            wrapClassName="sm:col-span-2"
            value={sForm.subMenuName}
            onChange={(e) => setSForm({ ...sForm, subMenuName: e.target.value })}
          />
          <Input
            label="Route"
            value={sForm.route}
            onChange={(e) => setSForm({ ...sForm, route: e.target.value })}
            placeholder="e.g. /cpanel/objects"
          />
          <IconPicker
            label="Icon"
            value={sForm.icon}
            onChange={(icon) => setSForm({ ...sForm, icon })}
          />
          <Textarea
            label="Description"
            wrapClassName="sm:col-span-2"
            value={sForm.description}
            onChange={(e) =>
              setSForm({ ...sForm, description: e.target.value })
            }
          />
        </div>
      </Drawer>
    </div>
  );
}

// A sortable row that exposes a drag handle to its render-prop child.
function SortableRow({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled?: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : undefined,
    position: 'relative',
    background: isDragging ? 'var(--tw-bg-opacity)' : undefined,
  };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      disabled={disabled}
      className={cn(
        'flex-none cursor-grab rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing dark:hover:bg-slate-800',
        disabled && 'cursor-not-allowed opacity-40',
      )}
      title="Drag to reorder"
      aria-label="Drag handle"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle)}
    </div>
  );
}
