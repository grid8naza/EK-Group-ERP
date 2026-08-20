'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Plus,
  UserCheck,
  AlertTriangle,
  UserPlus,
  Trash2,
  ArrowRightLeft,
  Clock,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDayMonthYear } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useLock } from '@/lib/useLock';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { Badge } from '@/components/ui/Badge';
import {
  CloseFooter,
  DISCARD_PROMPT,
  Drawer,
  DrawerFooter,
  type SaveMode,
} from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { useConfirm } from '@/providers/ConfirmProvider';
import {
  Checkbox,
  DateInput,
  Input,
  Select,
  Textarea,
} from '@/components/ui/Field';
import { EmployeePicker } from '@/components/hr/EmployeePicker';
import type {
  Branch,
  CostCenter,
  CostObject,
  Employee,
  HrShift,
  HrTeam,
} from '@/lib/types';

const toTime = (m: number | null) =>
  m === null || m === undefined
    ? ''
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const today = () => new Date().toISOString().slice(0, 10);
/** `2026-08-20` → `2026-08-21`. A new spell starts after the old one ends. */
const dayAfter = (iso: string) =>
  new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + 864e5)
    .toISOString()
    .slice(0, 10);

const ROUTE = '/hr/teams';

/**
 * One person's spell in the team, as the form holds it.
 *
 * The division and department are the MEMBERSHIP's — what this team has them
 * doing — and have nothing to do with the ones on their employee record.
 */
interface MemberRow {
  employeeId: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  costCenterId: number | null;
  costObjectId: number | null;
}

const empty = {
  name: '',
  branchId: '',
  leaderEmployeeId: '',
  shiftId: '',
  members: [] as MemberRow[],
  remarks: '',
  isActive: true,
};

/** A saved team, as the form holds it — used by Edit and by Save-and-stay. */
const formFrom = (row: HrTeam) => ({
  name: row.name,
  branchId: row.branchId ? String(row.branchId) : '',
  leaderEmployeeId: String(row.leaderEmployeeId),
  shiftId: row.shiftId ? String(row.shiftId) : '',
  members: row.members.map((m) => ({
    employeeId: m.id,
    effectiveFrom: m.effectiveFrom,
    effectiveTo: m.effectiveTo,
    costCenterId: m.costCenterId ?? null,
    costObjectId: m.costObjectId ?? null,
  })),
  remarks: row.remarks ?? '',
  isActive: row.isActive,
});

/**
 * Team Master (SRS §8.9) — who works together, and who answers for them.
 *
 * The point is answerability: each team's attendance is its own daily sheet,
 * marked and submitted by its LEADER, so a branch of ninety is marked by six
 * people who each know the dozen in front of them rather than by one person
 * guessing.
 *
 * A team belongs to one branch, and a person to at most one team — two leaders
 * marking the same person on the same day is exactly the argument a sheet
 * cannot settle. Anybody in no team is marked on the branch's own sheet.
 */
