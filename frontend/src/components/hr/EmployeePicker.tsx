'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox, DateInput, Select } from '@/components/ui/Field';
import type { Employee } from '@/lib/types';

/** Sentinels for an open-ended period, so ISO strings can just be compared. */
const FOREVER_AGO = '0001-01-01';
const FOREVER = '9999-12-31';

/**
 * What the people chosen here are being put ON — the terms of the placement,
 * not facts about the people.
 */
export interface PickedPlacement {
  effectiveFrom: string;
  /** Null = no end. */
  effectiveTo: string | null;
  /** Division — a cost centre. Null = none said. */
  costCenterId: number | null;
  /** Department — the cost object under that division. */
  costObjectId: number | null;
}

/**
 * Choosing people from a list, in a window over whatever opened it.
 *
 * A dropdown is the wrong shape for this: putting a dozen people in a team
 * means reading names, codes and designations side by side and ticking down the
 * list, and a dropdown shows one line at a time through a keyhole.
 *
 * The division, department and dates at the top are TERMS OF THE PLACEMENT
 * applied to everybody ticked — not filters, and not read off anybody's
 * employee record. Twelve people joining the Bakery Team on Operations · Bakery
 * from the 1st is one statement, and making it twelve times is how it stops
 * being made.
 *
 * Adding does NOT close the window, and whoever was added drops out of the
 * list. Two batches on different terms — the early shift from the 1st, the late
 * one from the 15th — is the ordinary case, and a window that shut after the
 * first would make the second a fresh hunt through the same names. What is left
 * on screen is always exactly what is still to do.
 *
 * It sits at z-55 — above the drawer (z-50) that opens it, and below the
 * combobox menus (z-60) its own dropdowns open, since a dropdown whose list
 * opens underneath the window it belongs to is a dropdown nobody can use.
 */
