'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Select, DateInput } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  Branch,
  CostCenter,
  CostObject,
  HrShift,
  HrTeam,
} from '@/lib/types';

const today = () => new Date().toISOString().slice(0, 10);

const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const emptyForm = {
  branchId: '',
  teamId: '',
  costCenterId: '',
  costObjectId: '',
  shiftId: '',
  effectiveFrom: '',
  effectiveTo: '',
};

/**
 * An employee's team membership — which team, and from when.
 *
 * A dated SERIES, like the postings and the roster beside it: joining a team is
 * a new spell starting the day it takes effect, and the one before it closes
 * the day before. That is what lets last March's attendance say who answered
 * for them in March rather than who answers today.
 *
 * It sits ABOVE the roster because it usually decides it: a team works its
 * shift together, so for anybody in one the team's hours beat anything on their
 * own line. The roster below still matters for the days they are in no team.
 *
 * Reads the teams and picks this person's spells out of them rather than asking
 * for a series of its own — a team already carries its members with their
 * dates, and a second endpoint would be a second answer to keep in step.
 */
export function TeamPanel({
  employeeId,
  branchId,
  readOnly = false,
  onDirtyChange,
}: {
  employeeId: number | null;
  /** The branch THEY are at — a team at another branch would be refused. */
  branchId?: number | null;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const { activeCompanyId } = useAuth();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  /**
   * Everything offered here belongs to the company in the header.
   *
   * The teams and shifts are scoped by it server-side (they read the active
   * company off the request); the branches, divisions and departments are asked
   * for it by name. Without that, a form on one company's employee would offer
   * another company's branches — and the save is what would find out.
   */
  const {
    data: teams,
    loading,
    refetch,
  } = useFetch<HrTeam[]>('/hr-teams?branchId=all', [
    employeeId,
    activeCompanyId,
  ]);
  const { data: costCenters } = useFetch<CostCenter[]>(
    activeCompanyId ? `/cost-centers?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: costObjects } = useFetch<CostObject[]>(
    activeCompanyId ? `/cost-objects?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  // Every branch's shifts in one call: the form can move them to another
  // branch, so it needs more than the one they are at now.
  const { data: shifts } = useFetch<HrShift[]>('/hr-shifts?branchId=all', [
    activeCompanyId,
  ]);

  useEffect(() => {
    onDirtyChange?.(adding);
  }, [adding, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  /** Two teams can share a name across branches, so each spell says which. */
  const branchNames = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b.name])),
    [branches],
  );

  const divisionName = (id?: number | null) =>
    id ? ((costCenters ?? []).find((c) => c.id === id)?.name ?? '—') : '—';
  const departmentName = (id?: number | null) =>
    id ? ((costObjects ?? []).find((o) => o.id === id)?.name ?? '—') : '—';

  /** Every spell this person has had, newest first — the history, top down. */
  const spells = useMemo(() => {
    if (!employeeId) return [];
    const on = today();
    return (teams ?? [])
      .flatMap((t) =>
        t.members
          .filter((m) => m.id === employeeId)
          .map((m) => ({
            team: t,
            member: m,
            current:
              m.effectiveFrom <= on && (!m.effectiveTo || m.effectiveTo >= on),
          })),
      )
      .sort((a, b) =>
        b.member.effectiveFrom.localeCompare(a.member.effectiveFrom),
      );
  }, [teams, employeeId]);

  const inATeam = spells.some((s) => s.current);

  /**
   * Where they could go: the CHOSEN branch's teams, less the one they are
   * already in, which is not a move.
   *
   * Narrowed by the branch above it rather than validated afterwards — nobody
   * can be in a team at a branch they do not work at, so a team from elsewhere
   * is a choice the save would only refuse.
   */
  const current = spells.find((s) => s.current);
  const formBranchId = form.branchId ? Number(form.branchId) : null;
  const options = (teams ?? []).filter(
    (t) =>
      t.isActive &&
      formBranchId !== null &&
      (t.branchId === null || t.branchId === formBranchId) &&
      t.id !== current?.team.id,
  );

  /** The shifts that branch works — the same rule the server enforces. */
  const shiftOptions = (shifts ?? []).filter(
    (s) =>
      s.isActive &&
      (s.allBranches ||
        (formBranchId !== null && s.branchIds.includes(formBranchId))),
  );

  /** The departments under the chosen division — a department has just one. */
  const departmentOptions = (costObjects ?? []).filter(
    (o) =>
      o.isActive &&
      form.costCenterId &&
      String(o.costCenterId) === form.costCenterId,
  );

  const startAdd = () => {
    setForm({
      ...emptyForm,
      // Where they are now is where they are most likely staying.
      branchId: branchId ? String(branchId) : '',
      effectiveFrom: today(),
    });
    setAdding(true);
  };

  const save = async () => {
    if (!employeeId) return;
    // Everything but the end date. An assignment that leaves any of them
    // unsaid is one nobody can be marked against.
    const missing = [
      !form.branchId && 'a branch',
      !form.teamId && 'a team',
      !form.costCenterId && 'a division',
      !form.costObjectId && 'a department',
      !form.shiftId && 'a shift',
      !form.effectiveFrom && 'the day it starts',
    ].filter(Boolean);
    if (missing.length) {
      toast.error(
        `Say ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`,
      );
      return;
    }
    setSaving(true);
    try {
      /**
       * Placement first, then the team. A team refuses anybody not posted to
       * its branch, so a move to the branch has to have landed before a move
       * into that branch's team is accepted.
       *
       * The division and department do NOT go here: they are the work the TEAM
       * has them doing, not where the person sits on the master, and the two
       * are deliberately unrelated.
       */
      await api.post('/hr-rosters/assign', {
        employeeIds: [employeeId],
        branchId: Number(form.branchId),
        shiftId: Number(form.shiftId),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
      });
      // Whatever spell they are in closes the day before this one, so no day
      // is claimed by two leaders and none by neither.
      await api.post('/hr-teams/transfer', {
        toTeamId: Number(form.teamId),
        employeeIds: [employeeId],
        effectiveFrom: form.effectiveFrom,
        costCenterId: Number(form.costCenterId),
        costObjectId: Number(form.costObjectId),
      });
      toast.success(inATeam ? 'Moved to the team.' : 'Put on the team.');
      setAdding(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (!employeeId) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
          Save the employee first — somebody joins a team once they exist.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {readOnly
            ? 'Which team has answered for their attendance, and when. The sheet for any day carries whoever was in the team that day.'
            : 'Whose sheet they are marked on, and from when. Putting somebody in a team closes the spell before it — nobody is in two teams on one day, so that exactly one leader answers for each day.'}
        </p>
        {/* One button, and which one is the same question the row buttons on
            Transfer ask: is this person in a team today. Joining and moving
            are the same form — a membership opens either way — so only the
            word changes, and it changes to the one that is true. */}
        {!readOnly && !adding && (
          <button
            type="button"
            className="btn-primary inline-flex flex-none items-center gap-2"
            onClick={startAdd}
          >
            {inATeam ? (
              <>
                <ArrowRightLeft className="h-4 w-4" /> Transfer
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Put on a team
              </>
            )}
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-800 dark:bg-brand-950/20">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Branch first, and everything below cascades from it: it
                decides which teams they can be in and which shifts that branch
                works, so changing it clears both rather than leaving a choice
                the save would refuse. */}
            <Select
              label="Branch"
              required
              value={form.branchId}
              placeholder="Where they work"
              onChange={(e) =>
                setForm({
                  ...form,
                  branchId: e.target.value,
                  teamId: '',
                  shiftId: '',
                })
              }
              options={(branches ?? [])
                .filter((b) => b.isActive)
                .map((b) => ({ value: b.id, label: b.name }))}
            />
            <Select
              label="Team"
              required
              value={form.teamId}
              placeholder={
                !form.branchId
                  ? 'Pick a branch first'
                  : inATeam
                    ? 'Which team are they moving to'
                    : 'Which team are they joining'
              }
              onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              options={options.map((t) => ({
                value: String(t.id),
                label: `${t.name} — ${t.leaderName}`,
              }))}
            />
            <Select
              label="Division"
              required
              value={form.costCenterId}
              placeholder="Which division's work"
              onChange={(e) =>
                setForm({
                  ...form,
                  costCenterId: e.target.value,
                  // A department belongs to ONE division.
                  costObjectId: '',
                })
              }
              options={(costCenters ?? [])
                .filter((c) => c.isActive)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              label="Department"
              required
              value={form.costObjectId}
              placeholder={
                form.costCenterId ? 'Which department' : 'Pick a division first'
              }
              onChange={(e) =>
                setForm({ ...form, costObjectId: e.target.value })
              }
              options={departmentOptions.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
            />
            {/* Their OWN shift line. The team's shift beats it while they are
                in one, so this is what answers for the days they are not. */}
            <Select
              label="Shift"
              required
              wrapClassName="sm:col-span-2"
              value={form.shiftId}
              placeholder={
                form.branchId ? 'Which hours they work' : 'Pick a branch first'
              }
              onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
              options={shiftOptions.map((s) => ({
                value: s.id,
                label: `${s.code} — ${s.name} (${toTime(s.timeIn)}–${toTime(s.timeOut)})`,
              }))}
            />
            <DateInput
              label="From"
              required
              value={form.effectiveFrom}
              onChange={(iso) => setForm({ ...form, effectiveFrom: iso })}
            />
            {/* The one thing that may be left unsaid: most assignments run
                until somebody changes them, and a date invented to fill the
                box would be a leaving date nobody agreed. */}
            <DateInput
              label="To (blank = until changed)"
              value={form.effectiveTo}
              onChange={(iso) => setForm({ ...form, effectiveTo: iso })}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            The division and department are the work THIS TEAM has them doing —
            the team&apos;s own answer, and nothing to do with the ones on their
            employee record.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : spells.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
          Nobody has put this person in a team. They are marked on the
          branch&apos;s own sheet, along with everybody else in none.
        </p>
      ) : (
        /* The whole history as one table: every spell reads across the same
           seven columns, so two of them can be compared down a line rather
           than by holding one card in your head while reading the next. */
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
              <tr>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Division</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Shift</th>
                <th className="w-28 px-3 py-2">From</th>
                <th className="w-28 px-3 py-2">To</th>
              </tr>
            </thead>
            <tbody>
              {spells.map(({ team, member, current }) => (
                <tr
                  key={`${team.id}-${member.effectiveFrom}`}
                  className={cn(
                    'border-b border-slate-100 last:border-0 dark:border-slate-800/60',
                    // The spell in force today, which is the one most
                    // questions are actually about.
                    current && 'bg-brand-50/50 dark:bg-brand-950/20',
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                    {team.name}
                    {current && (
                      <Badge color="green" className="ml-2">
                        Current
                      </Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                    {team.branchId
                      ? (branchNames.get(team.branchId) ?? '—')
                      : 'The whole company'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                    {divisionName(member.costCenterId)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                    {departmentName(member.costObjectId)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                    {team.shiftCode
                      ? `${team.shiftCode} — ${team.shiftName}`
                      : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">
                    {formatDayMonthYear(member.effectiveFrom)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">
                    {member.effectiveTo
                      ? formatDayMonthYear(member.effectiveTo)
                      : 'until changed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inATeam && (
        <p className="text-xs text-slate-400">
          While they are in a team, the team&apos;s shift is what their
          attendance is filled in from — ahead of anything on the roster below.
        </p>
      )}
    </div>
  );
}
