'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  RotateCcw,
  Save,
  Send,
  Check,
  X,
  Ban,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn, formatDateTime, formatDayMonthYear } from '@/lib/utils';
import { useFetch, useLookupValues, useUnsavedChangesGuard } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { DateInput, Input, Select, Textarea } from '@/components/ui/Field';
import { WorkflowStallNotice } from '@/components/workflow/StallNotice';
import type {
  AttendanceRow,
  AttendanceSheet,
  AttendanceSheetStatus,
  AttendanceTeamsOfDay,
} from '@/lib/types';

const ROUTE = '/hr/attendance';

/** Minutes after midnight ↔ the "HH:mm" a time field speaks. */
const toTime = (m: number | null) =>
  m === null || m === undefined
    ? ''
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
/** 480 → "8h 00m" — hours are what a wage is worked out from. */
const hours = (m: number | null) =>
  m === null || m === undefined
    ? '—'
    : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<AttendanceSheetStatus, string> = {
  DRAFT: 'blue',
  SUBMITTED: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'slate',
};

/** The line as the screen holds it while it is being edited. */
interface Draft {
  typeId: number | null;
  timeIn: number | null;
  timeOut: number | null;
  remarks: string;
}

/**
 * The attendance sheet — one branch, one day (SRS §8.9, FR-HRP-02).
 *
 * It opens FILLED IN: the working day the branch keeps, or the weekly off, or
 * the holiday. The incharge's job is the exceptions — the three people who were
 * late, the one who did not come — and a screen that opened blank would be
 * asking them to type a hundred identical lines to record that nothing
 * happened. What they change is flagged as it is changed, so the verifier reads
 * the exceptions rather than hunting for them.
 *
 * Marked, then verified, then approved. Who does each is configured in
 * Cpanel → Workflows against this screen rather than written in here, which is
 * why there is no "verifier" anywhere in this file: the buttons are labelled
 * with whatever the configured step calls itself.
 */