export function EmployeePicker({
  open,
  onClose,
  onConfirm,
  employees,
  exclude,
  engagedElsewhere,
  title = 'Choose people',
  subtitle,
  emptyText = 'Nobody is available to choose.',
  askPeriod = false,
  askPlace = false,
  defaultPlacement,
  placementHint,
  divisions,
  departments,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the people ticked THIS time. The window stays open. */
  onConfirm: (ids: number[], placement: PickedPlacement) => void;
  /** The people who MAY be chosen — the caller has already filtered them. */
  employees: Employee[];
  /**
   * Who is already in, and so is never listed: adding somebody twice is not a
   * thing anybody means to do, and a list that still offers them is a list you
   * have to remember your way through.
   */
  exclude?: number[];
  /**
   * Spells somebody is already committed to elsewhere. Anybody whose spell
   * overlaps the window's own From/Until is not listed at all — they cannot be
   * taken on for those days, so offering them would only earn a refusal.
   *
   * Overlapping rather than "in another team at all", because these are DATED:
   * somebody whose spell ended in March is free from April, and the list says
   * so as soon as the dates above say April.
   */
  engagedElsewhere?: {
    employeeId: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
  title?: string;
  subtitle?: string;
  emptyText?: string;
  /** Whether the window asks from when until when. */
  askPeriod?: boolean;
  /** Whether it asks which division and department the work sits under. */
  askPlace?: boolean;
  /** What those answers start on — today and nothing else, usually. */
  defaultPlacement?: PickedPlacement;
  /** One line under them, saying what they mean here. */
  placementHint?: string;
  /**
   * The company's divisions, and the departments under them — every one it
   * keeps, since these are being CHOSEN rather than matched, and a list that
   * offered only the ones somebody is already in could not express a move.
   */
  divisions?: { id: number; name: string }[];
  departments?: { id: number; name: string; costCenterId: number }[];
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');

  // Re-seeded each time it opens, so an abandoned pick does not linger into
  // the next one.
  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setSearch('');
    setDivision(
      defaultPlacement?.costCenterId
        ? String(defaultPlacement.costCenterId)
        : '',
    );
    setDepartment(
      defaultPlacement?.costObjectId
        ? String(defaultPlacement.costObjectId)
        : '',
    );
    setFrom(defaultPlacement?.effectiveFrom ?? '');
    setUntil(defaultPlacement?.effectiveTo ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const divisionOptions = useMemo(
    () =>
      (divisions ?? []).map((d) => ({ value: String(d.id), label: d.name })),
    [divisions],
  );

  // A department belongs to a division, so choosing one narrows the other.
  const departmentOptions = useMemo(
    () =>
      (departments ?? [])
        .filter((d) => !division || String(d.costCenterId) === division)
        .map((d) => ({ value: String(d.id), label: d.name })),
    [departments, division],
  );

  /**
   * Who is not free for the days this window is about.
   *
   * While the From date is still half-typed the window covers all of time, so
   * anybody committed anywhere is held back — the cautious answer, and it opens
   * up the moment the dates say something.
   */
  const unavailable = useMemo(() => {
    const start = from || FOREVER_AGO;
    const end = until || FOREVER;
    const busy = new Set<number>();
    for (const spell of engagedElsewhere ?? []) {
      if (spell.effectiveFrom <= end && start <= (spell.effectiveTo ?? FOREVER))
        busy.add(spell.employeeId);
    }
    return busy;
  }, [engagedElsewhere, from, until]);

  const already = useMemo(() => new Set(exclude ?? []), [exclude]);

  // A tick survives a search — the point of ticking down a filtered list — but
  // not the person leaving the list altogether. Changing the From date can
  // make somebody unavailable while they are still ticked, and "3 chosen" that
  // means two is worse than no count at all.
  useEffect(() => {
    setPicked((prev) => {
      const next = new Set(
        [...prev].filter((id) => !already.has(id) && !unavailable.has(id)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [already, unavailable]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (already.has(e.id) || unavailable.has(e.id)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q) ||
        (e.designationName ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, search, already, unavailable]);

  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.id));

  /**
   * What still has to be answered before anybody can be added, in one line.
   *
   * Said up front rather than on the way back: these are the terms, and the
   * ticking below them is only worth doing once they are settled.
   */
  const wanting = [
    ...(askPlace && !division ? ['a division'] : []),
    ...(askPlace && !department ? ['a department'] : []),
    ...(askPeriod && !from ? ['the day they join'] : []),
  ];
  const missing = wanting.length
    ? `Say ${wanting.join(', ').replace(/, ([^,]*)$/, ' and $1')} first.`
    : null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          {/* The terms first: they are what the ticking is FOR, and reading
              them after choosing is reading them too late. */}
          {askPlace && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Division"
                required
                value={division}
                placeholder="Which division's work"
                onChange={(e) => {
                  setDivision(e.target.value);
                  // The department belonged to the old division; keeping it
                  // would pair two that do not go together.
                  setDepartment('');
                }}
                options={divisionOptions}
              />
              <Select
                label="Department"
                required
                value={department}
                placeholder={
                  division ? 'Which department' : 'Pick a division first'
                }
                onChange={(e) => setDepartment(e.target.value)}
                options={departmentOptions}
              />
            </div>
          )}

          {askPeriod && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DateInput
                label="From"
                required
                value={from}
                onChange={setFrom}
              />
              <DateInput
                label="Until"
                value={until}
                placeholder="No end"
                onChange={setUntil}
              />
            </div>
          )}

          {missing ? (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {missing}
            </p>
          ) : (
            (askPlace || askPeriod) &&
            placementHint && (
              <p className="text-xs text-slate-400">{placementHint}</p>
            )
          )}

          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                autoFocus
                className="input-base pl-9"
                value={search}
                placeholder="Name, code or designation"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <span className="whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
              {picked.size} chosen
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {shown.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">
              {search ? 'Nobody matches that.' : emptyText}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox
                      checked={allShown}
                      // Everything SHOWN, added to or taken off what is
                      // already ticked: a searched "all" that silently dropped
                      // the rest would be a trap.
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          for (const e of shown) {
                            if (allShown) next.delete(e.id);
                            else next.add(e.id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                  <th className="w-28 px-3 py-2.5">Emp. ID</th>
                  <th className="px-3 py-2.5">Employee</th>
                  <th className="px-3 py-2.5">Designation</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const on = picked.has(e.id);
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        'cursor-pointer border-b border-slate-100 last:border-0 dark:border-slate-800/60',
                        on
                          ? 'bg-brand-50/70 dark:bg-brand-950/25'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                      )}
                      // The whole row is the target: ticking a dozen people
                      // should not mean hitting a dozen small boxes.
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(e.id)) next.add(e.id);
                          return next;
                        })
                      }
                    >
                      <td className="px-4 py-2">
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
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          {/* Done, not Cancel: each Add has already been applied, so there is
              nothing left here to take back. */}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Done
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            // Refused, not warned about afterwards: people put in from no day
            // at all would be on nobody's sheet, and with no division or
            // department the team could not say what it had them doing. The
            // hint below spells out what is still missing.
            disabled={picked.size === 0 || !!missing}
            title={missing ?? undefined}
            onClick={() => {
              onConfirm([...picked], {
                effectiveFrom: from,
                effectiveTo: until || null,
                costCenterId: division ? Number(division) : null,
                costObjectId: department ? Number(department) : null,
              });
              // Cleared, not closed: those people leave the list on the next
              // render, and the terms stay put for the batch after this one.
              setPicked(new Set());
            }}
          >
            <Check className="h-4 w-4" />
            Add {picked.size > 0 && `(${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
