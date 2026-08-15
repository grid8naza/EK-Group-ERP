'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  MapPin,
  CalendarClock,
  ArrowRightLeft,
  TrendingUp,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { FormSection } from '@/components/ui/FormSection';
import { Select, Textarea, DateInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  Branch,
  Company,
  CostCenter,
  CostObject,
  Employee,
  EmployeePosting,
  HrDesignation,
} from '@/lib/types';

/**
 * An employee's postings — where they have worked and as what.
 *
 * The series IS the service record. A promotion or a transfer is a new posting
 * starting the day it takes effect, and the server closes the one before it the
 * day before; what somebody was on in March stays readable next year.
 *
 * WHICH it was is derived rather than asked for: a posting whose designation
 * differs from the one before reads as a promotion, one whose place differs as
 * a transfer, and a row can be both.
 *
 * Branch, division and department are offered only where the chosen COMPANY has
 * them switched on in Company Master — a company that does not work in branches
 * is never asked which one.
 */

const emptyForm = {
  effectiveFrom: '',
  effectiveTo: '',
  companyId: '',
  branchId: '',
  costCenterId: '',
  costObjectId: '',
  designationId: '',
  remarks: '',
};

type Form = typeof emptyForm;

export interface PostingsPanelProps {
  /** The employee whose service record this is; null before it exists. */
  employeeId: number | null;
  /** The employee as saved — what the first posting is seeded from. */
  employee?: Employee | null;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

export function PostingsPanel({
  employeeId,
  employee,
  readOnly = false,
  onDirtyChange,
}: PostingsPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  const { data: costCenters } = useFetch<CostCenter[]>('/cost-centers');
  const { data: costObjects } = useFetch<CostObject[]>('/cost-objects');
  const { data: designations } = useFetch<HrDesignation[]>('/hr-designations');

  const [postings, setPostings] = useState<EmployeePosting[] | null>(null);
  const [editing, setEditing] = useState<EmployeePosting | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!employeeId) return;
    try {
      const rows = await api.get<EmployeePosting[]>(
        `/hr-employees/${employeeId}/postings`,
      );
      setPostings(rows ?? []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) {
        toast.error('Failed to load postings.');
      }
      setPostings([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onDirtyChange?.(formOpen);
  }, [formOpen, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // ------------------------------------------------- what the company allows --

  const company = useMemo(
    () => (companies ?? []).find((c) => String(c.id) === form.companyId),
    [companies, form.companyId],
  );
  // The three levels the Company master switched on. A company that does not
  // work in branches is never asked which one — the whole point of the flags.
  const usesBranches = !!company?.branchApplicable;
  const usesDivisions = !!company?.costCenterApplicable;
  const usesDepartments = !!company?.costObjectApplicable;

  const branchOptions = (branches ?? []).filter(
    (b) => b.isActive && String(b.companyId) === form.companyId,
  );
  const divisionOptions = (costCenters ?? []).filter(
    (c) => c.isActive && String(c.companyId) === form.companyId,
  );
  const departmentOptions = (costObjects ?? []).filter(
    (o) =>
      o.isActive &&
      String(o.companyId) === form.companyId &&
      (!form.costCenterId || String(o.costCenterId) === form.costCenterId),
  );

  // ------------------------------------------------------------ open editor --

  /** The newest posting — what a transfer or promotion carries forward. */
  const latest = postings?.[0] ?? null;

  const openNew = () => {
    setEditing(null);
    // Seeded from where they are now — the posting before, or failing that the
    // employee record itself. A transfer changes one thing about a posting, so
    // starting from a blank form would mean retyping the rest.
    const from = latest ?? employee ?? null;
    setForm({
      ...emptyForm,
      companyId: from ? String(from.companyId) : '',
      branchId: from?.branchId != null ? String(from.branchId) : '',
      costCenterId: from?.costCenterId != null ? String(from.costCenterId) : '',
      costObjectId: from?.costObjectId != null ? String(from.costObjectId) : '',
      designationId: from ? String(from.designationId) : '',
    });
    setFormOpen(true);
  };

  const openEdit = (p: EmployeePosting) => {
    setEditing(p);
    setForm({
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo ?? '',
      companyId: String(p.companyId),
      branchId: p.branchId != null ? String(p.branchId) : '',
      costCenterId: p.costCenterId != null ? String(p.costCenterId) : '',
      costObjectId: p.costObjectId != null ? String(p.costObjectId) : '',
      designationId: String(p.designationId),
      remarks: p.remarks ?? '',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  // ------------------------------------------------------------------ save --

  const save = async () => {
    if (!employeeId) return;
    if (!form.effectiveFrom) {
      toast.error('Say what date this posting starts from.');
      return;
    }
    if (!form.companyId) {
      toast.error('Choose the company.');
      return;
    }
    if (!form.designationId) {
      toast.error('Choose the designation.');
      return;
    }
    setSaving(true);
    try {
      const idOrNull = (s: string) => (s ? Number(s) : null);
      const payload = {
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        companyId: Number(form.companyId),
        // Levels the company does not use are sent as null whatever is left in
        // the form — a flag switched off after the fact must not smuggle a
        // stale branch through.
        branchId: usesBranches ? idOrNull(form.branchId) : null,
        costCenterId: usesDivisions ? idOrNull(form.costCenterId) : null,
        costObjectId: usesDepartments ? idOrNull(form.costObjectId) : null,
        designationId: Number(form.designationId),
        remarks: form.remarks.trim() || null,
      };
      const rows = editing
        ? await api.patch<EmployeePosting[]>(
            `/hr-employees/${employeeId}/postings/${editing.id}`,
            payload,
          )
        : await api.post<EmployeePosting[]>(
            `/hr-employees/${employeeId}/postings`,
            payload,
          );
      setPostings(rows ?? []);
      toast.success(editing ? 'Posting updated.' : 'Posting saved.');
      closeForm();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: EmployeePosting) => {
    if (!employeeId) return;
    const ok = await confirm({
      title: 'Delete this posting',
      message: `Delete the posting from ${p.effectiveFrom}? The service record will no longer show it.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      const rows = await api.delete<EmployeePosting[]>(
        `/hr-employees/${employeeId}/postings/${p.id}`,
      );
      setPostings(rows ?? []);
      toast.success('Posting deleted.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ------------------------------------------------------------------ view --

  if (!employeeId) {
    return (
      <p className="px-1 py-6 text-sm text-slate-400">
        Save the employee first — a posting has to belong to somebody.
      </p>
    );
  }

  if (postings === null) {
    return (
      <p className="px-1 py-6 text-sm text-slate-400">Loading postings…</p>
    );
  }

  return (
    <div className="space-y-5">
      {!formOpen && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <MapPin className="h-4 w-4 text-brand-600" />
              Postings History
            </div>
            {!readOnly && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={openNew}
              >
                <Plus className="h-4 w-4" />
                {latest ? 'Add Posting' : 'Add First Posting'}
              </button>
            )}
          </div>

          {postings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
              <MapPin className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                No postings recorded yet.
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
                Start with where they joined. Every promotion and transfer after
                that is a posting of its own, so the record reads as a history
                rather than a current state.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {postings.map((p) => (
                <PostingCard
                  key={p.id}
                  posting={p}
                  readOnly={readOnly}
                  onEdit={() => openEdit(p)}
                  onDelete={() => void remove(p)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {formOpen && (
        <div className="space-y-5">
          <ReadOnlyFieldset readOnly={readOnly}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormSection>
                {editing ? 'Edit Posting' : 'New Posting'}
              </FormSection>

              <DateInput
                label="Date From"
                required
                value={form.effectiveFrom}
                onChange={(iso) => setForm({ ...form, effectiveFrom: iso })}
              />
              <DateInput
                label="Date To"
                value={form.effectiveTo}
                onChange={(iso) => setForm({ ...form, effectiveTo: iso })}
              />

              <Select
                label="Company"
                required
                value={form.companyId}
                onChange={(e) =>
                  // Everything below a company belongs to it, so all of it goes
                  // when the company changes.
                  setForm({
                    ...form,
                    companyId: e.target.value,
                    branchId: '',
                    costCenterId: '',
                    costObjectId: '',
                  })
                }
                placeholder="Select company"
                options={(companies ?? [])
                  .filter((c) => c.isActive)
                  .map((c) => ({ value: String(c.id), label: c.name }))}
              />
              <Select
                label="Designation"
                required
                value={form.designationId}
                onChange={(e) =>
                  setForm({ ...form, designationId: e.target.value })
                }
                placeholder="Select designation"
                options={(designations ?? [])
                  .filter((d) => d.isActive)
                  .map((d) => ({ value: String(d.id), label: d.name }))}
              />

              {/* Only the levels this company actually works in. A company with
                  branches switched off is never asked which branch. */}
              {usesBranches && (
                <Select
                  label="Branch"
                  value={form.branchId}
                  onChange={(e) =>
                    setForm({ ...form, branchId: e.target.value })
                  }
                  placeholder={
                    branchOptions.length
                      ? 'Whole company'
                      : 'No branches set up for this company'
                  }
                  options={branchOptions.map((b) => ({
                    value: String(b.id),
                    label: b.name,
                  }))}
                />
              )}
              {usesDivisions && (
                <Select
                  label="Division"
                  value={form.costCenterId}
                  onChange={(e) =>
                    // The departments under the old division no longer apply.
                    setForm({
                      ...form,
                      costCenterId: e.target.value,
                      costObjectId: '',
                    })
                  }
                  placeholder={
                    divisionOptions.length
                      ? '— None —'
                      : 'No divisions set up for this company'
                  }
                  options={divisionOptions.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                />
              )}
              {usesDepartments && (
                <Select
                  label="Department"
                  value={form.costObjectId}
                  onChange={(e) =>
                    setForm({ ...form, costObjectId: e.target.value })
                  }
                  placeholder={
                    form.costCenterId || !usesDivisions
                      ? '— None —'
                      : 'Pick a division first'
                  }
                  options={departmentOptions.map((o) => ({
                    value: String(o.id),
                    label: o.name,
                  }))}
                />
              )}

              <Textarea
                label="Remarks"
                wrapClassName="sm:col-span-2"
                rows={2}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Promoted to Supervisor, transferred on request…"
              />
            </div>
          </ReadOnlyFieldset>

          {!readOnly && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeForm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={save}
                disabled={saving}
              >
                <MapPin className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save Posting'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One posting in the history, badged with what changed at it.
 *
 * The badge is the derived change put into the words a person uses: a
 * designation change is a promotion, a change of place is a transfer.
 */
function PostingCard({
  posting: p,
  readOnly,
  onEdit,
  onDelete,
}: {
  posting: EmployeePosting;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const current = !p.effectiveTo;
  const promoted = p.changes.includes('DESIGNATION');
  const moved = p.changes.some((c) => c !== 'DESIGNATION');
  const where = [p.companyName, p.branchName, p.divisionName, p.departmentName]
    .filter(Boolean)
    .join(' › ');

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border',
        current
          ? 'border-brand-300 dark:border-brand-700'
          : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
        <CalendarClock className="h-4 w-4 flex-none text-brand-600" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {p.effectiveFrom} &rarr; {p.effectiveTo ?? 'present'}
        </span>
        {current && <Badge color="green">Current</Badge>}
        {promoted && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <TrendingUp className="h-3 w-3" /> Promotion
          </span>
        )}
        {moved && (
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <ArrowRightLeft className="h-3 w-3" /> Transfer
          </span>
        )}
        {!readOnly && (
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              title="Edit this posting"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Delete this posting"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/40"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        )}
      </div>

      <div className="space-y-1 px-3 py-3">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {p.designationName}
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{where}</p>
        {p.remarks && (
          <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
            {p.remarks}
          </p>
        )}
      </div>
    </div>
  );
}
