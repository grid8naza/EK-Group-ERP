'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Clock,
  Eye,
  Moon,
  Search,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { CloseFooter, Drawer, DrawerFooter } from '@/components/ui/Drawer';
import { Checkbox, DateInput, Select, Textarea } from '@/components/ui/Field';
import { ColumnToggle } from '@/components/ui/ColumnToggle';
import type {
  Branch,
  BulkAssignResult,
  CostCenter,
  CostObject,
  HrShift,
  HrTeam,
  RosterRegister,
  RosterRegisterRow,
} from '@/lib/types';

const ROUTE = '/hr/roster';

const toTime = (m: number | null) =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const today = () => new Date().toISOString().slice(0, 10);

/** One row-action button, so the four of them cannot drift apart. */
const ACTION_BTN =
  'rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:border-slate-200 disabled:hover:text-slate-300 dark:border-slate-700 dark:text-slate-300 dark:disabled:border-slate-800 dark:disabled:text-slate-600';

/** The shift filter's two answers that are not a shift. */
const ALL = '';
const NONE = 'none';
/** The team dropdown's answer that is not a team — out of every one. */
const NO_TEAM = 'none';

/**
 * The columns that can be put away, and their headings.
 *
 * Emp. ID and Employee are not among them: a row nobody can identify is a row
 * nobody can act on, and every action here is about a person.
 */
const OPTIONAL_COLS = [
  { key: 'designation', label: 'Designation' },
  { key: 'branch', label: 'Branch' },
  { key: 'team', label: 'Team' },
  { key: 'shift', label: 'Shift' },
  { key: 'timing', label: 'Timing' },
  { key: 'from', label: 'From' },
];

/**
 * Transfer — moving a list of people, in one action (SRS §8.9, FR-HRP-01).
 *
 * Five things can move, together or singly: the TEAM whose leader answers for
 * their attendance, the BRANCH they are posted to, their DIVISION and
 * DEPARTMENT, and the SHIFT they work. All from one effective date, because
 * that is how a transfer actually happens — somebody moves to the Kadathy
 * bakery, onto the night bake, in the packing team, from the 1st, and making
 * that three visits to three screens is how it ends up half done.
 *
 * The list is here to pick FROM, not to browse: it shows everybody as at a day
 * with what they are on, which is what tells you who needs moving. Reading and
 * correcting one person's history belongs on their own record, under Roster.
 *
 * The rules do not change because the screen did. Each person still goes
 * through the ordinary assignment — the line before closes the day before, an
 * overlap is refused — and the team through the ordinary membership transfer.
 * One refusal does not cost the rest theirs; what failed comes back named, so
 * it can be put right without guessing.
 */
