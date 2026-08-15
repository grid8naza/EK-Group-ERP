'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  TrendingUp,
  Wallet,
  CalendarClock,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLookupValues } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { FormSection } from '@/components/ui/FormSection';
import { Input, Select, Textarea, DateInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  SalaryComponent,
  SalaryComponentKind,
  SalaryPackage,
} from '@/lib/types';

/**
 * An employee's salary packages — what they are paid, and from when.
 *
 * The series IS the history. Raising an increment does not edit the current
 * package: it adds one starting the day the raise takes effect, and the server
 * closes the previous one the day before. That is why a payslip re-run for last
 * March still comes out at last March's salary, and why payroll asks "which
 * package was in force on this day" rather than "what is the salary".
 *
 * Allowances and deductions are rows against HR → Lookups rather than fixed
 * fields, so a new allowance is a lookup entry and a report can pivot whatever
 * the business has defined into a column each.
 */

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** A blank line, ready to be filled in. */
const emptyLine = (kind: SalaryComponentKind): SalaryComponent => ({
  kind,
  componentId: 0,
  amount: 0,
});

const emptyForm = {
  effectiveFrom: '',
  effectiveTo: '',
  basicSalary: '',
  remarks: '',
  lines: [] as SalaryComponent[],
};

type Form = typeof emptyForm;

