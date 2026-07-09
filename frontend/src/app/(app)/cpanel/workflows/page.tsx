'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Workflow as WorkflowIcon,
  Trash2,
  ChevronUp,
  ChevronDown,
  Users,
  Check,
  Search,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Drawer, DrawerFooter, CloseFooter, type SaveMode } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Tabs } from '@/components/ui/Tabs';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStatus,
  WorkflowActionType,
  WorkflowApprovalMode,
  Company,
  Branch,
  Module,
  UserGroup,
  User,
  ErpObject,
  ObjectListResponse,
} from '@/lib/types';

const ROUTE = '/cpanel/workflows';

// The 7 approval actions, with friendly labels for the pull-down.
const ACTION_OPTIONS: { value: WorkflowActionType; label: string }[] = [
  { value: 'CREATE_APPROVE', label: 'Create & Approve' },
  { value: 'CREATE_FORWARD', label: 'Create & Forward' },
  { value: 'APPROVE', label: 'Approve' },
  { value: 'APPROVE_FORWARD', label: 'Approve & Forward' },
  { value: 'CREATE_REFERENCE', label: 'Create & Reference' },
  { value: 'REFERENCE', label: 'Reference' },
  { value: 'REVIEW_FORWARD', label: 'Review & Forward' },
];
const actionLabel = (a: WorkflowActionType) =>
  ACTION_OPTIONS.find((o) => o.value === a)?.label ?? a;

const APPROVAL_MODE_OPTIONS: { value: WorkflowApprovalMode; label: string }[] = [
  { value: 'FORM', label: 'Whole form' },
  { value: 'FIELD', label: 'Field value (limit)' },
];

// The step shape POSTed/PATCHed to the API (one per step, sorted by sequence).
type StepInput = {
  sequence: number;
  userGroupId?: number | null;
  userIds?: number[];
  targetCompanyId?: number | null;
  targetBranchId?: number | null;
  targetModuleId?: number | null;
  action: WorkflowActionType;
  buttonText: string;
  statusLabel?: string | null;
  approvalMode?: WorkflowApprovalMode;
  fieldName?: string | null;
  valueFrom?: number | null;
  valueTo?: number | null;
  canCancel?: boolean;
  canReject?: boolean;
  canEdit?: boolean;
  notifyInApp?: boolean;
  slaHours?: number | null;
};

// Editable draft for one step row. Ids are kept as strings for the Select
// widgets.
type StepDraft = {
  userGroupId: string;
  userIds: number[];
  targetCompanyId: string;
  targetBranchId: string;
  targetModuleId: string;
  action: WorkflowActionType;
  buttonText: string;
  statusLabel: string;
  approvalMode: WorkflowApprovalMode;
  fieldName: string;
  valueFrom: string;
  valueTo: string;
  canCancel: boolean;
  canReject: boolean;
  canEdit: boolean;
  notifyInApp: boolean;
  slaHours: string;
};

const blankStep = (): StepDraft => ({
  userGroupId: '',
  userIds: [],
  targetCompanyId: '',
  targetBranchId: '',
  targetModuleId: '',
  action: 'APPROVE',
  buttonText: '',
  statusLabel: '',
  approvalMode: 'FORM',
  fieldName: '',
  valueFrom: '',
  valueTo: '',
  canCancel: false,
  canReject: true,
  canEdit: false,
  notifyInApp: true,
  slaHours: '',
});

const stepFrom = (s: WorkflowStep): StepDraft => ({
  userGroupId: s.userGroupId != null ? String(s.userGroupId) : '',
  userIds: s.userIds ?? [],
  targetCompanyId: s.targetCompanyId != null ? String(s.targetCompanyId) : '',
  targetBranchId: s.targetBranchId != null ? String(s.targetBranchId) : '',
  targetModuleId: s.targetModuleId != null ? String(s.targetModuleId) : '',
  action: s.action,
  buttonText: s.buttonText ?? '',
  statusLabel: s.statusLabel ?? '',
  approvalMode: s.approvalMode ?? 'FORM',
  fieldName: s.fieldName ?? '',
  valueFrom: s.valueFrom != null ? String(s.valueFrom) : '',
  valueTo: s.valueTo != null ? String(s.valueTo) : '',
  canCancel: !!s.canCancel,
  canReject: !!s.canReject,
  canEdit: !!s.canEdit,
  notifyInApp: !!s.notifyInApp,
  slaHours: s.slaHours != null ? String(s.slaHours) : '',
});