export default function TeamsPage() {
  const { can, activeCompanyId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data, loading, refetch } = useFetch<HrTeam[]>(
    '/hr-teams?branchId=all',
  );
  const { data: branches } = useFetch<Branch[]>(
    activeCompanyId ? `/branches?companyId=${activeCompanyId}` : null,
    [activeCompanyId],
  );
  const { data: employees } = useFetch<Employee[]>('/hr-employees');
  const { data: shifts } = useFetch<HrShift[]>('/hr-shifts?branchId=all', [
    activeCompanyId,
  ]);
  // Division and department come from the COMPANY master — a division is a
  // cost centre, a department a cost object under it — so the picker offers
  // every one the company keeps, not only those somebody is already in.
  const { data: costCenters } = useFetch<CostCenter[]>('/cost-centers');
  const { data: costObjects } = useFetch<CostObject[]>('/cost-objects');

  const divisions = useMemo(
    () =>
      (costCenters ?? [])
        .filter((c) => c.isActive && c.companyId === activeCompanyId)
        .map((c) => ({ id: c.id, name: c.name })),
    [costCenters, activeCompanyId],
  );
  const departments = useMemo(
    () =>
      (costObjects ?? [])
        .filter((o) => o.isActive && o.companyId === activeCompanyId)
        .map((o) => ({
          id: o.id,
          name: o.name,
          costCenterId: o.costCenterId,
        })),
    [costObjects, activeCompanyId],
  );

  /** The people-picker window, over the team form. */
  const [picking, setPicking] = useState(false);
  /** The transfer drawer, which acts on saved teams rather than this form. */
  const [transferring, setTransferring] = useState(false);

  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } =
    useLock<HrTeam>({
      endpoint: '/hr-teams',
      route: ROUTE,
      noun: 'team',
      nameOf: (t) => t.name,
      reload: refetch,
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HrTeam | null>(null);
  /** Read-only: the same form, disabled throughout, with nothing to save. */
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  /**
   * Who a branch move has just ended, waiting to be reassigned at the new one.
   *
   * Held apart from the members so the form can say "these people still need
   * dealing with" after their spells have been closed — the grid shows the
   * history, this shows the work left.
   */
  const [letGo, setLetGo] = useState<number[]>([]);

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
    setLetGo([]);
  };

  /**
   * Put a form on screen and treat it as the saved state. Everything that is
   * not somebody editing goes through here, so "dirty" means what it says —
   * including after a plain Save, which leaves the form open on what was just
   * written and must not go on claiming unsaved work.
   */
  const loadForm = (next: typeof empty) => {
    setBaseline(JSON.stringify(next));
    setForm(next);
  };

  /**
   * Is there unsaved work? Compared against what was loaded rather than the
   * did-anybody-type heuristic, because this form STAYS OPEN after a Save and
   * the heuristic never unsets — it would ask about work already written.
   *
   * It also covers the people grid, which is changed through a window that
   * renders outside the panel and so is invisible to the heuristic.
   */
  // A view drawer is never dirty — every control in it is disabled, so there
  // is nothing in there that anybody could have changed.
  const drawerDirty = useCallback(
    () => !view && baseline !== '' && JSON.stringify(form) !== baseline,
    [view, form, baseline],
  );

  /**
   * Close, asking first where that would lose something. Given to Cancel; the
   * X, Escape and the backdrop are guarded by the Drawer itself from the same
   * answer, so every way out asks once, and in the same words.
   */
  const requestClose = async () => {
    if (drawerDirty() && !(await confirm({ ...DISCARD_PROMPT }))) return;
    closeDrawer();
  };

  const branchName = (id: number | null) =>
    id === null
      ? 'The whole company'
      : ((branches ?? []).find((b) => b.id === id)?.name ?? `#${id}`);

  /**
   * The branches a team can be put at.
   *
   * Read once because it decides whether the branch is REQUIRED: a company
   * that keeps no branches has none to choose, and demanding one there would
   * be a form nobody could ever save.
   */
  const branchOptions = useMemo(
    () =>
      (branches ?? [])
        .filter((b) => b.isActive)
        .map((b) => ({ value: b.id, label: b.name })),
    [branches],
  );

  /**
   * Has the team's own definition been changed since it was saved?
   *
   * The MEMBERS are deliberately not part of this: adding people is what the
   * question gates, so counting them would lock the button the moment anybody
   * used it. What counts is the four fields that say what this team IS — and
   * two of them, the branch and the shift, decide who may be added and what
   * they will be marked against.
   */
  const headerDirty = useMemo(() => {
    if (!baseline) return false;
    const saved = JSON.parse(baseline) as typeof empty;
    const key = (f: typeof empty) =>
      [f.name, f.branchId, f.leaderEmployeeId, f.shiftId].join(' ');
    return key(form) !== key(saved);
  }, [form, baseline]);

  /**
   * The people a branch move let go and who have not been taken back on.
   *
   * Split by whether they can even be: somebody still posted to the old branch
   * cannot be in a team at the new one, and saying so by name beats offering
   * them and letting the save explain. Moving a PERSON between branches is a
   * service-record change and belongs on their own record, not here.
   */
  const reassign = useMemo(() => {
    const on = today();
    const outstanding = letGo.filter(
      (id) =>
        !form.members.some(
          (m) => m.employeeId === id && (!m.effectiveTo || m.effectiveTo > on),
        ),
    );
    const byId = new Map((employees ?? []).map((e) => [e.id, e]));
    const branchId = form.branchId ? Number(form.branchId) : null;
    const people = outstanding
      .map((id) => byId.get(id))
      .filter((e): e is Employee => !!e);
    return {
      here: people.filter(
        (e) => e.isActive && (branchId === null || e.branchId === branchId),
      ),
      elsewhere: people.filter(
        (e) => !e.isActive || (branchId !== null && e.branchId !== branchId),
      ),
      any: people.length > 0,
    };
  }, [letGo, form.members, form.branchId, employees]);

  /**
   * Why nobody can be added yet, or null when they can.
   *
   * The team has to EXIST first. People join a team, and a team that has not
   * been saved is not yet one — putting a dozen people into an unsaved form is
   * a dozen memberships that vanish with one stray click, and it is the point
   * where a person becomes committed to days that nothing has recorded.
   *
   * Then the branch, which says who is even eligible, and the shift, which is
   * what everybody added will be marked against. Both settled before anybody
   * is taken on, because changing either afterwards would change who is
   * already in the list.
   */
  const peopleBlocked = !editing
    ? 'Save the team first — people join a team that exists.'
    : branchOptions.length && !form.branchId
      ? 'Choose the branch first — it decides who can be in this team.'
      : !form.shiftId
        ? 'Choose the shift first — everybody added is marked against it.'
        : headerDirty
          ? 'Save the team first — its people are added against the branch and shift as saved, not as typed.'
          : null;

  /** Who works at this team's branch — before anybody's commitments. */
  const eligible = useMemo(() => {
    const branchId = form.branchId ? Number(form.branchId) : null;
    return (employees ?? []).filter(
      (e) => e.isActive && (branchId === null || e.branchId === branchId),
    );
  }, [employees, form.branchId]);

  /**
   * Every spell anybody is already committed to — this team's own, as the form
   * currently holds them, and every other team's.
   *
   * One list because it answers one question: is this person free for the days
   * being asked about. The spells rather than the people, since membership is
   * DATED — somebody whose spell ended yesterday is free today, whether that
   * spell was here or somewhere else. The picker holds the dates, so it does
   * the deciding.
   */
  const engaged = useMemo(
    () => [
      ...form.members.map((m) => ({
        employeeId: m.employeeId,
        effectiveFrom: m.effectiveFrom,
        effectiveTo: m.effectiveTo,
      })),
      ...(data ?? [])
        .filter((t) => t.id !== editing?.id)
        .flatMap((t) =>
          t.members.map((m) => ({
            employeeId: m.id,
            effectiveFrom: m.effectiveFrom,
            effectiveTo: m.effectiveTo,
          })),
        ),
    ],
    [form.members, data, editing],
  );

  /** The leader is chosen from the same branch, member or not. */
  const leaderOptions = useMemo(() => {
    const branchId = form.branchId ? Number(form.branchId) : null;
    return (employees ?? [])
      .filter(
        (e) => e.isActive && (branchId === null || e.branchId === branchId),
      )
      .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}` }));
  }, [employees, form.branchId]);

  /** The spells in the form, each married to the person it is about. */
  const chosen = useMemo(() => {
    const byId = new Map((employees ?? []).map((e) => [e.id, e]));
    return form.members
      .map((m) => ({ ...m, employee: byId.get(m.employeeId) }))
      .filter((m): m is MemberRow & { employee: Employee } => !!m.employee)
      .sort((a, b) => a.employee.code.localeCompare(b.employee.code));
  }, [employees, form.members]);

  /** The shifts this team's branch works — the same rule the roster keeps. */
  const shiftOptions = useMemo(() => {
    const branchId = form.branchId ? Number(form.branchId) : null;
    return (shifts ?? [])
      .filter(
        (sh) =>
          sh.isActive &&
          (sh.allBranches ||
            (branchId !== null && sh.branchIds.includes(branchId))),
      )
      .map((sh) => ({
        value: sh.id,
        label: `${sh.code} — ${sh.name} (${toTime(sh.timeIn)}–${toTime(sh.timeOut)})`,
      }));
  }, [shifts, form.branchId]);

  /**
   * Move the team to another branch.
   *
   * Everything hangs off the branch: it decides who may be in the team, which
   * shifts it can work, and who may lead it. So the leader and the shift go,
   * and every membership ENDS — nobody can be in a team at a branch they do
   * not work at.
   *
   * Ended, not deleted. A spell that ran until yesterday is the record of who
   * answered for those days, and the sheets already marked against it are read
   * back through it; dropping the rows would leave those days unexplained.
   * A spell that had not started yet is dropped, because it never happened.
   *
   * Everybody let go is then handed straight back to be reassigned at the new
   * branch, with a fresh division, department and start date — the move is a
   * restructure, and leaving somebody to be remembered about is how a person
   * ends up on nobody's sheet.
   */
  const changeBranch = async (next: string) => {
    if (next === form.branchId) return;
    const on = today();
    const current = form.members.filter(
      (m) => !m.effectiveTo || m.effectiveTo >= on,
    );

    if (current.length) {
      const count = current.length;
      const ok = await confirm({
        title: 'Move this team to another branch?',
        message: `${count === 1 ? 'The one person' : `All ${count} people`} in this team ${count === 1 ? 'works' : 'work'} at ${branchName(form.branchId ? Number(form.branchId) : null)}. Moving it to ${branchName(next ? Number(next) : null)} ends ${count === 1 ? 'their spell' : 'their spells'} on ${formatDayMonthYear(on)} and takes the leader off — nobody can be in a team at a branch they do not work at. Days already marked are untouched, and you will be offered ${count === 1 ? 'them' : 'them all'} again for the new branch.`,
        danger: true,
        confirmText: 'Move it',
        cancelText: 'Keep the branch',
        defaultCancel: true,
      });
      if (!ok) return;
    }

    setForm({
      ...form,
      branchId: next,
      leaderEmployeeId: '',
      shiftId: '',
      members: form.members
        // A spell that has not begun never happened — there is nothing to end.
        .filter((m) => m.effectiveFrom <= on)
        .map((m) =>
          !m.effectiveTo || m.effectiveTo >= on ? { ...m, effectiveTo: on } : m,
        ),
    });
    setLetGo(current.map((m) => m.employeeId));
  };

  /** Change one person's dates without disturbing anybody else's. */
  const setMember = (employeeId: number, patch: Partial<MemberRow>) =>
    setForm((f) => ({
      ...f,
      members: f.members.map((m) =>
        m.employeeId === employeeId ? { ...m, ...patch } : m,
      ),
    }));

  const openNew = () => {
    setEditing(null);
    setView(false);
    loadForm({ ...empty });
    setLetGo([]);
    setOpen(true);
  };

  const openEdit = (row: HrTeam) =>
    guardEdit(row, () => {
      setEditing(row);
      setView(false);
      loadForm(formFrom(row));
      setLetGo([]);
      setOpen(true);
    });

  /**
   * Read the team without being able to change it — and without the lock
   * check Edit runs, since a locked team is exactly one somebody may still
   * need to read.
   */
  const openView = (row: HrTeam) => {
    setEditing(row);
    setView(true);
    loadForm(formFrom(row));
    setLetGo([]);
    setOpen(true);
  };

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Give the team a name.');
      return;
    }
    // Only where there ARE branches: a company that keeps none has nothing to
    // choose, and its teams belong to the company itself.
    if (branchOptions.length && !form.branchId) {
      toast.error('Say which branch the team works at.');
      return;
    }
    if (!form.leaderEmployeeId) {
      toast.error('Who leads it? A team without a leader marks nothing.');
      return;
    }
    if (!form.shiftId) {
      toast.error(
        'Say which shift the team works — it is what its people are marked against.',
      );
      return;
    }
    // Caught here rather than on the way back: every one of these is about a
    // row on this screen, and the screen is where it can be pointed at.
    const undated = chosen.find((m) => !m.effectiveFrom);
    if (undated) {
      toast.error(`Say what day ${undated.employee.name} joins the team.`);
      return;
    }
    const placeless = chosen.find((m) => !m.costCenterId || !m.costObjectId);
    if (placeless) {
      toast.error(
        `Say which division and department ${placeless.employee.name} works in for this team.`,
      );
      return;
    }
    const backwards = chosen.find(
      (m) => m.effectiveTo && m.effectiveTo < m.effectiveFrom,
    );
    if (backwards) {
      toast.error(
        `${backwards.employee.name} cannot leave the team before the day they join it.`,
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        branchId: form.branchId ? Number(form.branchId) : null,
        leaderEmployeeId: Number(form.leaderEmployeeId),
        shiftId: form.shiftId ? Number(form.shiftId) : null,
        members: form.members,
        remarks: form.remarks.trim() || null,
        isActive: form.isActive,
      };
      const saved = editing
        ? await api.patch<HrTeam>(`/hr-teams/${editing.id}`, payload)
        : await api.post<HrTeam>('/hr-teams', payload);
      toast.success(editing ? 'Team updated.' : 'Team created.');
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        loadForm({ ...empty });
        // A new team inherits nothing, least of all the last one's loose ends.
        setLetGo([]);
      } else if (mode === 'save') {
        // Stays open on what was just saved — including the member rows as the
        // server settled them, so a second Save is not sending stale dates.
        setEditing(saved);
        loadForm(formFrom(saved));
      } else {
        closeDrawer();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: HrTeam) =>
    guardDelete(row, async () => {
      try {
        await api.delete(`/hr-teams/${row.id}`);
        toast.success('Team removed.');
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to remove.');
      }
    });

  const columns: Column<HrTeam>[] = [
    { key: 'name', header: 'Team', sortable: true, accessor: (r) => r.name },
    {
      key: 'leader',
      header: 'Team leader',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5 text-brand-600" />
          {r.leaderName}
        </span>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      accessor: (r) => branchName(r.branchId),
    },
    {
      key: 'shift',
      header: 'Shift',
      render: (r) =>
        r.shiftId ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-mono text-xs">{r.shiftCode}</span>
            <span>{r.shiftName}</span>
          </span>
        ) : (
          <span className="text-slate-400">Each their own</span>
        ),
    },
    {
      key: 'members',
      header: 'People',
      render: (r) =>
        r.memberIds.length ? (
          <span className="tabular-nums">{r.memberIds.length}</span>
        ) : (
          // An empty team marks an empty sheet — worth noticing, not hiding.
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> nobody yet
          </span>
        ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Team Master"
        description="Who works together, and who answers for their attendance"
        icon={<Users className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can(ROUTE, 'edit') && (data ?? []).length > 0 && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => setTransferring(true)}
              >
                <ArrowRightLeft className="h-4 w-4" /> Transfer people
              </button>
            )}
            {can(ROUTE, 'add') && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={openNew}
              >
                <Plus className="h-4 w-4" /> Add a team
              </button>
            )}
          </div>
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {!activeCompanyId ? (
          <p className="text-sm text-slate-400">Choose a company first.</p>
        ) : (
          <DataTable
            rows={data ?? []}
            columns={columns}
            loading={loading}
            rowKey={(r) => r.id}
            emptyMessage="No teams yet. Without them, a branch marks one sheet a day for everybody."
            onView={can(ROUTE, 'view') ? openView : undefined}
            onEdit={can(ROUTE, 'edit') ? openEdit : undefined}
            onDelete={can(ROUTE, 'delete') ? remove : undefined}
            renderLock={(r) => (
              <LockButton
                locked={r.isLocked}
                canLock={canLock}
                canUnlock={canUnlock}
                onToggle={() => toggleLock(r)}
              />
            )}
            bulkLock={bulkLock}
          />
        )}
      </div>

      <Drawer
        open={open}
        // The RAW close: the Drawer asks for itself, from `dirty` below, on the
        // X, Escape and the backdrop. Guarding here as well would ask twice.
        onClose={closeDrawer}
        dirty={drawerDirty}
        title={view ? 'View team' : editing ? 'Edit team' : 'Add a team'}
        subtitle="Its leader marks its attendance, day by day"
        // Wide enough for the member grid: eight columns, four of them
        // controls, and a From date squeezed to "20," is a date nobody can
        // check.
        width="xxl"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={requestClose}
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Team"
                required
                value={form.name}
                placeholder="Oven Team"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <Select
                label="Branch"
                required={branchOptions.length > 0}
                value={form.branchId}
                placeholder={
                  branchOptions.length
                    ? 'Where the team works'
                    : 'The whole company'
                }
                onChange={(e) => void changeBranch(e.target.value)}
                options={branchOptions}
              />
            </div>

            <Select
              label="Team leader"
              required
              value={form.leaderEmployeeId}
              placeholder="Who answers for this team"
              onChange={(e) =>
                setForm({ ...form, leaderEmployeeId: e.target.value })
              }
              options={leaderOptions}
            />
            <p className="-mt-2 text-xs text-slate-400">
              They mark this team&apos;s attendance every day, and submit it for
              verification. They need a login to do so — one is given on their
              own record, under User Access.
            </p>

            {/* A team works its shift TOGETHER, which is most of what makes it a
              team — so the hours belong here rather than on each member's own
              roster, and they beat it. */}
            <Select
              label="Shift the team works"
              required
              value={form.shiftId}
              placeholder={
                form.branchId || !branchOptions.length
                  ? 'Which hours the team works'
                  : 'Pick the branch first'
              }
              onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
              options={shiftOptions}
            />
            <p className="-mt-2 text-xs text-slate-400">
              Everybody in the team is marked against these hours, ahead of
              anything on their own roster — a team works its shift together,
              and that is most of what makes it a team. Only the shifts this
              team&apos;s branch works are offered.
            </p>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  People in the team{' '}
                  <span className="text-slate-400">({chosen.length})</span>
                </span>
                {/* Hidden rather than disabled while viewing: a greyed button is
                  an offer withdrawn, and there is no offer here to withdraw. */}
                {!view && (
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2"
                    // The branch decides WHO may be added and the shift decides
                    // what they are marked against, so both are settled before
                    // anybody is taken on — not asked for afterwards, when the
                    // answer would change who is already in the list.
                    disabled={!!peopleBlocked}
                    title={peopleBlocked ?? undefined}
                    onClick={() => setPicking(true)}
                  >
                    <UserPlus className="h-4 w-4" /> Add people
                  </button>
                )}
              </div>

              {peopleBlocked && !view && (
                <p className="mb-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                  {peopleBlocked}
                </p>
              )}

              {/* What the branch move left to do. The grid below shows their
                  spells as they now stand — ended, not erased; this says who
                  still has to be placed, and offers them back in one go. */}
              {reassign.any && !view && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/20">
                  <p className="font-medium text-amber-700 dark:text-amber-300">
                    The branch changed, so these spells were ended. Reassign
                    them at{' '}
                    {branchName(form.branchId ? Number(form.branchId) : null)},
                    with a division, department and start date of their own.
                  </p>

                  {reassign.here.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-slate-600 dark:text-slate-300">
                        {reassign.here
                          .map((e) => `${e.code} ${e.name}`)
                          .join(', ')}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-2 py-1 text-xs"
                        disabled={!!peopleBlocked}
                        title={peopleBlocked ?? undefined}
                        onClick={() => setPicking(true)}
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Reassign{' '}
                        {reassign.here.length > 1 &&
                          `(${reassign.here.length})`}
                      </button>
                    </div>
                  )}

                  {reassign.elsewhere.length > 0 && (
                    <p className="mt-2 text-slate-600 dark:text-slate-300">
                      {reassign.elsewhere
                        .map((e) => `${e.code} ${e.name}`)
                        .join(', ')}{' '}
                      cannot come along — they are not posted to this branch.
                      Move them on their own record first, under Postings; a
                      person&apos;s branch is a service-record change, not a
                      team&apos;s to make.
                    </p>
                  )}
                </div>
              )}

              {chosen.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
                  Nobody in it yet. A team with no people marks an empty sheet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  {/* A floor, not just a width: `w-full` alone lets the browser
                      take the room back off the narrowest columns when the
                      wider ones need it, and the ones it takes it off are the
                      dates. Below this the container scrolls instead. */}
                  <table className="w-full min-w-[60rem] text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                      <tr>
                        <th className="w-24 px-3 py-2">Emp. ID</th>
                        <th className="px-3 py-2">Employee</th>
                        <th className="px-3 py-2">Designation</th>
                        <th className="w-48 px-3 py-2">Division</th>
                        <th className="w-48 px-3 py-2">Department</th>
                        <th className="w-36 px-3 py-2">From</th>
                        <th className="w-36 px-3 py-2">Until</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {chosen.map((m) => (
                        <tr
                          key={m.employeeId}
                          className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                        >
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">
                            {m.employee.code}
                          </td>
                          {/* A name and a designation each read as one thing:
                              broken over two lines they read as two, and a
                              grid of them is twice as tall for no gain. The
                              table scrolls sideways instead. */}
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                            {m.employee.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                            {m.employee.designationName ?? '—'}
                          </td>
                          {/* The work THIS TEAM has them doing. Chosen here, not
                            read off the employee record: a director on the
                            master can spend the morning on Operations · Bakery
                            with the Bakery Team, and only the team knows it. */}
                          <td className="px-3 py-2">
                            <Select
                              value={m.costCenterId ?? ''}
                              placeholder="—"
                              onChange={(e) =>
                                setMember(m.employeeId, {
                                  costCenterId: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                  // The department belonged to the old division;
                                  // keeping it would pair two that do not go
                                  // together, which the server refuses.
                                  costObjectId: null,
                                })
                              }
                              options={divisions.map((d) => ({
                                value: d.id,
                                label: d.name,
                              }))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={m.costObjectId ?? ''}
                              placeholder={
                                m.costCenterId ? '—' : 'Pick a division first'
                              }
                              onChange={(e) =>
                                setMember(m.employeeId, {
                                  costObjectId: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                })
                              }
                              options={departments
                                .filter(
                                  (d) =>
                                    !m.costCenterId ||
                                    d.costCenterId === m.costCenterId,
                                )
                                .map((d) => ({ value: d.id, label: d.name }))}
                            />
                          </td>
                          {/* Editable per person: a team usually takes people on
                            in ones and twos, and the day each of them started
                            is what the old sheets were marked against. */}
                          <td className="px-3 py-2">
                            <DateInput
                              value={m.effectiveFrom}
                              onChange={(iso) =>
                                setMember(m.employeeId, { effectiveFrom: iso })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <DateInput
                              value={m.effectiveTo ?? ''}
                              placeholder="No end"
                              onChange={(iso) =>
                                setMember(m.employeeId, {
                                  effectiveTo: iso || null,
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            {!view && (
                              <button
                                type="button"
                                title="Take out of the team"
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                                onClick={() =>
                                  setForm({
                                    ...form,
                                    members: form.members.filter(
                                      (x) => x.employeeId !== m.employeeId,
                                    ),
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-2 text-xs text-slate-400">
                The division and department here are the work THIS TEAM has each
                person doing. They are the team&apos;s own: they neither come
                from nor change the division and department on the person&apos;s
                employee record, so a director on the master can be down as
                Operations · Bakery in the Bakery Team.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Each person is in the team FROM a day, and optionally UNTIL one
                — the sheet for any day carries whoever was in the team that
                day, so somebody who joins in April is not added to March. Leave
                Until empty while they are still in it. Nobody can be in two
                teams on one day, so that exactly one leader answers for each
                day of their attendance; to move somebody out of another team,
                use Transfer. Anybody in no team on a day is marked on the
                branch&apos;s own sheet.
              </p>
            </div>

            <Textarea
              label="Remarks"
              rows={2}
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
            <Checkbox
              label="Active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>

      {/* Choosing people, in a window over the form. The division, department
          and dates at its top are the terms everybody ticked joins ON — twelve
          people onto Operations · Bakery from the 1st is one statement, and
          making it twelve times is how it stops being made. */}
      <EmployeePicker
        open={picking}
        onClose={() => setPicking(false)}
        // Appended, never replaced: the window ADDS a batch and stays open, so
        // what it hands back is this batch and not the whole team. Whoever is
        // already in keeps the terms they were put in on.
        onConfirm={(ids, placement) =>
          setForm((f) => {
            const known = new Set(f.members.map((m) => m.employeeId));
            return {
              ...f,
              members: [
                ...f.members,
                ...ids
                  .filter((id) => !known.has(id))
                  .map((employeeId) => ({ employeeId, ...placement })),
              ],
            };
          })
        }
        employees={eligible}
        divisions={divisions}
        departments={departments}
        // Whose days are already spoken for — here or in another team. Neither
        // is a name worth reading down a list of ninety.
        engaged={engaged}
        // The people a branch move just let go come back ticked, so reassigning
        // a dozen is choosing their terms rather than finding them again.
        preselect={reassign.here.map((e) => e.id)}
        title="People in the team"
        subtitle="Their leader marks this team's attendance every day"
        askPeriod
        askPlace
        defaultPlacement={{
          // Their old spell ended today, so the new one starts tomorrow —
          // a day claimed twice is a day two arrangements both answer for.
          effectiveFrom: reassign.any ? dayAfter(today()) : today(),
          effectiveTo: null,
          costCenterId: null,
          costObjectId: null,
        }}
        placementHint="Everybody ticked joins the team on these terms — the division and department are the work this team has them doing, nothing to do with their employee record. Leave Until empty while they are still in it. Each person's row can be changed on the form afterwards."
        emptyText={
          !form.branchId
            ? 'Nobody is available. Choose the branch first.'
            : form.members.length
              ? 'Nobody else to add — everybody free at this branch is in the team. To take somebody out of another team, use Transfer.'
              : 'Everybody at this branch is already in a team for these days. Change the dates, or use Transfer to move somebody here.'
        }
      />

      <TransferDrawer
        open={transferring}
        onClose={() => setTransferring(false)}
        teams={data ?? []}
        employees={employees ?? []}
        divisions={divisions}
        departments={departments}
        onDone={refetch}
      />
    </div>
  );
}

/**
 * Moving people between teams.
 *
 * Its own drawer rather than an edit of both teams: taking somebody out of one
 * and putting them in another has to happen together, and two saves in a row is
 * a moment where they are in neither. "Not in a team" is offered on both sides,
 * so this is also how somebody joins their first team or leaves the last one.
 */
function TransferDrawer({
  open,
  onClose,
  teams,
  employees,
  divisions,
  departments,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  teams: HrTeam[];
  employees: Employee[];
  divisions: { id: number; name: string }[];
  departments: { id: number; name: string; costCenterId: number }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [on, setOn] = useState<string>(today());
  // A transfer CREATES a membership, so it has to answer the same questions
  // the form does about it. Only when they are going into a team: moving
  // somebody out of every team creates nothing.
  const [division, setDivision] = useState('');
  const [department, setDepartment] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFromId('');
    setToId('');
    setOn(today());
    setDivision('');
    setDepartment('');
    setPicked(new Set());
  }, [open]);

  /** Whether a spell covers the day the move takes effect. */
  const covers = useMemo(
    () => (m: { effectiveFrom: string; effectiveTo: string | null }) =>
      m.effectiveFrom <= on && (!m.effectiveTo || m.effectiveTo >= on),
    [on],
  );

  const inTeam = useMemo(
    () =>
      new Set(teams.flatMap((t) => t.members.filter(covers).map((m) => m.id))),
    [teams, covers],
  );

  /**
   * Who is in the team being moved OUT of — or in no team at all — ON THE DAY
   * the move takes effect. Read against that day rather than today, because
   * that is the day the server checks and a list built from any other one
   * would be offering people it will then refuse.
   */
  const source = useMemo(() => {
    if (fromId === '') return [];
    if (fromId === 'none') {
      return employees.filter((e) => e.isActive && !inTeam.has(e.id));
    }
    const team = teams.find((t) => String(t.id) === fromId);
    const ids = new Set((team?.members ?? []).filter(covers).map((m) => m.id));
    return employees.filter((e) => ids.has(e.id));
  }, [fromId, teams, employees, inTeam, covers]);

  const options = [
    { value: 'none', label: '— Not in a team —' },
    ...teams.map((t) => ({ value: String(t.id), label: t.name })),
  ];

  const move = async () => {
    if (fromId === '' || toId === '') {
      toast.error('From which team, and to which?');
      return;
    }
    if (fromId === toId) {
      toast.error('They are already there.');
      return;
    }
    if (!picked.size) {
      toast.error('Nobody is ticked.');
      return;
    }
    if (!on) {
      toast.error('Say what day the move takes effect.');
      return;
    }
    if (toId !== 'none' && (!division || !department)) {
      toast.error(
        'Say which division and department the new team has them working in.',
      );
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ moved: number }>('/hr-teams/transfer', {
        fromTeamId: fromId === 'none' ? null : Number(fromId),
        toTeamId: toId === 'none' ? null : Number(toId),
        employeeIds: [...picked],
        effectiveFrom: on,
        costCenterId: division ? Number(division) : null,
        costObjectId: department ? Number(department) : null,
      });
      toast.success(
        `${res.moved} ${res.moved === 1 ? 'person' : 'people'} moved from ${formatDayMonthYear(on)}.`,
      );
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to move.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * A transfer half set up is work too — the two teams, the day, the place and
   * a dozen people ticked. Same question, same words as the team form.
   */
  const dirty = useCallback(
    () => !!(fromId || toId || picked.size),
    [fromId, toId, picked],
  );
  const requestClose = async () => {
    if (dirty() && !(await confirm({ ...DISCARD_PROMPT }))) return;
    onClose();
  };

  return (
    <Drawer
      open={open}
      // Raw: the Drawer asks for itself from `dirty`. See the team form above.
      onClose={onClose}
      dirty={dirty}
      title="Transfer people"
      subtitle="Out of one team and into another, in one move"
      width="lg"
      footer={
        <DrawerFooter
          onCancel={requestClose}
          onSave={move}
          saving={saving}
          saveLabel="Transfer"
        />
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="From"
            value={fromId}
            placeholder="Which team are they in now?"
            onChange={(e) => {
              setFromId(e.target.value);
              setPicked(new Set());
            }}
            options={options}
          />
          <Select
            label="To"
            value={toId}
            placeholder="Where are they going?"
            onChange={(e) => {
              setToId(e.target.value);
              // The new team decides its own work; the old team's answer has
              // nothing to say about it.
              setDivision('');
              setDepartment('');
            }}
            options={options}
          />
        </div>

        {/* Only when they are going INTO a team — moving somebody out of every
            team creates no membership, so there is nothing to place. */}
        {toId !== '' && toId !== 'none' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Division"
              required
              value={division}
              placeholder="Which division's work"
              onChange={(e) => {
                setDivision(e.target.value);
                setDepartment('');
              }}
              options={divisions.map((d) => ({ value: d.id, label: d.name }))}
            />
            <Select
              label="Department"
              required
              value={department}
              placeholder={
                division ? 'Which department' : 'Pick a division first'
              }
              onChange={(e) => setDepartment(e.target.value)}
              options={departments
                .filter((d) => !division || String(d.costCenterId) === division)
                .map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
        )}

        {/* The day the move takes effect. It decides both halves: the old
            spell is closed the day before it, and the new one opens on it. */}
        <DateInput
          label="Takes effect from"
          required
          value={on}
          wrapClassName="sm:max-w-[16rem]"
          onChange={(iso) => {
            setOn(iso);
            // Who is in which team is answered against this day, so a change
            // of day can make a ticked person the wrong person.
            setPicked(new Set());
          }}
        />

        {fromId === '' ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
            Choose the team they are in now.
          </p>
        ) : source.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
            {fromId === 'none'
              ? 'Everybody is already in a team.'
              : 'Nobody is in that team.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      checked={
                        source.length > 0 &&
                        source.every((e) => picked.has(e.id))
                      }
                      onChange={() =>
                        setPicked(
                          source.every((e) => picked.has(e.id))
                            ? new Set()
                            : new Set(source.map((e) => e.id)),
                        )
                      }
                    />
                  </th>
                  <th className="w-24 px-3 py-2">Emp. ID</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Designation</th>
                </tr>
              </thead>
              <tbody>
                {source.map((e) => {
                  const on = picked.has(e.id);
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        'cursor-pointer border-b border-slate-100 last:border-0 dark:border-slate-800/60',
                        on && 'bg-brand-50/70 dark:bg-brand-950/25',
                      )}
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(e.id)) next.add(e.id);
                          return next;
                        })
                      }
                    >
                      <td className="px-3 py-2">
                        <Checkbox checked={on} onChange={() => {}} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {e.code}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                        {e.name}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {e.designationName ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Their old team&apos;s spell closes the day before this one, and the
          new one opens on it — so no day is claimed by two teams, and none by
          neither. Days already marked are not touched: the entry on each of
          those sheets is the record of who answered for them at the time. From
          that day they appear on the new team&apos;s sheet, and are marked
          against that team&apos;s shift.
        </p>
      </div>
    </Drawer>
  );
}