export interface SalaryPanelProps {
  /** The employee whose packages these are; null before the record exists. */
  employeeId: number | null;
  /** Show, do not touch. */
  readOnly?: boolean;
  /** Whether there is unsaved work in the editor, for the drawer's guard. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function SalaryPanel({
  employeeId,
  readOnly = false,
  onDirtyChange,
}: SalaryPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const allowanceValues = useLookupValues('SALARY_ALLOWANCE');
  const deductionValues = useLookupValues('SALARY_DEDUCTION');

  const [packages, setPackages] = useState<SalaryPackage[] | null>(null);
  const [editing, setEditing] = useState<SalaryPackage | null>(null);
  /** True while the editor is open — for a new package or an existing one. */
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!employeeId) return;
    try {
      const rows = await api.get<SalaryPackage[]>(
        `/hr-employees/${employeeId}/salary-packages`,
      );
      setPackages(rows ?? []);
    } catch (e) {
      // A 403 here means the tab is on screen but the endpoint says no — show
      // an empty history rather than an error over a form nobody can use.
      if (!(e instanceof ApiError && e.status === 403)) {
        toast.error('Failed to load salary packages.');
      }
      setPackages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the OPEN editor counts as unsaved work; a history being read loses
  // nothing when the drawer closes.
  useEffect(() => {
    onDirtyChange?.(formOpen);
  }, [formOpen, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const optionsFor = (kind: SalaryComponentKind) =>
    (kind === 'ALLOWANCE' ? allowanceValues : deductionValues).map((v) => ({
      value: v.id,
      label: v.label,
    }));

  // ------------------------------------------------------------ open editor --

  /** The newest package — what an increment is raised from. */
  const latest = packages?.[0] ?? null;

  const openIncrement = () => {
    setEditing(null);
    // Seeded from what they are on now: an increment usually changes the basic
    // and keeps the shape of the package, so copying it forward is the whole
    // saving. Amounts come across too — they are a starting point to edit, not
    // a promise.
    setForm({
      effectiveFrom: '',
      effectiveTo: '',
      basicSalary: latest ? String(latest.basicSalary) : '',
      remarks: latest ? 'Increment' : '',
      lines: (latest?.components ?? []).map((c) => ({
        kind: c.kind,
        componentId: c.componentId,
        amount: c.amount,
      })),
    });
    setFormOpen(true);
  };

  const openEdit = (p: SalaryPackage) => {
    setEditing(p);
    setForm({
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo ?? '',
      basicSalary: String(p.basicSalary),
      remarks: p.remarks ?? '',
      lines: p.components.map((c) => ({
        kind: c.kind,
        componentId: c.componentId,
        amount: c.amount,
      })),
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  // ----------------------------------------------------------- edit the form --

  const setLine = (index: number, patch: Partial<SalaryComponent>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));

  const addLine = (kind: SalaryComponentKind) =>
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine(kind)] }));

  const removeLine = (index: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }));

  /** What the editor currently adds up to — the same arithmetic the server does. */
  const totals = useMemo(() => {
    const basic = Number(form.basicSalary) || 0;
    const sum = (kind: SalaryComponentKind) =>
      form.lines
        .filter((l) => l.kind === kind)
        .reduce((t, l) => t + (Number(l.amount) || 0), 0);
    const allowances = sum('ALLOWANCE');
    const deductions = sum('DEDUCTION');
    return {
      basic,
      allowances,
      deductions,
      gross: basic + allowances,
      net: basic + allowances - deductions,
    };
  }, [form.basicSalary, form.lines]);

  // ------------------------------------------------------------------ save --

  const save = async () => {
    if (!employeeId) return;
    if (!form.effectiveFrom) {
      toast.error('Say what date this package starts from.');
      return;
    }
    if (form.basicSalary === '' || Number(form.basicSalary) < 0) {
      toast.error('Enter the basic salary.');
      return;
    }
    if (form.lines.some((l) => !l.componentId)) {
      toast.error('Every line needs a component chosen, or removed.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        basicSalary: Number(form.basicSalary),
        remarks: form.remarks.trim() || null,
        components: form.lines.map((l) => ({
          kind: l.kind,
          componentId: Number(l.componentId),
          amount: Number(l.amount) || 0,
        })),
      };
      const rows = editing
        ? await api.patch<SalaryPackage[]>(
            `/hr-employees/${employeeId}/salary-packages/${editing.id}`,
            payload,
          )
        : await api.post<SalaryPackage[]>(
            `/hr-employees/${employeeId}/salary-packages`,
            payload,
          );
      setPackages(rows ?? []);
      toast.success(editing ? 'Package updated.' : 'Package saved.');
      closeForm();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: SalaryPackage) => {
    if (!employeeId) return;
    const ok = await confirm({
      title: 'Delete this package',
      message: `Delete the package effective from ${p.effectiveFrom}? Anything already paid against it stays as it was paid.`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      const rows = await api.delete<SalaryPackage[]>(
        `/hr-employees/${employeeId}/salary-packages/${p.id}`,
      );
      setPackages(rows ?? []);
      toast.success('Package deleted.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ------------------------------------------------------------------ view --

  if (!employeeId) {
    return (
      <p className="px-1 py-6 text-sm text-slate-400">
        Save the employee first — a package has to belong to somebody.
      </p>
    );
  }

  if (packages === null) {
    return <p className="px-1 py-6 text-sm text-slate-400">Loading salary…</p>;
  }

  const lineRows = (kind: SalaryComponentKind) =>
    form.lines
      .map((l, i) => ({ line: l, index: i }))
      .filter(({ line }) => line.kind === kind);

  return (
    <div className="space-y-5">
      {/* ---- the history ---- */}
      {!formOpen && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Wallet className="h-4 w-4 text-brand-600" />
              Salary Packages
            </div>
            {!readOnly && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={openIncrement}
              >
                {latest ? (
                  <>
                    <TrendingUp className="h-4 w-4" /> Add Increment
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Add Package
                  </>
                )}
              </button>
            )}
          </div>

          {packages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
              <Wallet className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                No salary package yet.
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
                Payroll pays whichever package covers the day being paid for, so
                until there is one there is nothing to pay against.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {packages.map((p, i) => {
                const current = !p.effectiveTo;
                return (
                  <div
                    key={p.id}
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
                        {p.effectiveFrom} &rarr;{' '}
                        {p.effectiveTo ?? 'until further notice'}
                      </span>
                      {current && <Badge color="green">In force</Badge>}
                      {/* The newest row is the only one an increment follows;
                          the rest are what somebody was on before. */}
                      {i === 0 && !current && (
                        <Badge color="amber">Latest</Badge>
                      )}
                      <span className="ml-auto text-sm font-semibold text-slate-800 dark:text-slate-100">
                        Net {money(p.netSalary)}
                      </span>
                      {!readOnly && (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Edit this package"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Delete this package"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            onClick={() => void remove(p)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-3 text-sm sm:grid-cols-4">
                      <Figure label="Basic" value={p.basicSalary} />
                      <Figure label="Allowances" value={p.totalAllowances} />
                      <Figure label="Deductions" value={p.totalDeductions} />
                      <Figure label="Gross" value={p.grossSalary} strong />
                    </div>

                    {p.components.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                        {p.components.map((c) => (
                          <span
                            key={`${c.kind}-${c.componentId}`}
                            className={cn(
                              'rounded-md px-1.5 py-0.5 text-xs font-medium',
                              c.kind === 'ALLOWANCE'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
                            )}
                          >
                            {c.componentName} {money(c.amount)}
                          </span>
                        ))}
                      </div>
                    )}

                    {p.remarks && (
                      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {p.remarks}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ---- the editor ---- */}
      {formOpen && (
        <div className="space-y-5">
          <ReadOnlyFieldset readOnly={readOnly}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormSection>
                {editing ? 'Edit Package' : 'New Package'}
              </FormSection>

              <DateInput
                label="Effective From"
                required
                value={form.effectiveFrom}
                onChange={(iso) => setForm({ ...form, effectiveFrom: iso })}
              />
              <DateInput
                label="Effective To"
                value={form.effectiveTo}
                onChange={(iso) => setForm({ ...form, effectiveTo: iso })}
              />
              <Input
                label="Basic Salary"
                type="number"
                min={0}
                step="0.01"
                required
                value={form.basicSalary}
                onChange={(e) =>
                  setForm({ ...form, basicSalary: e.target.value })
                }
              />
              <Textarea
                label="Remarks"
                rows={2}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Annual increment, promotion…"
              />

              <FormSection>Allowances</FormSection>
              <LineEditor
                kind="ALLOWANCE"
                rows={lineRows('ALLOWANCE')}
                options={optionsFor('ALLOWANCE')}
                readOnly={readOnly}
                onChange={setLine}
                onRemove={removeLine}
                onAdd={() => addLine('ALLOWANCE')}
              />

              <FormSection>Deductions</FormSection>
              <LineEditor
                kind="DEDUCTION"
                rows={lineRows('DEDUCTION')}
                options={optionsFor('DEDUCTION')}
                readOnly={readOnly}
                onChange={setLine}
                onRemove={removeLine}
                onAdd={() => addLine('DEDUCTION')}
              />
            </div>
          </ReadOnlyFieldset>

          {/* What it comes to, kept in view while the lines are edited. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 sm:grid-cols-4">
            <Figure label="Basic" value={totals.basic} />
            <Figure label="Allowances" value={totals.allowances} />
            <Figure label="Deductions" value={totals.deductions} />
            <Figure label="Net Payable" value={totals.net} strong />
          </div>

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
                <Wallet className="h-4 w-4" />
                {saving ? 'Saving…' : editing ? 'Save Package' : 'Save Package'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One labelled figure in a totals strip. */
function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={cn(
          'tabular-nums',
          strong
            ? 'text-base font-bold text-slate-900 dark:text-white'
            : 'font-medium text-slate-700 dark:text-slate-200',
        )}
      >
        {money(value)}
      </p>
    </div>
  );
}

/**
 * The rows for one kind of component. A list rather than fixed fields, because
 * the components come from a lookup the business maintains.
 */
function LineEditor({
  kind,
  rows,
  options,
  readOnly,
  onChange,
  onRemove,
  onAdd,
}: {
  kind: SalaryComponentKind;
  rows: { line: SalaryComponent; index: number }[];
  options: { value: number; label: string }[];
  readOnly: boolean;
  onChange: (index: number, patch: Partial<SalaryComponent>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const noun = kind === 'ALLOWANCE' ? 'allowance' : 'deduction';
  return (
    <div className="sm:col-span-2">
      {rows.length === 0 ? (
        <p className="mb-2 text-sm text-slate-400">
          No {noun}s on this package.
        </p>
      ) : (
        <div className="mb-2 space-y-2">
          {rows.map(({ line, index }) => (
            <div key={index} className="flex items-end gap-2">
              <Select
                wrapClassName="flex-1"
                value={line.componentId ? String(line.componentId) : ''}
                onChange={(e) =>
                  onChange(index, { componentId: Number(e.target.value) })
                }
                placeholder={`Select ${noun}`}
                options={options.map((o) => ({
                  ...o,
                  value: String(o.value),
                }))}
              />
              <Input
                wrapClassName="w-40"
                type="number"
                min={0}
                step="0.01"
                value={String(line.amount)}
                onChange={(e) =>
                  onChange(index, { amount: Number(e.target.value) || 0 })
                }
              />
              {!readOnly && (
                <button
                  type="button"
                  title={`Remove this ${noun}`}
                  className="mb-1 rounded-lg p-2 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  onClick={() => onRemove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2"
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" /> Add {noun}
        </button>
      )}
    </div>
  );
}