const emptyDef = {
  name: '',
  companyId: '',
  branchId: '',
  moduleId: '',
  objectId: '',
  isActive: true,
};

export default function WorkflowsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const {
    data: defs,
    loading,
    refetch,
  } = useFetch<WorkflowDefinition[]>('/workflows');

  // Reference data for the pull-downs and the list-column resolvers.
  const { data: modules } = useFetch<Module[]>('/modules');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  // The document-status vocabulary (super-admin managed) for the step status combo.
  const { data: statuses } = useFetch<WorkflowStatus[]>(
    '/workflow-statuses?activeOnly=true',
  );
  // User groups are company-scoped, so fetch every company's groups (tagged with
  // their company) — a cross-company step can then offer the acting company's
  // groups, not just the definition company's.
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  useEffect(() => {
    const list = companies ?? [];
    if (list.length === 0) return;
    let cancelled = false;
    Promise.all(
      list.map((c) =>
        api
          .get<UserGroup[]>(`/user-groups?companyId=${c.id}`)
          .then((gs) => gs.map((g) => ({ ...g, companyId: c.id })))
          .catch(() => [] as UserGroup[]),
      ),
    ).then((lists) => {
      if (!cancelled) setUserGroups(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [companies]);
  const { data: users } = useFetch<User[]>('/users');
  // The objects endpoint is paginated; pull every FORM object in one page and
  // filter to the chosen module client-side.
  const { data: objectsResp } = useFetch<ObjectListResponse>(
    '/objects?objectType=FORM&pageSize=1000',
  );
  const forms = useMemo<ErpObject[]>(
    () => (objectsResp?.data ?? []).filter((o) => o.objectType === 'FORM'),
    [objectsResp],
  );

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<WorkflowDefinition>({
      endpoint: '/workflows',
      route: ROUTE,
      noun: 'workflow',
      nameOf: (w) => w.name,
      reload: refetch,
    });

  // ---- resolvers ----
  const moduleName = (id?: number | null) =>
    (modules ?? []).find((m) => m.id === id)?.name ?? '—';
  const formName = (id?: number | null) =>
    forms.find((o) => o.id === id)?.objectName ?? '—';
  const branchName = (id?: number | null) =>
    id == null ? 'All branches' : (branches ?? []).find((b) => b.id === id)?.name ?? '—';
  const groupName = (id?: number | null) =>
    (userGroups ?? []).find((g) => g.id === id)?.name ?? '';
  const userName = (id: number) =>
    (users ?? []).find((u) => u.id === id)?.name ?? `#${id}`;

  // ---- drawer state ----
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);
  const [view, setView] = useState(false);
  const [tab, setTab] = useState('def');
  const [def, setDef] = useState({ ...emptyDef });
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const resetForm = () => {
    setDef({ ...emptyDef, companyId: activeCompanyId ? String(activeCompanyId) : '' });
    setSteps([]);
    setTab('def');
  };

  const openAdd = () => {
    setEditing(null);
    setView(false);
    resetForm();
    setOpen(true);
  };

  // Load a definition (and its steps) into both tabs for edit / view. `reopen`
  // resets the tab + opens the drawer (opening); pass false to just reload data
  // after a Save so the current tab (e.g. Approval steps) is preserved.
  const hydrate = async (
    w: WorkflowDefinition,
    viewMode: boolean,
    reopen = true,
  ) => {
    setEditing(w);
    setView(viewMode);
    if (reopen) {
      setTab('def');
      setOpen(true);
    }
    try {
      const full = await api.get<WorkflowDefinition>(`/workflows/${w.id}`);
      setDef({
        name: full.name,
        companyId: String(full.companyId),
        branchId: full.branchId != null ? String(full.branchId) : '',
        moduleId: String(full.moduleId),
        objectId: String(full.objectId),
        isActive: full.isActive,
      });
      setSteps(
        [...(full.steps ?? [])]
          .sort((a, b) => a.sequence - b.sequence)
          .map(stepFrom),
      );
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        toast.error('Failed to load workflow.');
    }
  };

  // Branches / forms available for the currently-selected company / module.
  const branchOptions = useMemo(
    () =>
      (branches ?? [])
        .filter((b) => !def.companyId || b.companyId === Number(def.companyId))
        .map((b) => ({ value: b.id, label: b.name })),
    [branches, def.companyId],
  );
  const formOptions = useMemo(
    () =>
      forms
        .filter((o) => !def.moduleId || o.moduleId === Number(def.moduleId))
        .map((o) => ({ value: o.id, label: o.objectName })),
    [forms, def.moduleId],
  );

  // ---- step helpers ----
  const addStep = () => setSteps((rows) => [...rows, blankStep()]);
  const updateStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeStep = (i: number) =>
    setSteps((rows) => rows.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((rows) => {
      const j = i + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // The company a step ACTS IN: the target company carried forward from the most
  // recent prior step (cross-boundary routing), else the definition's own
  // company. A step's approvers (user group / users) come from this company.
  const effectiveStepCompanyId = (i: number): number | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      if (steps[j].targetCompanyId) return Number(steps[j].targetCompanyId);
    }
    return def.companyId ? Number(def.companyId) : undefined;
  };

  // The branch a step ACTS IN: the branch carried forward from prior routing,
  // else the definition's own branch. When a prior step routed to a different
  // company, the branch resets to that step's target branch (if any). Approvers
  // are then listed for this company + branch.
  const effectiveStepBranchId = (i: number): number | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      if (steps[j].targetCompanyId)
        return steps[j].targetBranchId
          ? Number(steps[j].targetBranchId)
          : undefined;
      if (steps[j].targetBranchId) return Number(steps[j].targetBranchId);
    }
    return def.branchId ? Number(def.branchId) : undefined;
  };

  // The module a step ACTS IN: the module carried forward from prior routing,
  // else the definition's own module. User groups (which manage modules) are
  // listed for this module.
  const effectiveStepModuleId = (i: number): number | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      if (steps[j].targetModuleId) return Number(steps[j].targetModuleId);
    }
    return def.moduleId ? Number(def.moduleId) : undefined;
  };

  // ---- save ----
  const buildSteps = (): StepInput[] =>
    steps.map((d, i) => ({
      sequence: i + 1,
      userGroupId: d.userGroupId ? Number(d.userGroupId) : null,
      userIds: d.userIds,
      targetCompanyId: d.targetCompanyId ? Number(d.targetCompanyId) : null,
      targetBranchId: d.targetBranchId ? Number(d.targetBranchId) : null,
      targetModuleId: d.targetModuleId ? Number(d.targetModuleId) : null,
      action: d.action,
      buttonText: d.buttonText.trim(),
      statusLabel: d.statusLabel.trim() || null,
      approvalMode: d.approvalMode,
      fieldName: d.approvalMode === 'FIELD' ? d.fieldName.trim() || null : null,
      valueFrom:
        d.approvalMode === 'FIELD' && d.valueFrom !== '' ? Number(d.valueFrom) : null,
      valueTo:
        d.approvalMode === 'FIELD' && d.valueTo !== '' ? Number(d.valueTo) : null,
      // Cancel is only meaningful at the origin (step 1); reject only downstream.
      canCancel: i === 0 ? d.canCancel : false,
      canReject: i === 0 ? false : d.canReject,
      canEdit: d.canEdit,
      notifyInApp: d.notifyInApp,
      slaHours: d.slaHours !== '' ? Number(d.slaHours) : null,
    }));

  const validate = (): string | null => {
    if (!def.name.trim()) return 'Workflow name is required.';
    if (!editing) {
      if (!def.companyId) return 'Select a company.';
      if (!def.moduleId) return 'Select a module.';
      if (!def.objectId) return 'Select a form.';
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.buttonText.trim())
        return `Step ${i + 1}: button text is required.`;
      if (!s.userGroupId && s.userIds.length === 0)
        return `Step ${i + 1}: pick a user group or at least one user.`;
    }
    return null;
  };

  const save = async (mode: SaveMode = 'saveClose') => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      let saved: WorkflowDefinition;
      if (editing) {
        // company / module / object are immutable — don't send them on update.
        saved = await api.patch<WorkflowDefinition>(`/workflows/${editing.id}`, {
          name: def.name,
          branchId: def.branchId ? Number(def.branchId) : null,
          isActive: def.isActive,
          steps: buildSteps(),
        });
        toast.success('Workflow updated.');
      } else {
        saved = await api.post<WorkflowDefinition>('/workflows', {
          name: def.name,
          companyId: Number(def.companyId),
          branchId: def.branchId ? Number(def.branchId) : null,
          moduleId: Number(def.moduleId),
          objectId: Number(def.objectId),
          isActive: def.isActive,
          steps: buildSteps(),
        });
        toast.success('Workflow created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        resetForm();
      } else if (mode === 'save') {
        // Reload the just-saved record so both tabs reflect persisted state,
        // staying on the current tab (don't jump back to Definition).
        hydrate(saved, false, false);
      } else setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w: WorkflowDefinition) => {
    const ok = await confirm({
      title: 'Delete workflow',
      message: `Delete "${w.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/workflows/${w.id}`);
      toast.success('Workflow deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<WorkflowDefinition>[] = [
    {
      key: 'name',
      header: 'Name',
      accessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    {
      key: 'module',
      header: 'Module',
      accessor: (r) => moduleName(r.moduleId),
    },
    {
      key: 'form',
      header: 'Form',
      accessor: (r) => formName(r.objectId),
    },
    {
      key: 'branch',
      header: 'Branch',
      accessor: (r) => (r.branchId == null ? 'All' : branchName(r.branchId)),
      render: (r) =>
        r.branchId == null ? (
          <span className="text-slate-400">All branches</span>
        ) : (
          branchName(r.branchId)
        ),
    },
    {
      key: 'steps',
      header: 'Steps',
      sortAccessor: (r) => r.steps?.length ?? 0,
      render: (r) => (
        <span className="tabular-nums">{r.steps?.length ?? 0}</span>
      ),
    },
    {
      key: 'isActive',
      header: 'Active',
      sortAccessor: (r) => (r.isActive ? 1 : 0),
      render: (r) =>
        r.isActive ? (
          <Badge color="green">Active</Badge>
        ) : (
          <Badge color="slate">Inactive</Badge>
        ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Workflow Setup"
        description="Bind an approval chain to a document type"
        icon={<WorkflowIcon className="h-5 w-5" />}
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
        rows={defs ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        onRefresh={refetch}
        searchPlaceholder="Search workflows..."
        onView={(r) => hydrate(r, true)}
        onEdit={(r) => guardEdit(r, () => hydrate(r, false))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        emptyMessage="No workflows found"
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={view ? 'View Workflow' : editing ? 'Edit Workflow' : 'New Workflow'}
        subtitle="Workflow definition"
        icon={<WorkflowIcon className="h-5 w-5" />}
        width="xl"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        {/* Tabs stay outside the read-only fieldset so they remain clickable in
            view mode; only each tab's controls are disabled. */}
        <Tabs
          className="mb-5"
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'def', label: 'Definition' },
            { key: 'steps', label: `Approval steps (${steps.length})` },
          ]}
        />

        {/* Tab 1 — Definition */}
        {tab === 'def' && (
          <ReadOnlyFieldset readOnly={view}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Name"
                required
                wrapClassName="sm:col-span-2"
                value={def.name}
                onChange={(e) => setDef({ ...def, name: e.target.value })}
                placeholder="e.g. Purchase Order Approval"
              />
              <Select
                label="Company"
                required
                // Locked to the active company. The listing and the post-save
                // reload are scoped to X-Company-Id, so a workflow raised under a
                // different company would be invisible here and 404 on reload.
                // Switch companies from the top bar to configure another company.
                disabled
                title="Workflows belong to your active company. Switch companies from the top bar to configure another."
                value={def.companyId}
                onChange={(e) =>
                  // Changing the company invalidates the chosen branch.
                  setDef({ ...def, companyId: e.target.value, branchId: '' })
                }
                placeholder="Select company"
                options={(companies ?? []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
              <Select
                label="Branch"
                value={def.branchId}
                onChange={(e) => setDef({ ...def, branchId: e.target.value })}
                placeholder="All branches"
                options={branchOptions}
              />
              <Select
                label="Module"
                required
                disabled={!!editing}
                title={editing ? 'Module cannot change after creation' : undefined}
                value={def.moduleId}
                onChange={(e) =>
                  // Changing the module resets the form selection.
                  setDef({ ...def, moduleId: e.target.value, objectId: '' })
                }
                placeholder="Select module"
                options={(modules ?? []).map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
              <Input
                label="Object type"
                value="Form"
                readOnly
                disabled
                title="Workflows apply to Form objects"
              />
              <Select
                label="Form"
                required
                wrapClassName="sm:col-span-2"
                disabled={!!editing || !def.moduleId}
                title={editing ? 'Form cannot change after creation' : undefined}
                value={def.objectId}
                onChange={(e) => setDef({ ...def, objectId: e.target.value })}
                placeholder={
                  def.moduleId ? 'Select a form' : 'Pick a module first'
                }
                options={formOptions}
              />
              <div className="flex items-end pb-2 sm:col-span-2">
                <Checkbox
                  label="Active"
                  checked={def.isActive}
                  onChange={(e) => setDef({ ...def, isActive: e.target.checked })}
                />
              </div>
            </div>
          </ReadOnlyFieldset>
        )}

        {/* Tab 2 — Approval steps */}
        {tab === 'steps' && (
          <ReadOnlyFieldset readOnly={view}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Each step is one approval level. Steps run top to bottom in the
                  order shown.
                </p>
                {!view && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={addStep}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add step
                  </button>
                )}
              </div>

              {steps.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
                  No approval steps yet. Click “Add step” to add the first level.
                </p>
              ) : (
                steps.map((s, i) => (
                  <StepCard
                    key={i}
                    index={i}
                    total={steps.length}
                    step={s}
                    view={view}
                    users={users ?? []}
                    userGroups={userGroups ?? []}
                    companies={companies ?? []}
                    branches={branches ?? []}
                    modules={modules ?? []}
                    stepCompanyId={effectiveStepCompanyId(i)}
                    stepBranchId={effectiveStepBranchId(i)}
                    stepModuleId={effectiveStepModuleId(i)}
                    statuses={statuses ?? []}
                    groupName={groupName}
                    userName={userName}
                    onChange={(patch) => updateStep(i, patch)}
                    onMove={(dir) => moveStep(i, dir)}
                    onRemove={() => removeStep(i)}
                  />
                ))
              )}
            </div>
          </ReadOnlyFieldset>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One approval step, shown as a stacked card. The common approval fields sit up
// front; the cross-boundary routing (target company/branch/module) is tucked
// into a collapsible block so the simple case stays clean.
// ---------------------------------------------------------------------------
function StepCard({
  index,
  total,
  step,
  view,
  users,
  userGroups,
  companies,
  branches,
  modules,
  statuses,
  stepCompanyId,
  stepBranchId,
  stepModuleId,
  groupName,
  userName,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  step: StepDraft;
  view: boolean;
  users: User[];
  userGroups: UserGroup[];
  companies: Company[];
  branches: Branch[];
  modules: Module[];
  statuses: WorkflowStatus[];
  stepCompanyId?: number;
  stepBranchId?: number;
  stepModuleId?: number;
  groupName: (id?: number | null) => string;
  userName: (id: number) => string;
  onChange: (patch: Partial<StepDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  // A short one-line description of the approver + action for the card header.
  const approverSummary = () => {
    const parts: string[] = [];
    if (step.userGroupId) parts.push(groupName(Number(step.userGroupId)));
    if (step.userIds.length)
      parts.push(step.userIds.map((id) => userName(id)).join(', '));
    return parts.length ? parts.join(' · ') : 'No approver';
  };

  // The company this step acts in: its own cross-boundary routing wins, else the
  // context carried forward from earlier steps / the definition. The branch is
  // the step's own target branch (only meaningful once a company is chosen).
  const actingCompanyId = step.targetCompanyId
    ? Number(step.targetCompanyId)
    : stepCompanyId;
  // Branch this step acts in: its own routing override, else — when it hasn't
  // been re-routed to a different company — the branch carried from the
  // definition / prior steps.
  const actingBranchId = step.targetBranchId
    ? Number(step.targetBranchId)
    : step.targetCompanyId
      ? undefined
      : stepBranchId;

  // The module this step acts in (its own routing override, else carried forward
  // / the definition's module).
  const actingModuleId = step.targetModuleId
    ? Number(step.targetModuleId)
    : stepModuleId;

  // A user "has" the acting module if it's in their per-company module assignment
  // for the acting company — OR they have no assignment there (in which case they
  // inherit their group's modules). Mirrors how effective access is computed.
  const userHasModule = (u: User) => {
    if (!actingModuleId) return true;
    const a = (u.moduleAssignments ?? []).find(
      (m) => m.companyId === actingCompanyId,
    );
    if (!a || !a.moduleIds.length) return true;
    return a.moduleIds.includes(actingModuleId);
  };

  // Target branch offers only the acting company's branches.
  const targetBranchOptions = branches
    .filter((b) => !actingCompanyId || b.companyId === actingCompanyId)
    .map((b) => ({ value: b.id, label: b.name }));

  // Approvers come from the company this step acts in. With a group chosen, list
  // that group's members (membership is company-scoped); otherwise all users of
  // the acting company. The list is further narrowed to the acting branch (users
  // assigned to it) and the acting module (their own module assignment) — so a
  // step names an approver by company, branch AND module.
  const groupUsers = (
    step.userGroupId
      ? users.filter((u) => (u.groupIds ?? []).includes(Number(step.userGroupId)))
      : users.filter(
          (u) => !actingCompanyId || (u.companyIds ?? []).includes(actingCompanyId),
        )
  )
    .filter((u) => !actingBranchId || (u.branchIds ?? []).includes(actingBranchId))
    .filter(userHasModule);

  // User groups cascade with the acting company AND module — groups are company-
  // scoped and manage a set of modules. The current selection stays visible.
  const groupOptions = userGroups
    .filter((g) => {
      if (step.userGroupId && String(g.id) === String(step.userGroupId)) return true;
      const companyOk = !actingCompanyId || g.companyId === actingCompanyId;
      const moduleOk =
        !actingModuleId || (g.modules ?? []).some((m) => m.id === actingModuleId);
      return companyOk && moduleOk;
    })
    .map((g) => ({ value: g.id, label: g.name }));

  // Cross-boundary routing fields. Changing a target re-cascades the group +
  // users so the approver always matches the routed company / branch / module.
  const routingFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Select
        label="Target company"
        value={step.targetCompanyId}
        onChange={(e) =>
          onChange({
            targetCompanyId: e.target.value,
            targetBranchId: '',
            userGroupId: '',
            userIds: [],
          })
        }
        placeholder="— Same —"
        options={companies.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Select
        label="Target branch"
        value={step.targetBranchId}
        onChange={(e) => onChange({ targetBranchId: e.target.value, userIds: [] })}
        placeholder="— Same —"
        options={targetBranchOptions}
      />
      <Select
        label="Target module"
        value={step.targetModuleId}
        onChange={(e) =>
          onChange({
            targetModuleId: e.target.value,
            userGroupId: '',
            userIds: [],
          })
        }
        placeholder="— Same —"
        options={modules.map((m) => ({ value: m.id, label: m.name }))}
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      {/* Header: sequence + summary + reorder / remove */}
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {step.buttonText.trim() || 'Untitled step'}
          </p>
          <p className="truncate text-xs text-slate-400">
            {approverSummary()} · {actionLabel(step.action)} ·{' '}
            {step.approvalMode === 'FIELD' ? 'Field limit' : 'Whole form'}
          </p>
        </div>
        {!view && (
          <div className="flex flex-none items-center gap-0.5">
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-slate-800"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              aria-label="Move step up"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-slate-800"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              aria-label="Move step down"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
              onClick={onRemove}
              aria-label="Remove step"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Steps after the first act on a routed document — choose WHERE it goes
          first, then the group + users below cascade from that context. */}
      {index >= 1 && (
        <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
          <p className="mb-1 text-xs font-semibold text-brand-700 dark:text-brand-300">
            Where this step acts
          </p>
          <p className="mb-2 text-xs text-slate-400">
            Select the company / branch / module first — the group and users
            below list only that context. Leave blank to stay with the previous
            step&apos;s context.
          </p>
          {routingFields}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Approver: group and/or explicit users (cascaded from the context) */}
        <Select
          label="User group"
          value={step.userGroupId}
          onChange={(e) =>
            onChange({ userGroupId: e.target.value, userIds: [] })
          }
          placeholder="— None —"
          options={groupOptions}
        />
        <UserMultiSelect
          label="Users"
          users={groupUsers}
          value={step.userIds}
          onChange={(userIds) => onChange({ userIds })}
        />

        <Select
          label="Action"
          value={step.action}
          onChange={(e) =>
            onChange({ action: e.target.value as WorkflowActionType })
          }
          options={ACTION_OPTIONS}
        />
        <Input
          label="Button text"
          required
          value={step.buttonText}
          onChange={(e) => onChange({ buttonText: e.target.value })}
          placeholder="e.g. Approve, Fwd to Accounts"
        />

        <Select
          label="Status (shown in the order list once this step acts)"
          wrapClassName="sm:col-span-2"
          value={step.statusLabel}
          onChange={(e) => onChange({ statusLabel: e.target.value })}
          placeholder="— None —"
          options={statuses.map((s) => ({ value: s.name, label: s.name }))}
        />

        <Select
          label="Approval mode"
          value={step.approvalMode}
          onChange={(e) =>
            onChange({ approvalMode: e.target.value as WorkflowApprovalMode })
          }
          options={APPROVAL_MODE_OPTIONS}
        />
        <Input
          label="SLA (hours)"
          type="number"
          min={0}
          value={step.slaHours}
          onChange={(e) => onChange({ slaHours: e.target.value })}
          placeholder="Optional"
        />

        {/* FIELD mode reveals the value-limit inputs. */}
        {step.approvalMode === 'FIELD' && (
          <>
            <Input
              label="Field name"
              wrapClassName="sm:col-span-2"
              value={step.fieldName}
              onChange={(e) => onChange({ fieldName: e.target.value })}
              placeholder="e.g. grandTotal"
            />
            <Input
              label="Value from"
              type="number"
              value={step.valueFrom}
              onChange={(e) => onChange({ valueFrom: e.target.value })}
            />
            <Input
              label="Value to"
              type="number"
              value={step.valueTo}
              onChange={(e) => onChange({ valueTo: e.target.value })}
            />
          </>
        )}
      </div>

      {/* Toggles */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {/* Cancel belongs to the origin step only; reject only to later steps. */}
        {index === 0 && (
          <Checkbox
            label="Can cancel"
            checked={step.canCancel}
            onChange={(e) => onChange({ canCancel: e.target.checked })}
          />
        )}
        {index >= 1 && (
          <Checkbox
            label="Can reject"
            checked={step.canReject}
            onChange={(e) => onChange({ canReject: e.target.checked })}
          />
        )}
        <Checkbox
          label="Can edit"
          checked={step.canEdit}
          onChange={(e) => onChange({ canEdit: e.target.checked })}
        />
        <Checkbox
          label="Notify in-app"
          checked={step.notifyInApp}
          onChange={(e) => onChange({ notifyInApp: e.target.checked })}
        />
      </div>

      {/* Step 1 is the origin — the creator sits in the definition's own
          company / branch, so no cross-boundary routing is offered here. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact multi-select for approver users: a trigger button showing the current
// selection, opening a searchable checkbox list. Stores number[] ids.
// ---------------------------------------------------------------------------
function UserMultiSelect({
  label,
  users,
  value,
  onChange,
}: {
  label: string;
  users: User[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectedSet = new Set(value);
  const toggle = (id: number) =>
    onChange(
      selectedSet.has(id) ? value.filter((v) => v !== id) : [...value, id],
    );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q),
      )
    : users;

  const summary =
    value.length === 0
      ? 'No users'
      : value.length === 1
        ? users.find((u) => u.id === value[0])?.name ?? '1 user'
        : `${value.length} users`;

  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="input-base flex w-full items-center gap-2 text-left"
        >
          <Users className="h-4 w-4 flex-none text-slate-400" />
          <span className={cn('flex-1 truncate', value.length === 0 && 'text-slate-400')}>
            {summary}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-none text-slate-400 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full min-w-[15rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {users.length > 8 && (
              <div className="relative border-b border-slate-100 p-2 dark:border-slate-800">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users..."
                  className="input-base w-full pl-9"
                />
              </div>
            )}
            <div className="max-h-60 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-400">
                  No matches
                </p>
              ) : (
                filtered.map((u) => {
                  const active = selectedSet.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggle(u.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800',
                        active
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 flex-none items-center justify-center rounded border',
                          active
                            ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500'
                            : 'border-slate-300 dark:border-slate-600',
                        )}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 truncate text-left">{u.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
