'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  ShieldCheck,
  KeyRound,
  LayoutDashboard,
  ChevronDown,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Input, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { resolveIcon } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type {
  UserGroup,
  Module,
  PrivilegesResponse,
  PrivilegeModuleGroup,
} from '@/lib/types';

const ROUTE = '/cpanel/user-groups';

const empty = {
  name: '',
  description: '',
  moduleIds: [] as number[],
};

type PrivKey =
  | 'canMenu'
  | 'canView'
  | 'canAdd'
  | 'canEdit'
  | 'canDelete'
  | 'canPrint'
  | 'canDownloadPdf'
  | 'canDownloadExcel';

// Resets every action (used when a menu is hidden).
const ALL_ACTIONS: Record<PrivKey, boolean> = {
  canMenu: false,
  canView: false,
  canAdd: false,
  canEdit: false,
  canDelete: false,
  canPrint: false,
  canDownloadPdf: false,
  canDownloadExcel: false,
};

// Action columns shown after MENU. Forms/tables use Add/Edit/Delete; reports
// use Print / PDF / Excel. View applies to both.
const ACTION_COLS: {
  key: PrivKey;
  header: string;
  forForm: boolean;
  forReport: boolean;
}[] = [
  { key: 'canView', header: 'View', forForm: true, forReport: true },
  { key: 'canAdd', header: 'Add', forForm: true, forReport: false },
  { key: 'canEdit', header: 'Edit', forForm: true, forReport: false },
  { key: 'canDelete', header: 'Delete', forForm: true, forReport: false },
  { key: 'canPrint', header: 'Print', forForm: false, forReport: true },
  { key: 'canDownloadPdf', header: 'PDF', forForm: false, forReport: true },
  { key: 'canDownloadExcel', header: 'Excel', forForm: false, forReport: true },
];

const isReport = (objectType?: string | null) =>
  (objectType ?? '').toUpperCase() === 'REPORT';

