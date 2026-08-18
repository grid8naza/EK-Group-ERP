'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, Moon, Search, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Checkbox, DateInput, Select, Textarea } from '@/components/ui/Field';
import type {
  Branch,
  BulkAssignResult,
  CostCenter,
  CostObject,
  HrShift,
  RosterRegister,
  RosterRegisterRow,
} from '@/lib/types';

const ROUTE = '/hr/roster';

const toTime = (m: number | null) =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const today = () => new Date().toISOString().slice(0, 10);

/** The shift filter's two answers that are not a shift. */
const ALL = '';
const NONE = 'none';

/**
 * The roster, as a list of everybody (SRS §8.9, FR-HRP-01).
 *
 * The Roster tab on an employee is the right place to read and correct ONE
 * person's history. It is the wrong place to put ninety people on the morning
 * shift, and a job that means opening ninety records is a job that stops being
 * done — so this is the same series seen the other way round: every employee at
 * once, filtered by branch and by what they are on now, and assigned in one go.
 *
 * The rules do not change because the screen did. Each person still goes
 * through the ordinary assignment: the line before closes the day before, an
 * overlap is refused. One refusal does not cost the rest their assignment —
 * what failed comes back named, so it can be put right without guessing.
 */
export default function RosterPage() {
  const { can, activeCompanyId, activeBranchId } = useAuth();
  const toast = useToast();

  const [on, setOn] = useState(today());
  const [branchFilter, setBranchFilter] = useState<string>(ALL);
  const [shiftFilter, setShiftFilter] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const { data, loading, refetch } = useFetch<RosterRegister>(
    `/hr-rosters?on=${on}&branchId=${branchFilter || 'all'}`,
    [on, branchFilter, activeCompanyId, activeBranchId],
  );
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: shifts } = useFetch<HrShift[]>('/hr-shifts', [activeCompanyId]);
  // Division and department come from the COMPANY's own structure — a division
  // is a cost centre, a department the cost object under it — exactly as on the
  // employee form and the postings tab.
  const { data: costCenters } = useFetch<CostCenter[]>(
    activeCompanyId ? `/cost-centers?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: costObjects } = useFetch<CostObject[]>(
    activeCompanyId ? `/cost-objects?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );

  // ---- the assignment drawer ----
  const [open, setOpen] = useState(false);
  // Every field is "leave it as it is" until something is chosen: a transfer
  // that also changes the shift is one action, and so is one that does not.
  const [form, setForm] = useState({
    shiftId: '',
    branchId: '',
    costCenterId: '',
    costObjectId: '',
    effectiveFrom: today(),
    effectiveTo: '',
    remarks: '',
  });
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<BulkAssignResult['failed']>([]);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (shiftFilter === NONE && r.shiftId !== null) return false;
      if (shiftFilter !== ALL && shiftFilter !== NONE) {
        if (String(r.shiftId ?? '') !== shiftFilter) return false;
      }
      if (!q) return true;
      return (
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.designationName.toLowerCase().includes(q)
      );
    });
  }, [rows, shiftFilter, search]);

  // A row that scrolls out of the filter must not stay quietly selected —
  // "assign 12" has to mean the twelve on screen.
  useEffect(() => {
    setPicked((prev) => {
      const visible = new Set(shown.map((r) => r.employeeId));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shown]);

  const allShown =
    shown.length > 0 && shown.every((r) => picked.has(r.employeeId));
  const toggleAll = () =>
    setPicked(allShown ? new Set() : new Set(shown.map((r) => r.employeeId)));
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const canEdit = can(ROUTE, 'edit') || can(ROUTE, 'add');

  const openFor = (ids: number[]) => {
    if (!ids.length) return;
    setPicked(new Set(ids));
    setFailures([]);
    setForm({
      shiftId: '',
      branchId: '',
      costCenterId: '',
      costObjectId: '',
      // The day being looked at is the day they are most likely to mean.
      effectiveFrom: on,
      effectiveTo: '',
      remarks: '',
    });
    setOpen(true);
  };

  const assign = async () => {
    if (!changing) {
      toast.error('Choose a branch, a division, a department or a shift.');
      return;
    }
    if (!form.effectiveFrom) {
      toast.error('From which day?');
      return;
    }
    setSaving(true);
    try {
      // Only what was actually chosen is sent — an absent field means "leave
      // it as it is", which is what an untouched dropdown has to mean.
      const res = await api.post<BulkAssignResult>('/hr-rosters/assign', {
        employeeIds: [...picked],
        ...(form.shiftId ? { shiftId: Number(form.shiftId) } : {}),
        ...(form.branchId ? { branchId: Number(form.branchId) } : {}),
        ...(form.costCenterId
          ? { costCenterId: Number(form.costCenterId) }
          : {}),
        ...(form.costObjectId
          ? { costObjectId: Number(form.costObjectId) }
          : {}),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        remarks: form.remarks.trim() || null,
      });
      setFailures(res.failed);
      const done = [
        res.moved && `${res.moved} moved`,
        res.assigned && `${res.assigned} put on the shift`,
      ].filter(Boolean);
      if (done.length) toast.success(`${done.join(', ')}.`);
      else if (!res.failed.length) {
        toast.success('Nothing to change — they were already like that.');
      }
      if (!res.failed.length) {
        setOpen(false);
        setPicked(new Set());
      } else {
        toast.error(
          `${res.failed.length} could not be — see the drawer for who and why.`,
        );
      }
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * The departments offered — those under the chosen division, or all of them
   * until one is chosen. Filtered rather than validated afterwards: a
   * department under a different division is the one mistake two loose
   * dropdowns are guaranteed to make.
   */
  const departments = useMemo(() => {
    const all = (costObjects ?? []).filter((o) => o.isActive);
    return form.costCenterId
      ? all.filter((o) => o.costCenterId === Number(form.costCenterId))
      : all;
  }, [costObjects, form.costCenterId]);

  /** Has anything actually been chosen to change? */
  const changing = !!(
    form.shiftId ||
    form.branchId ||
    form.costCenterId ||
    form.costObjectId
  );

  const shiftById = useMemo(
    () => new Map((shifts ?? []).map((s) => [s.id, s])),
    [shifts],
  );
  const unrostered = shown.filter((r) => !r.shiftId).length;

  /** Where somebody's hours come from, said in the row. */
  const source = (r: RosterRegisterRow) =>
    r.shiftId
      ? null
      : r.ownHours
        ? 'their own hours'
        : 'the branch’s working day';

  return (
    <div className="mx-auto flex h-full max-w-[100rem] flex-col">
      <PageHeader
        title="Roster"
        description="Everybody at once — who is on which shift, and putting a list of them on one"
        icon={<Clock className="h-5 w-5" />}
        actions={
          canEdit && (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => openFor([...picked])}
              disabled={picked.size === 0}
              title={
                picked.size === 0
                  ? 'Tick the people to put on a shift'
                  : undefined
              }
            >
              <Users className="h-4 w-4" />
              Assign shift
              {picked.size > 0 && ` (${picked.size})`}
            </button>
          )
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <DateInput
            label="As at"
            wrapClassName="w-40"
            value={on}
            onChange={(iso) => iso && setOn(iso)}
          />
          <Select
            label="Branch"
            wrapClassName="w-52"
            value={branchFilter}
            placeholder="All branches"
            onChange={(e) => setBranchFilter(e.target.value)}
            options={(branches ?? [])
              .filter((b) => b.isActive)
              .map((b) => ({ value: String(b.id), label: b.name }))}
          />
          <Select
            label="Shift"
            wrapClassName="w-56"
            sortOptions={false}
            value={shiftFilter}
            placeholder="All shifts"
            onChange={(e) => setShiftFilter(e.target.value)}
            options={[
              { value: NONE, label: '— Not on a shift —' },
              ...(shifts ?? []).map((s) => ({
                value: String(s.id),
                label: `${s.code} — ${s.name}`,
              })),
            ]}
          />
          <label className="relative w-64">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Search
            </span>
            <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              className="input-base pl-9"
              value={search}
              placeholder="Name, code or designation"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {shown.length} of {rows.length}
            {unrostered > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {unrostered} not on a shift
              </span>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="p-6 text-sm text-slate-400">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">
              Nobody matches. Employees appear here from the day they join until
              their last working day.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    {canEdit && (
                      <Checkbox checked={allShown} onChange={toggleAll} />
                    )}
                  </th>
                  <th className="w-24 px-3 py-2.5">Emp. ID</th>
                  <th className="px-3 py-2.5">Employee</th>
                  <th className="px-3 py-2.5">Designation</th>
                  <th className="px-3 py-2.5">Branch</th>
                  <th className="px-3 py-2.5">Shift</th>
                  <th className="w-40 px-3 py-2.5">Timing</th>
                  <th className="w-32 px-3 py-2.5">From</th>
                  <th className="w-24 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const shift = r.shiftId ? shiftById.get(r.shiftId) : null;
                  const on = picked.has(r.employeeId);
                  return (
                    <tr
                      key={r.employeeId}
                      className={cn(
                        'border-b border-slate-100 last:border-0 dark:border-slate-800/60',
                        on && 'bg-brand-50/60 dark:bg-brand-950/20',
                        // Nobody has said what this person works — the row a
                        // manager opened this screen to find.
                        !r.shiftId &&
                          !on &&
                          'bg-amber-50/40 dark:bg-amber-950/10',
                      )}
                    >
                      <td className="px-3 py-2">
                        {canEdit && (
                          <Checkbox
                            checked={on}
                            onChange={() => toggle(r.employeeId)}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {r.employeeCode}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                        {r.employeeName}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {r.designationName}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {r.branchName ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {r.shiftId ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                              {r.shiftCode}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300">
                              {r.shiftName}
                            </span>
                            {shift?.overnight && (
                              <Moon
                                className="h-3.5 w-3.5 text-violet-500"
                                aria-label="Finishes the next day"
                              />
                            )}
                          </span>
                        ) : (
                          <Badge color="amber">Not on a shift</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                        {toTime(r.timeIn)} – {toTime(r.timeOut)}
                        {!r.shiftId && (
                          <span className="ml-2 text-xs text-slate-400">
                            {source(r)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                        {r.effectiveFrom
                          ? formatDayMonthYear(r.effectiveFrom)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canEdit && (
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300"
                            onClick={() => openFor([r.employeeId])}
                          >
                            {r.shiftId ? 'Change' : 'Assign'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={picked.size === 1 ? 'Assign' : `Assign ${picked.size} people`}
        subtitle="Where they work, what they work, or both — from the day it takes effect"
        footer={
          <DrawerFooter
            onCancel={() => setOpen(false)}
            onSave={assign}
            saving={saving}
            saveLabel="Assign"
          />
        }
      >
        <div className="space-y-4">
          {/* Where they work. Left alone unless something is chosen — this is
              one drawer for a transfer, a shift change, or both at once, and
              an untouched dropdown must not move anybody. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Branch"
              value={form.branchId}
              placeholder="Leave as it is"
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              options={(branches ?? [])
                .filter((b) => b.isActive)
                .map((b) => ({ value: b.id, label: b.name }))}
            />
            <Select
              label="Division"
              value={form.costCenterId}
              placeholder="Leave as it is"
              onChange={(e) =>
                setForm({
                  ...form,
                  costCenterId: e.target.value,
                  // A department belongs to ONE division, so changing the
                  // division drops a department that is no longer under it.
                  costObjectId: '',
                })
              }
              options={(costCenters ?? [])
                .filter((c) => c.isActive)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              label="Department"
              value={form.costObjectId}
              placeholder="Leave as it is"
              onChange={(e) =>
                setForm({ ...form, costObjectId: e.target.value })
              }
              options={departments.map((o) => ({ value: o.id, label: o.name }))}
            />
            <Select
              label="Shift"
              value={form.shiftId}
              placeholder="Leave as it is"
              onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
              options={(shifts ?? [])
                .filter((s) => s.isActive)
                .map((s) => ({
                  value: s.id,
                  label: `${s.code} — ${s.name} (${toTime(s.timeIn)}–${toTime(s.timeOut)})`,
                }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DateInput
              label="From"
              required
              value={form.effectiveFrom}
              onChange={(iso) => setForm({ ...form, effectiveFrom: iso })}
            />
            <DateInput
              label="Until (blank = until changed)"
              value={form.effectiveTo}
              onChange={(iso) => setForm({ ...form, effectiveTo: iso })}
            />
          </div>
          <Textarea
            label="Remarks"
            rows={2}
            value={form.remarks}
            placeholder="Covering nights while Suresh is on leave"
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />

          <p className="text-xs text-slate-400">
            Everybody ticked gets the same change from the same day. Moving
            somebody also writes the transfer into their service record, and
            anybody already there is left alone rather than moved twice. Anyone
            whose branch does not work that shift, or who already has a line
            covering it, is left as they are and listed here.
          </p>

          {/* Named rather than counted: "3 failed" is not something anybody can
              act on, and these are the ones still needing doing. */}
          {failures.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {failures.length} could not be put on it
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-amber-800 dark:text-amber-300">
                {failures.map((f) => (
                  <li key={f.employeeId}>
                    <span className="font-medium">{f.employeeName}</span> —{' '}
                    {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