export default function RosterPage() {
  const { can, activeCompanyId, activeBranchId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [on, setOn] = useState(today());
  const [branchFilter, setBranchFilter] = useState<string>(ALL);
  const [shiftFilter, setShiftFilter] = useState<string>(ALL);
  /** '' = everybody, 'in' = in a team, 'out' = in none. */
  const [teamFilter, setTeamFilter] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const shows = (key: string) => !hiddenCols.has(key);
  const toggleCol = (key: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const { data, loading, refetch } = useFetch<RosterRegister>(
    `/hr-rosters?on=${on}&branchId=${branchFilter || 'all'}`,
    [on, branchFilter, activeCompanyId, activeBranchId],
  );
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: shifts } = useFetch<HrShift[]>('/hr-shifts', [activeCompanyId]);
  // The teams somebody can be moved INTO. Every branch's, because the transfer
  // may move them to another branch in the same action.
  const { data: teams } = useFetch<HrTeam[]>('/hr-teams?branchId=all', [
    activeCompanyId,
  ]);
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

  /**
   * The person being read, or null.
   *
   * Where they stand on the day in the header: their team and who leads it,
   * where they are posted, and the hours they are marked against. Not their
   * history — the whole series is on their own record, and this screen's
   * question is who needs moving, which one day answers.
   */
  const [viewing, setViewing] = useState<RosterRegisterRow | null>(null);

  // ---- the assignment drawer ----
  const [open, setOpen] = useState(false);
  // Every field is "leave it as it is" until something is chosen: a transfer
  // that also changes the shift is one action, and so is one that does not.
  const [form, setForm] = useState({
    teamId: '',
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

  /** Two teams can share a name across branches, so the list says which. */
  const branchNames = useMemo(
    () => new Map((branches ?? []).map((b) => [b.id, b.name])),
    [branches],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (shiftFilter === NONE && r.shiftId !== null) return false;
      if (shiftFilter !== ALL && shiftFilter !== NONE) {
        if (String(r.shiftId ?? '') !== shiftFilter) return false;
      }
      // Assigned = in a team on this day, which is the same question the
      // Assign and Transfer buttons ask of each row.
      if (teamFilter === 'in' && !r.teamName) return false;
      if (teamFilter === 'out' && r.teamName) return false;
      if (!q) return true;
      return (
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.designationName.toLowerCase().includes(q)
      );
    });
  }, [rows, shiftFilter, teamFilter, search]);

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
      teamId: '',
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

  /**
   * Where one person stands on the day being looked at, as label/value pairs.
   *
   * The membership is found in the TEAMS rather than taken off the row: the row
   * carries the team's name, but the division, department and dates of the
   * spell are the membership's own, and they are what somebody opening this is
   * actually asking about.
   */
  const standing = (r: RosterRegisterRow) => {
    const spell = (teams ?? [])
      .flatMap((t) =>
        t.members
          .filter(
            (m) =>
              m.id === r.employeeId &&
              m.effectiveFrom <= on &&
              (!m.effectiveTo || m.effectiveTo >= on),
          )
          .map((m) => ({ team: t, member: m })),
      )
      .at(0);
    const divisionName = spell?.member.costCenterId
      ? ((costCenters ?? []).find((c) => c.id === spell.member.costCenterId)
          ?.name ?? '—')
      : '—';
    const departmentName = spell?.member.costObjectId
      ? ((costObjects ?? []).find((o) => o.id === spell.member.costObjectId)
          ?.name ?? '—')
      : '—';

    return [
      { label: 'Employee', value: `${r.employeeCode} · ${r.employeeName}` },
      { label: 'Designation', value: r.designationName },
      { label: 'Branch', value: r.branchName ?? 'The whole company' },
      { label: 'Team', value: spell ? spell.team.name : 'Not in a team' },
      {
        label: 'Team leader',
        value: spell ? spell.team.leaderName : '—',
      },
      { label: 'Division (in the team)', value: divisionName },
      { label: 'Department (in the team)', value: departmentName },
      {
        label: 'In the team from',
        value: spell ? formatDayMonthYear(spell.member.effectiveFrom) : '—',
      },
      {
        label: 'Until',
        value: spell
          ? spell.member.effectiveTo
            ? formatDayMonthYear(spell.member.effectiveTo)
            : 'until changed'
          : '—',
      },
      {
        label: 'Shift',
        value: r.shiftId ? `${r.shiftCode} — ${r.shiftName}` : 'Not on a shift',
      },
      {
        label: 'Hours',
        value:
          r.timeIn === null && r.timeOut === null
            ? "The branch's working day"
            : `${toTime(r.timeIn)} – ${toTime(r.timeOut)}`,
      },
      {
        // Which of the four answers their day is filled in from. Worth saying:
        // a team's shift beats their own roster line, so hours that look like
        // theirs may be the team's.
        label: 'Those hours come from',
        value: r.shiftFromTeam
          ? "The team's shift"
          : r.shiftId
            ? 'Their own roster line'
            : r.ownHours
              ? 'Their own hours'
              : "The branch's working day",
      },
    ];
  };

  // ---- Assign: one person, into a team they are not yet in ----
  const [assigning, setAssigning] = useState<RosterRegisterRow | null>(null);
  const [assignForm, setAssignForm] = useState({
    teamId: '',
    costCenterId: '',
    costObjectId: '',
    effectiveFrom: today(),
  });

  const openAssign = (r: RosterRegisterRow) => {
    setAssigning(r);
    setAssignForm({
      teamId: '',
      costCenterId: '',
      costObjectId: '',
      effectiveFrom: on,
    });
  };

  /** The teams this person could actually join — their branch's, and active. */
  const teamsFor = (r: RosterRegisterRow | null) =>
    (teams ?? []).filter(
      (t) => t.isActive && (t.branchId === null || t.branchId === r?.branchId),
    );

  const saveAssign = async () => {
    if (!assigning) return;
    if (!assignForm.teamId) {
      toast.error('Which team are they joining?');
      return;
    }
    if (!assignForm.costCenterId || !assignForm.costObjectId) {
      toast.error(
        'Say which division and department the team has them working in.',
      );
      return;
    }
    if (!assignForm.effectiveFrom) {
      toast.error('From which day?');
      return;
    }
    setSaving(true);
    try {
      await api.post('/hr-teams/transfer', {
        toTeamId: Number(assignForm.teamId),
        employeeIds: [assigning.employeeId],
        effectiveFrom: assignForm.effectiveFrom,
        costCenterId: Number(assignForm.costCenterId),
        costObjectId: Number(assignForm.costObjectId),
      });
      toast.success(`${assigning.employeeName} joined the team.`);
      setAssigning(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Take one person out of their team, from the day on screen.
   *
   * Their spell CLOSES the day before — it is not deleted, because the days
   * already marked under that leader are read back through it. From this day
   * they are marked on the branch's own sheet, which is where anybody in no
   * team is marked.
   */
  const removeFromTeam = async (r: RosterRegisterRow) => {
    const ok = await confirm({
      title: `Take ${r.employeeName} out of ${r.teamName}?`,
      message: `Their spell in ${r.teamName} ends the day before ${formatDayMonthYear(on)}. From then they are unassigned, and marked on the branch's own sheet. Days already marked are untouched — the entry on each of those sheets is the record of who answered for them at the time.`,
      danger: true,
      confirmText: 'Take them out',
      cancelText: 'Leave them in',
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.post('/hr-teams/transfer', {
        toTeamId: null,
        employeeIds: [r.employeeId],
        effectiveFrom: on,
      });
      toast.success(`${r.employeeName} is no longer in ${r.teamName}.`);
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
    }
  };

  const assign = async () => {
    if (!changing) {
      toast.error(
        'Choose a team, a branch, a division, a department or a shift.',
      );
      return;
    }
    if (!form.effectiveFrom) {
      toast.error('From which day?');
      return;
    }
    const placing = !!(
      form.shiftId ||
      form.branchId ||
      form.costCenterId ||
      form.costObjectId
    );
    setSaving(true);
    try {
      // Only what was actually chosen is sent — an absent field means "leave
      // it as it is", which is what an untouched dropdown has to mean.
      const res = placing
        ? await api.post<BulkAssignResult>('/hr-rosters/assign', {
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
          })
        : { moved: 0, assigned: 0, failed: [] };
      setFailures(res.failed);

      /**
       * The team, after the placement — a team refuses anybody who does not
       * work at its branch, so a move to the branch has to have landed first
       * for a move to that branch's team to be accepted.
       *
       * Its own endpoint because a membership is its own dated series, and
       * `fromTeamId` is left unsaid: this screen names where they are GOING,
       * and a mixed selection has no single answer for where each of them
       * started. The division and department chosen above go on the new
       * membership too — the same two answers, about the same work.
       */
      let joined = 0;
      if (form.teamId && !res.failed.length) {
        const team = await api.post<{ moved: number }>('/hr-teams/transfer', {
          toTeamId: form.teamId === NO_TEAM ? null : Number(form.teamId),
          employeeIds: [...picked],
          effectiveFrom: form.effectiveFrom,
          ...(form.costCenterId
            ? { costCenterId: Number(form.costCenterId) }
            : {}),
          ...(form.costObjectId
            ? { costObjectId: Number(form.costObjectId) }
            : {}),
        });
        joined = team.moved;
      }

      const done = [
        res.moved && `${res.moved} moved`,
        res.assigned && `${res.assigned} put on the shift`,
        joined &&
          `${joined} ${form.teamId === NO_TEAM ? 'taken out of their team' : 'put in the team'}`,
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
      toast.error(e instanceof ApiError ? e.message : 'Failed to transfer.');
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
    form.teamId ||
    form.shiftId ||
    form.branchId ||
    form.costCenterId ||
    form.costObjectId
  );

  const shiftById = useMemo(
    () => new Map((shifts ?? []).map((s) => [s.id, s])),
    [shifts],
  );
  // In no team on this day — the count this screen exists to work through.
  const unassigned = shown.filter((r) => !r.teamName).length;

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
        title="Transfer"
        description="Move a list of people — to another team, branch, division, department or shift, from one day"
        icon={<ArrowRightLeft className="h-5 w-5" />}
        actions={
          canEdit && (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => openFor([...picked])}
              disabled={picked.size === 0}
              title={
                picked.size === 0 ? 'Tick the people to transfer' : undefined
              }
            >
              <Users className="h-4 w-4" />
              Transfer
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
          {/* The question this screen is usually opened with: who has nobody
              answering for their attendance yet. */}
          <Select
            label="Team"
            wrapClassName="w-48"
            sortOptions={false}
            value={teamFilter}
            placeholder="Assigned & unassigned"
            onChange={(e) => setTeamFilter(e.target.value)}
            options={[
              { value: 'in', label: 'Assigned — in a team' },
              { value: 'out', label: 'Unassigned — in no team' },
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
            {unassigned > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {unassigned} unassigned
              </span>
            )}
          </span>
          <ColumnToggle
            columns={OPTIONAL_COLS}
            hidden={hiddenCols}
            onToggle={toggleCol}
          />
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
                  {shows('designation') && (
                    <th className="px-3 py-2.5">Designation</th>
                  )}
                  {shows('branch') && <th className="px-3 py-2.5">Branch</th>}
                  {shows('team') && <th className="px-3 py-2.5">Team</th>}
                  {shows('shift') && <th className="px-3 py-2.5">Shift</th>}
                  {shows('timing') && (
                    <th className="w-40 px-3 py-2.5">Timing</th>
                  )}
                  {shows('from') && <th className="w-32 px-3 py-2.5">From</th>}
                  <th className="w-32 px-3 py-2.5" />
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
                      {shows('designation') && (
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {r.designationName}
                        </td>
                      )}
                      {shows('branch') && (
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                          {r.branchName ?? '—'}
                        </td>
                      )}
                      {/* Who answers for their attendance on this day. Blank
                          means the branch's own sheet, which is a fact about
                          them rather than a gap. */}
                      {shows('team') && (
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                          {r.teamName ?? (
                            <span className="text-slate-400">
                              Not in a team
                            </span>
                          )}
                        </td>
                      )}
                      {shows('shift') && (
                        <td className="whitespace-nowrap px-3 py-2">
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
                      )}
                      {shows('timing') && (
                        <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                          {toTime(r.timeIn)} – {toTime(r.timeOut)}
                          {!r.shiftId && (
                            <span className="ml-2 text-xs text-slate-400">
                              {source(r)}
                            </span>
                          )}
                        </td>
                      )}
                      {shows('from') && (
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                          {r.effectiveFrom
                            ? formatDayMonthYear(r.effectiveFrom)
                            : '—'}
                        </td>
                      )}
                      {/* Assign, View, Transfer. The two writing actions are
                          the same question asked of opposite answers — is this
                          person in a team — so exactly one of them is ever
                          live. Both are SHOWN either way: a button that
                          appears and disappears down a list of ninety is a
                          button nobody can aim at, and a greyed one says why
                          it cannot be pressed. */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && (
                            <button
                              type="button"
                              disabled={!!r.teamName}
                              title={
                                r.teamName
                                  ? `Already in ${r.teamName} — use Transfer to move them`
                                  : 'Put them in a team'
                              }
                              className={ACTION_BTN}
                              onClick={() => openAssign(r)}
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                              <span className="sr-only">Assign</span>
                            </button>
                          )}
                          <button
                            type="button"
                            title="See where they stand on this day"
                            className={ACTION_BTN}
                            onClick={() => setViewing(r)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span className="sr-only">View</span>
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              disabled={!r.teamName}
                              title={
                                r.teamName
                                  ? 'Move them to another team, branch, division, department or shift'
                                  : 'Not in a team — use Assign to put them in one'
                              }
                              className={ACTION_BTN}
                              onClick={() => openFor([r.employeeId])}
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              <span className="sr-only">Transfer</span>
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              disabled={!r.teamName}
                              title={
                                r.teamName
                                  ? `Take them out of ${r.teamName} — from then they are marked on the branch's own sheet`
                                  : 'Not in a team — there is nothing to take them out of'
                              }
                              className={cn(
                                ACTION_BTN,
                                r.teamName &&
                                  'hover:border-rose-400 hover:text-rose-600',
                              )}
                              onClick={() => void removeFromTeam(r)}
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              <span className="sr-only">Remove</span>
                            </button>
                          )}
                        </div>
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
            {/* Who answers for their attendance. Their old spell closes the
                day before this one and a new one opens on it, so no day is
                claimed by two leaders and none by neither. "Out of every team"
                is offered because leaving a team is a transfer too — those
                days go back onto the branch's own sheet. */}
            <Select
              label="Team"
              wrapClassName="sm:col-span-2"
              sortOptions={false}
              value={form.teamId}
              placeholder="Leave as it is"
              onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              options={[
                { value: NO_TEAM, label: '— Out of every team —' },
                ...(teams ?? [])
                  .filter((t) => t.isActive)
                  .map((t) => ({
                    value: String(t.id),
                    label: t.branchId
                      ? `${t.name} — ${branchNames.get(t.branchId) ?? ''}`
                      : t.name,
                  })),
              ]}
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

      {/* Where one person stands on the day being looked at — and nothing
          else. Not their shift history: this screen's question is "who needs
          moving, and out of what", which one day answers. The whole series
          belongs on their own record, under Roster, beside the rest of it. */}
      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.employeeName ?? 'Employee'}
        subtitle={
          viewing
            ? `${viewing.employeeCode} · ${viewing.designationName}`
            : undefined
        }
        // Nothing to refetch on the way out: nothing in here can change.
        footer={<CloseFooter onClose={() => setViewing(null)} />}
      >
        {/* The team and who leads it, the branch, the division and department
            THAT TEAM has them doing, and the hours they are marked against —
            with where those hours came from, since a team's shift beats
            anything on their own line. */}
        {viewing && (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              As at {formatDayMonthYear(on)}
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              {standing(viewing).map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-slate-400">{label}</dt>
                  <dd className="mt-0.5 text-slate-700 dark:text-slate-200">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Drawer>

      {/* Assign — one person, into a team they are not in.
          Its own small form rather than the bulk drawer: joining a team asks
          three things the bulk drawer treats as optional, and all three are
          required of a membership. */}
      <Drawer
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={assigning ? `Put ${assigning.employeeName} in a team` : 'Assign'}
        subtitle={
          assigning
            ? `${assigning.employeeCode} · ${assigning.designationName}`
            : undefined
        }
        footer={
          <DrawerFooter
            onCancel={() => setAssigning(null)}
            onSave={saveAssign}
            saving={saving}
            saveLabel="Assign"
          />
        }
      >
        <div className="space-y-4">
          <Select
            label="Team"
            required
            value={assignForm.teamId}
            placeholder="Which team are they joining"
            onChange={(e) =>
              setAssignForm({ ...assignForm, teamId: e.target.value })
            }
            options={teamsFor(assigning).map((t) => ({
              value: String(t.id),
              label: t.shiftCode
                ? `${t.name} — ${t.leaderName} · ${t.shiftCode} ${t.shiftName}`
                : `${t.name} — ${t.leaderName}`,
            }))}
          />
          <p className="-mt-2 text-xs text-slate-400">
            Only the teams at this person&apos;s branch: nobody can be in a team
            at a branch they do not work at. Their leader marks them from the
            day below, and they are marked against the team&apos;s shift.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Division"
              required
              value={assignForm.costCenterId}
              placeholder="Which division's work"
              onChange={(e) =>
                setAssignForm({
                  ...assignForm,
                  costCenterId: e.target.value,
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
              value={assignForm.costObjectId}
              placeholder={
                assignForm.costCenterId
                  ? 'Which department'
                  : 'Pick a division first'
              }
              onChange={(e) =>
                setAssignForm({ ...assignForm, costObjectId: e.target.value })
              }
              options={(costObjects ?? [])
                .filter(
                  (o) =>
                    o.isActive &&
                    (!assignForm.costCenterId ||
                      String(o.costCenterId) === assignForm.costCenterId),
                )
                .map((o) => ({ value: o.id, label: o.name }))}
            />
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            The work THIS TEAM has them doing — the team&apos;s own answer, and
            nothing to do with the division and department on their employee
            record.
          </p>

          <DateInput
            label="From"
            required
            wrapClassName="sm:max-w-[16rem]"
            value={assignForm.effectiveFrom}
            onChange={(iso) =>
              setAssignForm({ ...assignForm, effectiveFrom: iso })
            }
          />
        </div>
      </Drawer>
    </div>
  );
}