export default function UserGroupsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: groups, loading, refetch } =
    useFetch<UserGroup[]>('/user-groups');
  const [modules, setModules] = useState<Module[]>([]);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');

  // group drawer
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserGroup | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  // privileges drawer
  const [privOpen, setPrivOpen] = useState(false);
  const [privGroup, setPrivGroup] = useState<UserGroup | null>(null);
  const [privModules, setPrivModules] = useState<PrivilegeModuleGroup[]>([]);
  const [privLoading, setPrivLoading] = useState(false);
  const [privSaving, setPrivSaving] = useState(false);
  // Modules whose privilege details are collapsed (by module id).
  const [collapsedModules, setCollapsedModules] = useState<Set<number>>(
    new Set(),
  );
  const toggleModuleCollapsed = (moduleId: number) =>
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

  useEffect(() => {
    api
      .get<Module[]>('/companies/enabled-modules')
      // Core modules are super-admin only and cannot be granted to a group.
      .then((m) => setModules((m ?? []).filter((x) => !x.isCore)))
      .catch(() => {});
  }, [activeCompanyId]);

  // ---- Group CRUD ----
  const openAdd = () => {
    setEditing(null);
    setForm({ ...empty, moduleIds: [] });
    setOpen(true);
  };
  const openEdit = (g: UserGroup) => {
    setEditing(g);
    setForm({
      name: g.name,
      description: g.description ?? '',
      moduleIds: g.modules?.map((m) => m.id) ?? [],
    });
    setOpen(true);
  };
  const toggleFormModule = (id: number) =>
    setForm((f) => ({
      ...f,
      moduleIds: f.moduleIds.includes(id)
        ? f.moduleIds.filter((m) => m !== id)
        : [...f.moduleIds, id],
    }));
  const save = async (again = false) => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.moduleIds.length === 0) {
      toast.error('Select at least one module.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        moduleIds: form.moduleIds,
      };
      if (editing) {
        await api.patch(`/user-groups/${editing.id}`, payload);
        toast.success('Group updated.');
      } else {
        await api.post('/user-groups', payload);
        toast.success('Group created.');
      }
      await refetch();
      if (again) {
        setEditing(null);
        setForm({ ...empty });
      } else setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (g: UserGroup) => {
    const ok = await confirm({
      title: 'Delete group',
      message: `Delete "${g.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/user-groups/${g.id}`);
      toast.success('Group deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- Privileges ----
  const openPrivileges = async (g: UserGroup) => {
    setPrivGroup(g);
    setPrivOpen(true);
    setPrivLoading(true);
    setPrivModules([]);
    try {
      const res = await api.get<PrivilegesResponse>(
        `/user-groups/${g.id}/privileges`,
      );
      const mods = res.modules ?? [];
      setPrivModules(mods);
      // Start with every module collapsed; click a module to reveal its details.
      setCollapsedModules(new Set(mods.map((m) => m.module.id)));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load privileges.');
    } finally {
      setPrivLoading(false);
    }
  };

  // Map a single main-menu node within the module-grouped structure.
  const mapNode = (
    mainId: number,
    fn: (n: PrivilegeModuleGroup['tree'][number]) => PrivilegeModuleGroup['tree'][number],
  ) =>
    setPrivModules((prev) =>
      prev.map((mg) => ({
        ...mg,
        tree: mg.tree.map((n) => (n.mainMenu.id === mainId ? fn(n) : n)),
      })),
    );

  const setMainVisible = (mainId: number, visible: boolean) => {
    mapNode(mainId, (n) => ({
      ...n,
      visible,
      // when hiding the main menu, also clear sub privileges
      subMenus: visible
        ? n.subMenus
        : n.subMenus.map((s) => ({ ...s, ...ALL_ACTIONS })),
    }));
  };

  const setSubPriv = (
    mainId: number,
    subId: number,
    key: PrivKey,
    value: boolean,
  ) => {
    mapNode(mainId, (n) => ({
      ...n,
      subMenus: n.subMenus.map((s) => {
        if (s.id !== subId) return s;
        // Unchecking MENU hides the screen, so clear its actions too.
        if (key === 'canMenu' && !value) return { ...s, ...ALL_ACTIONS };
        return { ...s, [key]: value };
      }),
    }));
  };

  const toggleAllForMain = (mainId: number, value: boolean) => {
    mapNode(mainId, (n) => ({
      ...n,
      visible: value || n.visible,
      subMenus: n.subMenus.map((s) => {
        const rep = isReport(s.objectType);
        return {
          ...s,
          canMenu: value,
          canView: value,
          // only the actions that apply to this object type
          canAdd: rep ? false : value,
          canEdit: rep ? false : value,
          canDelete: rep ? false : value,
          canPrint: rep ? value : false,
          canDownloadPdf: rep ? value : false,
          canDownloadExcel: rep ? value : false,
        };
      }),
    }));
  };

  const toggleGadget = (moduleId: number, gadgetId: number) => {
    setPrivModules((prev) =>
      prev.map((mg) =>
        mg.module.id === moduleId
          ? {
              ...mg,
              gadgets: mg.gadgets.map((g) =>
                g.id === gadgetId ? { ...g, selected: !g.selected } : g,
              ),
            }
          : mg,
      ),
    );
  };

  const savePrivileges = async () => {
    if (!privGroup) return;
    setPrivSaving(true);
    try {
      const mainMenuAccess = privModules.flatMap((mg) =>
        mg.tree.map((n) => ({
          mainMenuId: n.mainMenu.id,
          visible: n.visible,
        })),
      );
      const subMenuPrivileges = privModules.flatMap((mg) =>
        mg.tree.flatMap((n) =>
          n.subMenus.map((s) => ({
            subMenuId: s.id,
            canMenu: s.canMenu,
            canView: s.canView,
            canAdd: s.canAdd,
            canEdit: s.canEdit,
            canDelete: s.canDelete,
            canPrint: s.canPrint,
            canDownloadPdf: s.canDownloadPdf,
            canDownloadExcel: s.canDownloadExcel,
          })),
        ),
      );
      const gadgetIds = privModules.flatMap((mg) =>
        mg.gadgets.filter((g) => g.selected).map((g) => g.id),
      );
      await api.put(`/user-groups/${privGroup.id}/privileges`, {
        mainMenuAccess,
        subMenuPrivileges,
        gadgetIds,
      });
      toast.success('Privileges saved.');
      setPrivOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setPrivSaving(false);
    }
  };

  const columns: Column<UserGroup>[] = [
    {
      key: 'name',
      header: 'Group Name',
      render: (r) => (
        <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'modules',
      header: 'Modules',
      render: (r) =>
        r.modules && r.modules.length ? (
          <span className="flex flex-wrap gap-1">
            {r.modules.map((m) => (
              <Badge key={m.id} color="blue">
                {m.name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: 'description', header: 'Description', accessor: (r) => r.description },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="User Groups & Privileges"
        description="Manage groups and their menu / action privileges"
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={groups ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={refetch}
        searchPlaceholder="Search groups..."
        onEdit={openEdit}
        onDelete={remove}
        canEdit={canEdit}
        canDelete={canDelete}
        emptyMessage="No user groups found"
        rowActions={(r) => (
          <button
            onClick={() => openPrivileges(r)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950"
            title="Privileges"
          >
            <KeyRound className="h-4 w-4" /> Privileges
          </button>
        )}
      />

      {/* Group drawer */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Group' : 'New Group'}
        subtitle="User group"
        icon={<ShieldCheck className="h-5 w-5" />}
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={() => save(false)}
            onSaveNew={editing ? undefined : () => save(true)}
            saving={saving}
          />
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div>
            <label className="label">
              Modules<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <p className="mb-2 text-xs text-slate-400">
              A group can manage one or more modules. Users in this group will
              see the selected modules in the top module switcher.
            </p>
            {modules.length === 0 ? (
              <p className="text-sm text-slate-400">No modules available</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {modules.map((m) => {
                  const active = form.moduleIds.includes(m.id);
                  const Icon = resolveIcon(m.icon);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleFormModule(m.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                        active
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {m.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Textarea
            label="Description"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
          />
        </div>
      </Drawer>

      {/* Privileges matrix drawer */}
      <Drawer
        open={privOpen}
        onClose={() => setPrivOpen(false)}
        title="Privileges"
        subtitle={privGroup?.name}
        icon={<KeyRound className="h-5 w-5" />}
        width="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              className="btn-secondary"
              onClick={() => setPrivOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn-success"
              onClick={savePrivileges}
              disabled={privSaving || privLoading}
            >
              {privSaving ? 'Saving...' : 'Save Privileges'}
            </button>
          </div>
        }
      >
        {privLoading ? (
          <p className="py-12 text-center text-sm text-slate-400">
            Loading privileges...
          </p>
        ) : privModules.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">
            No modules assigned to this group.
          </p>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Enable the <span className="font-medium">Menu</span> visibility for
              each main menu, then grant per-screen actions. Forms use{' '}
              <span className="font-medium">Add / Edit / Delete</span>; reports
              use <span className="font-medium">Print / PDF / Excel</span> (
              <span className="text-slate-400">—</span> = not applicable).
            </p>
            {privModules.map((grp) => {
              const ModIcon = resolveIcon(grp.module.icon);
              const collapsed = collapsedModules.has(grp.module.id);
              const menuCount = grp.tree.length;
              return (
                <section key={grp.module.id}>
                  {/* Module heading — click to expand / collapse its details */}
                  <button
                    type="button"
                    onClick={() => toggleModuleCollapsed(grp.module.id)}
                    aria-expanded={!collapsed}
                    className="flex w-full items-center gap-2 border-b border-slate-200 pb-2 text-left text-base font-semibold text-slate-800 transition hover:text-brand-600 dark:border-slate-800 dark:text-slate-100"
                  >
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 flex-none text-slate-400 transition-transform',
                        collapsed && '-rotate-90',
                      )}
                    />
                    <ModIcon className="h-5 w-5 text-brand-600" />
                    {grp.module.name}
                    <span className="text-xs font-normal text-slate-400">
                      module
                    </span>
                    <span className="ml-auto text-xs font-normal text-slate-400">
                      {menuCount} {menuCount === 1 ? 'menu' : 'menus'}
                    </span>
                  </button>
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-in-out',
                      collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
                    )}
                  >
                  <div className="overflow-hidden">
                  <div className="space-y-3 pt-3">
                  {grp.tree.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No menus in this module.
                    </p>
                  )}
                  {grp.tree.map((node) => (
                    <div
                      key={node.mainMenu.id}
                      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
                    >
                {/* Main menu header */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                      checked={node.visible}
                      onChange={(e) =>
                        setMainVisible(node.mainMenu.id, e.target.checked)
                      }
                    />
                    {node.mainMenu.menuName}
                    <span className="text-xs font-normal text-slate-400">
                      (Menu visibility)
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600 hover:underline"
                      onClick={() => toggleAllForMain(node.mainMenu.id, true)}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-400 hover:underline"
                      onClick={() => toggleAllForMain(node.mainMenu.id, false)}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Sub menu matrix */}
                {node.subMenus.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-400">
                    No sub menus.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="px-4 py-2 text-left">Sub Menu</th>
                          {['Menu', ...ACTION_COLS.map((c) => c.header)].map(
                            (h) => (
                              <th
                                key={h}
                                className="px-3 py-2 text-center"
                                style={{ width: 64 }}
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {node.subMenus.map((s) => (
                          <tr
                            key={s.id}
                            className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                          >
                            <td className="px-4 py-2">
                              <span
                                className={cn(
                                  'font-medium text-slate-700 dark:text-slate-200',
                                  !s.canMenu && 'opacity-50',
                                )}
                                title={
                                  !s.canMenu
                                    ? 'Hidden — MENU is unchecked'
                                    : undefined
                                }
                              >
                                {s.subMenuName}
                              </span>
                              {s.objectType && (
                                <span className="ml-2 text-xs text-slate-400">
                                  {s.objectType}
                                </span>
                              )}
                            </td>
                            {/* MENU visibility */}
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                                checked={s.canMenu}
                                onChange={(e) =>
                                  setSubPriv(
                                    node.mainMenu.id,
                                    s.id,
                                    'canMenu',
                                    e.target.checked,
                                  )
                                }
                              />
                            </td>
                            {/* Action columns — only those that apply to this
                                object type (forms vs reports) are checkable. */}
                            {ACTION_COLS.map((col) => {
                              const applies = isReport(s.objectType)
                                ? col.forReport
                                : col.forForm;
                              if (!applies) {
                                return (
                                  <td
                                    key={col.key}
                                    className="px-3 py-2 text-center text-slate-300 dark:text-slate-700"
                                  >
                                    —
                                  </td>
                                );
                              }
                              // Actions are meaningless when the menu is hidden,
                              // so disable them until MENU is checked.
                              const disabled = !s.canMenu;
                              return (
                                <td
                                  key={col.key}
                                  className="px-3 py-2 text-center"
                                >
                                  <input
                                    type="checkbox"
                                    disabled={disabled}
                                    title={
                                      disabled
                                        ? 'Enable MENU first to grant this action'
                                        : undefined
                                    }
                                    className={cn(
                                      'h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800',
                                      disabled &&
                                        'cursor-not-allowed opacity-40',
                                    )}
                                    checked={s[col.key]}
                                    onChange={(e) =>
                                      setSubPriv(
                                        node.mainMenu.id,
                                        s.id,
                                        col.key,
                                        e.target.checked,
                                      )
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                    </div>
                  ))}

                  {/* Dashboard gadgets for this module */}
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <LayoutDashboard className="h-4 w-4 text-brand-600" />
                      Dashboard Gadgets
                    </div>
                    <p className="mb-3 text-xs text-slate-400">
                      Selected gadgets appear on the {grp.module.name} dashboard
                      for users in this group.
                    </p>
                    {grp.gadgets.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No gadgets for this module.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {grp.gadgets.map((g) => (
                          <label
                            key={g.id}
                            className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                              checked={g.selected}
                              onChange={() =>
                                toggleGadget(grp.module.id, g.id)
                              }
                            />
                            <span>
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {g.name}
                              </span>
                              {g.description && (
                                <span className="block text-xs text-slate-400">
                                  {g.description}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>
                  </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Drawer>
    </div>
  );
}
