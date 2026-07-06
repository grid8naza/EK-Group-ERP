'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Workflow as WorkflowIcon,
  Trash2,
  ChevronUp,
  ChevronDown,
  ArrowLeftRight,
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
// widgets; `showRouting` is UI-only (reveals the cross-boundary block).
type StepDraft = {
  userGroupId: string;
  userIds: number[];
  targetCompanyId: string;
  targetBranchId: string;
  targetModuleId: string;
  action: WorkflowActionType;
  buttonText: string;
  approvalMode: WorkflowApprovalMode;
  fieldName: string;
  valueFrom: string;
  valueTo: string;
  canCancel: boolean;
  canReject: boolean;
  canEdit: boolean;
  notifyInApp: boolean;
  slaHours: string;
  showRouting: boolean;
};

const blankStep = (): StepDraft => ({
  userGroupId: '',
  userIds: [],
  targetCompanyId: '',
  targetBranchId: '',
  targetModuleId: '',
  action: 'APPROVE',
  buttonText: '',
  approvalMode: 'FORM',
  fieldName: '',
  valueFrom: '',
  valueTo: '',
  canCancel: false,
  canReject: true,
  canEdit: false,
  notifyInApp: true,
  slaHours: '',
  showRouting: false,
});

const stepFrom = (s: WorkflowStep): StepDraft => ({
  userGroupId: s.userGroupId != null ? String(s.userGroupId) : '',
  userIds: s.userIds ?? [],
  targetCompanyId: s.targetCompanyId != null ? String(s.targetCompanyId) : '',
  targetBranchId: s.targetBranchId != null ? String(s.targetBranchId) : '',
  targetModuleId: s.targetModuleId != null ? String(s.targetModuleId) : '',
  action: s.action,
  buttonText: s.buttonText ?? '',
  approvalMode: s.approvalMode ?? 'FORM',
  fieldName: s.fieldName ?? '',
  valueFrom: s.valueFrom != null ? String(s.valueFrom) : '',
  valueTo: s.valueTo != null ? String(s.valueTo) : '',
  canCancel: !!s.canCancel,
  canReject: !!s.canReject,
  canEdit: !!s.canEdit,
  notifyInApp: !!s.notifyInApp,
  slaHours: s.slaHours != null ? String(s.slaHours) : '',
  // Reveal the routing block if any cross-boundary target is set.
  showRouting:
    s.targetCompanyId != null ||
    s.targetBranchId != null ||
    s.targetModuleId != null,
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
  const { data: userGroups } = useFetch<UserGroup[]>('/user-groups');
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

  // Load a definition (and its steps) into both tabs for edit / view.
  const hydrate = async (w: WorkflowDefinition, viewMode: boolean) => {
    setEditing(w);
    setView(viewMode);
    setTab('def');
    setOpen(true);
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
      approvalMode: d.approvalMode,
      fieldName: d.approvalMode === 'FIELD' ? d.fieldName.trim() || null : null,
      valueFrom:
        d.approvalMode === 'FIELD' && d.valueFrom !== '' ? Number(d.valueFrom) : null,
      valueTo:
        d.approvalMode === 'FIELD' && d.valueTo !== '' ? Number(d.valueTo) : null,
      canCancel: d.canCancel,
      canReject: d.canReject,
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
        // Reload the just-saved record so both tabs reflect persisted state.
        hydrate(saved, false);
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
                disabled={!!editing}
                title={editing ? 'Company cannot change after creation' : undefined}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Approver: group and/or explicit users */}
        <Select
          label="User group"
          value={step.userGroupId}
          onChange={(e) => onChange({ userGroupId: e.target.value })}
          placeholder="— None —"
          options={userGroups.map((g) => ({ value: g.id, label: g.name }))}
        />
        <UserMultiSelect
          label="Users"
          users={users}
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
        <Checkbox
          label="Can cancel"
          checked={step.canCancel}
          onChange={(e) => onChange({ canCancel: e.target.checked })}
        />
        <Checkbox
          label="Can reject"
          checked={step.canReject}
          onChange={(e) => onChange({ canReject: e.target.checked })}
        />
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

      {/* Cross-boundary routing — collapsed by default. */}
      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => onChange({ showRouting: !step.showRouting })}
          className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {step.showRouting ? 'Hide' : 'Show'} cross-boundary routing
        </button>
        {step.showRouting && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-slate-400">
              Leave blank to keep the document in the same company / branch /
              module.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select
                label="Target company"
                value={step.targetCompanyId}
                onChange={(e) => onChange({ targetCompanyId: e.target.value })}
                placeholder="— Same —"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
              <Select
                label="Target branch"
                value={step.targetBranchId}
                onChange={(e) => onChange({ targetBranchId: e.target.value })}
                placeholder="— Same —"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
              <Select
                label="Target module"
                value={step.targetModuleId}
                onChange={(e) => onChange({ targetModuleId: e.target.value })}
                placeholder="— Same —"
                options={modules.map((m) => ({ value: m.id, label: m.name }))}
              />
            </div>
          </div>
        )}
      </div>
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