export default function AttendancePage() {
  const { can, activeBranchId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [date, setDate] = useState(today());
  /**
   * Whose sheet is open — a team, or null for the branch's own (everybody in
   * no team). Undefined until the day's teams have been read, so the screen
   * can open on the ONE the viewer actually marks rather than guessing.
   */
  const [teamId, setTeamId] = useState<number | null | undefined>(undefined);
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState('');

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [dayRemarks, setDayRemarks] = useState('');
  const [baseline, setBaseline] = useState('');

  const types = useLookupValues('ATTENDANCE_TYPE');
  const typeOptions = useMemo(
    () => types.map((t) => ({ value: t.id, label: t.label })),
    [types],
  );

  /** Pull the day, and take what came back as the clean state. */
  const load = useCallback(
    async (on: string, team: number | null) => {
      setLoading(true);
      try {
        const data = await api.get<AttendanceSheet>(
          `/hr-attendance/sheet?date=${on}${team ? `&teamId=${team}` : ''}`,
        );
        setSheet(data);
        const next: Record<number, Draft> = {};
        for (const r of data.rows) {
          next[r.employeeId] = {
            typeId: r.typeId,
            timeIn: r.timeIn,
            timeOut: r.timeOut,
            remarks: r.remarks ?? '',
          };
        }
        setDrafts(next);
        setDayRemarks(data.remarks ?? '');
        setBaseline(JSON.stringify({ next, remarks: data.remarks ?? '' }));
        setComment('');
      } catch {
        toast.error('Could not open that day.');
        setSheet(null);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * The day's teams at this branch — one sheet each, plus the branch's own.
   *
   * Read before the sheet, because WHICH sheet to open is decided from it: a
   * leader lands on their own team, and everybody else on the first one.
   */
  const { data: teams, refetch: refetchTeams } = useFetch<AttendanceTeamsOfDay>(
    `/hr-attendance/teams?date=${date}`,
    [date, activeBranchId],
  );

  // Picking the sheet to open. Only until the viewer picks one themselves —
  // after that their choice stands, even as the day or the branch changes.
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    setPicked(false);
    setTeamId(undefined);
  }, [activeBranchId]);
  useEffect(() => {
    if (picked || !teams) return;
    const lines = teams.sheets;
    if (!lines.length) {
      setTeamId(null);
      return;
    }
    setTeamId(lines[0].teamId);
  }, [teams, picked]);

  // Re-read on the day, the team, and whenever the active branch changes — a
  // sheet belongs to a branch and a team, and the header decides the branch.
  useEffect(() => {
    if (teamId === undefined) return;
    void load(date, teamId);
  }, [date, teamId, activeBranchId, load]);

  const dirty =
    baseline !== '' &&
    JSON.stringify({ next: drafts, remarks: dayRemarks }) !== baseline;
  useUnsavedChangesGuard(() => dirty);

  const setDraft = (employeeId: number, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [employeeId]: { ...d[employeeId], ...patch } }));

  /**
   * Whether a line differs from what the day was filled in with.
   *
   * Worked out here as well as on the server, so the flag appears the moment
   * somebody types rather than after they save. The server's answer is the one
   * that is stored — a browser must not be able to call a changed line routine.
   */
  const differs = useCallback(
    (row: AttendanceRow, draft?: Draft) => {
      const d = draft ?? drafts[row.employeeId];
      if (!d) return false;
      return (
        d.typeId !== row.expectedTypeId ||
        d.timeIn !== row.expectedTimeIn ||
        d.timeOut !== row.expectedTimeOut
      );
    },
    [drafts],
  );

  const changed = useMemo(
    () => (sheet?.rows ?? []).filter((r) => differs(r)).length,
    [sheet, differs],
  );

  const resetRow = (row: AttendanceRow) =>
    setDraft(row.employeeId, {
      typeId: row.expectedTypeId,
      timeIn: row.expectedTimeIn,
      timeOut: row.expectedTimeOut,
      remarks: '',
    });

  const resetAll = async () => {
    if (
      !(await confirm({
        title: 'Put the day back',
        message:
          'Every line goes back to what the branch normally works, and the exceptions marked today are cleared. Nothing is saved until you save.',
        confirmText: 'Put it back',
      }))
    ) {
      return;
    }
    const next: Record<number, Draft> = {};
    for (const r of sheet?.rows ?? []) {
      next[r.employeeId] = {
        typeId: r.expectedTypeId,
        timeIn: r.expectedTimeIn,
        timeOut: r.expectedTimeOut,
        remarks: '',
      };
    }
    setDrafts(next);
  };

  const save = async () => {
    if (!sheet) return;
    setSaving(true);
    try {
      const data = await api.post<AttendanceSheet>('/hr-attendance/sheet', {
        date: sheet.date,
        teamId: sheet.teamId,
        remarks: dayRemarks || null,
        entries: sheet.rows.map((r) => {
          const d = drafts[r.employeeId];
          return {
            employeeId: r.employeeId,
            typeId: d.typeId,
            timeIn: d.timeIn,
            timeOut: d.timeOut,
            remarks: d.remarks || null,
          };
        }),
      });
      setSheet(data);
      const next: Record<number, Draft> = {};
      for (const r of data.rows) {
        next[r.employeeId] = {
          typeId: r.typeId,
          timeIn: r.timeIn,
          timeOut: r.timeOut,
          remarks: r.remarks ?? '',
        };
      }
      setDrafts(next);
      setBaseline(JSON.stringify({ next, remarks: data.remarks ?? '' }));
      toast.success('Attendance marked.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!sheet) return;
    if (dirty) {
      toast.error('Save the day before sending it on.');
      return;
    }
    setActing(true);
    try {
      const data = await api.post<AttendanceSheet>(
        '/hr-attendance/sheet/submit',
        { date: sheet.date, teamId: sheet.teamId },
      );
      setSheet(data);
      refetchTeams();
      toast.success('Sent for approval.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send.');
    } finally {
      setActing(false);
    }
  };

  const act = async (
    action: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL',
    label: string,
  ) => {
    if (!sheet) return;
    setActing(true);
    try {
      const data = await api.post<AttendanceSheet>('/hr-attendance/sheet/act', {
        date: sheet.date,
        teamId: sheet.teamId,
        action,
        comment: comment || undefined,
      });
      setSheet(data);
      setComment('');
      toast.success(`${label} done.`);
      refetchTeams();
      await load(sheet.date, sheet.teamId);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'That did not go through.',
      );
    } finally {
      setActing(false);
    }
  };

  const canEditRows = !!sheet?.canMark && can(ROUTE, 'edit');
  const task = sheet?.workflow?.myTask ?? null;
  const timeline = sheet?.workflow?.timeline ?? [];

  /** What kind of day this is, said in one line above the sheet. */
  const dayNote = !sheet
    ? ''
    : sheet.holidayName
      ? `Holiday — ${sheet.holidayName}. Nobody is due in; anybody who worked is an exception.`
      : sheet.weeklyOff
        ? 'Weekly off for this branch. Nobody is due in; anybody who worked is an exception.'
        : `Working day ${toTime(sheet.defaults.timeIn)} – ${toTime(sheet.defaults.timeOut)}, from the ${sheet.defaults.fromBranch ? 'branch' : 'company'} default. Mark only what differs.`;

  return (
    <div className="mx-auto flex h-full max-w-[110rem] flex-col">
      <PageHeader
        title="Attendance"
        description="One branch, one day — opened filled in, so only the exceptions are marked"
        icon={<CalendarCheck className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEditRows && (
              <>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={resetAll}
                  disabled={saving || !sheet?.rows.length}
                >
                  <RotateCcw className="h-4 w-4" /> Put the day back
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={save}
                  disabled={saving || !dirty || !sheet?.rows.length}
                  title={
                    !dirty
                      ? 'Nothing has changed since the last save'
                      : undefined
                  }
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            {sheet?.sheetId &&
              (sheet.status === 'DRAFT' || sheet.status === 'REJECTED') &&
              can(ROUTE, 'edit') && (
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  onClick={submit}
                  disabled={acting || dirty}
                  title={dirty ? 'Save the day first' : undefined}
                >
                  <Send className="h-4 w-4" />
                  {sheet.firstStep?.buttonText ?? 'Send for approval'}
                </button>
              )}
          </div>
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* The day, and what kind of day it is. */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <DateInput
            label="Date"
            wrapClassName="w-44"
            value={date}
            onChange={(iso) => iso && setDate(iso)}
          />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {formatDayMonthYear(date)}
              {sheet?.teamName && (
                <span className="text-slate-500 dark:text-slate-400">
                  · {sheet.teamName}
                </span>
              )}
              {sheet && (
                <Badge color={STATUS_TONE[sheet.status] as 'blue'}>
                  {sheet.workflowStatus ??
                    sheet.status.charAt(0) +
                      sheet.status.slice(1).toLowerCase()}
                </Badge>
              )}
              {sheet?.marksAsLeader && (
                <Badge color="violet">You lead this team</Badge>
              )}
              {sheet?.markedAt && (
                <span className="text-xs font-normal text-slate-400">
                  marked {formatDateTime(sheet.markedAt)}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {dayNote}
            </p>
          </div>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {sheet?.rows.length ?? 0} on the sheet
            {changed > 0 && (
              <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
                · {changed} changed
              </span>
            )}
          </span>
        </div>

        {/* The day's sheets — one per team, plus the branch's own for anybody
            in no team. Each is a document of its own, marked and submitted by
            its leader, so this strip is both the picker and the answer to
            "which teams are still to mark". Hidden where a branch keeps no
            teams: one tab is not a choice. */}
        {(teams?.sheets.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            {teams!.sheets.map((t) => {
              const here = t.teamId === sheet?.teamId;
              return (
                <button
                  key={t.teamId ?? 'none'}
                  type="button"
                  onClick={() => {
                    setPicked(true);
                    setTeamId(t.teamId);
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-left text-sm transition',
                    here
                      ? 'border-brand-600 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40'
                      : 'border-slate-200 bg-white hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {t.teamName}
                    </span>
                    {t.status ? (
                      <Badge color={STATUS_TONE[t.status] as 'blue'}>
                        {t.workflowStatus ??
                          t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                      </Badge>
                    ) : (
                      <Badge color="slate">Not marked</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {t.headcount} {t.headcount === 1 ? 'person' : 'people'}
                    {t.leaderName && ` · ${t.leaderName}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="p-6 text-sm text-slate-400">Opening the day…</p>
          ) : !sheet?.rows.length ? (
            <p className="p-6 text-sm text-slate-400">
              {sheet?.teamName
                ? `Nobody is in ${sheet.teamName} on this day. People are put into a team in HR → Team Master.`
                : 'Nobody is posted to this branch on this day. Employees appear here from the day they join until their last working day.'}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                <tr>
                  <th className="w-12 px-3 py-2.5">Sl</th>
                  <th className="w-24 px-3 py-2.5">Emp. ID</th>
                  <th className="px-3 py-2.5">Employee</th>
                  <th className="px-3 py-2.5">Designation</th>
                  <th className="w-44 px-3 py-2.5">Attendance</th>
                  <th className="w-28 px-3 py-2.5">Time In</th>
                  <th className="w-28 px-3 py-2.5">Time Out</th>
                  <th className="w-24 px-3 py-2.5 text-right">Hours</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r, i) => {
                  const d = drafts[r.employeeId];
                  if (!d) return null;
                  const off = differs(r, d);
                  const worked =
                    d.timeIn !== null && d.timeOut !== null
                      ? d.timeOut > d.timeIn
                        ? d.timeOut - d.timeIn
                        : d.timeOut + 1440 - d.timeIn
                      : null;
                  return (
                    <tr
                      key={r.employeeId}
                      className={cn(
                        'border-b border-slate-100 last:border-0 dark:border-slate-800/60',
                        // The whole point of the defaults is that only the
                        // exceptions are touched — so the exceptions are the
                        // thing a verifier's eye should land on.
                        off && 'bg-amber-50/70 dark:bg-amber-950/20',
                      )}
                    >
                      <td className="px-3 py-2 tabular-nums text-slate-400">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {r.employeeCode}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                        {r.employeeName}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {r.designationName}
                        {/* Where the pre-filled times came from, when they came
                            from a roster rather than the branch's own day. */}
                        {r.shiftCode && (
                          <span
                            className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            title={`Rostered on ${r.shiftName}`}
                          >
                            {r.shiftCode}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={d.typeId ?? ''}
                          disabled={!canEditRows}
                          sortOptions={false}
                          onChange={(e) =>
                            setDraft(r.employeeId, {
                              typeId: Number(e.target.value) || null,
                            })
                          }
                          options={typeOptions}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="time"
                          className="input-base"
                          disabled={!canEditRows}
                          value={toTime(d.timeIn)}
                          onChange={(e) =>
                            setDraft(r.employeeId, {
                              timeIn: e.target.value
                                ? toMinutes(e.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="time"
                          className="input-base"
                          disabled={!canEditRows}
                          value={toTime(d.timeOut)}
                          onChange={(e) =>
                            setDraft(r.employeeId, {
                              timeOut: e.target.value
                                ? toMinutes(e.target.value)
                                : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {hours(worked)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={d.remarks}
                          disabled={!canEditRows}
                          placeholder={off ? 'Why?' : ''}
                          onChange={(e) =>
                            setDraft(r.employeeId, { remarks: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {canEditRows && off && (
                          <button
                            type="button"
                            title="Put this line back to the branch's normal day"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                            onClick={() => resetRow(r)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
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

        {/* About the day as a whole — a power cut, a strike, a festival rush. */}
        {sheet && (
          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <Textarea
              label="Remarks for the day"
              rows={2}
              value={dayRemarks}
              disabled={!canEditRows}
              onChange={(e) => setDayRemarks(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Where it has got to, and what this viewer may do about it. */}
      {sheet?.workflow?.stalled && (
        <WorkflowStallNotice
          className="mt-4"
          sequence={sheet.workflow.currentSequence}
        />
      )}

      {(task || timeline.length > 0) && (
        <div className="card mt-4 p-4">
          {task && (
            <div className="mb-4 space-y-3">
              <Textarea
                label="Comment"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional — what you are signing off on, or what needs putting right."
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={acting}
                  onClick={() =>
                    act(
                      task.canApprove ? 'APPROVE' : 'FORWARD',
                      task.buttonText,
                    )
                  }
                >
                  <Check className="h-4 w-4" /> {task.buttonText}
                </button>
                {task.canReject && (
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                    disabled={acting}
                    onClick={() => act('REJECT', 'Sent back')}
                  >
                    <X className="h-4 w-4" /> Send back
                  </button>
                )}
                {task.canCancel && (
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2"
                    disabled={acting}
                    onClick={() => act('CANCEL', 'Withdrawn')}
                  >
                    <Ban className="h-4 w-4" /> Withdraw
                  </button>
                )}
              </div>
            </div>
          )}

          {timeline.length > 0 && (
            <>
              <p className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
                Approval trail
              </p>
              <ol className="mt-3 space-y-3">
                {timeline.map((t) => (
                  <li key={t.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {t.action}
                      </span>
                      <span className="ml-2 text-slate-500 dark:text-slate-400">
                        {t.userName} · {formatDateTime(t.createdAt)}
                      </span>
                      {t.comment && (
                        <p className="text-slate-500 dark:text-slate-400">
                          {t.comment}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
