'use client';

import { Children, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronRight,
  GitBranch,
  Globe2,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PeopleField, type PickedPerson } from '@/components/workplace/people';
import type { Audience, AudienceOptions, AudiencePreview } from '@/lib/types';

/**
 * Choosing who something is for.
 *
 * A circular or a broadcast is aimed at a body of people — a company, a branch,
 * a role — not at a list of names, so this control offers those first and names
 * last. Shared between the two (its endpoints are props) because they ask the
 * same question of the same audiences, and two pickers that drifted apart would
 * mean two answers to "who is Bake House".
 *
 * The choosing happens in a dialog, and only a one-line summary sits on the
 * form. Three companies' branches and roles is a screenful, and inline it
 * pushed the thing actually being written — the notice — below the fold. The
 * audience is also settled once and then left alone, which is exactly the shape
 * a dialog fits: open it, decide, close it, and see the decision in a sentence.
 */
export function AudienceField({
  value,
  onChange,
  label = 'Issued to',
  /** Where the named-people directory comes from, e.g. "/circulars/directory". */
  directoryEndpoint,
  /** Where the count comes from, e.g. "/circulars/audience/preview". */
  previewEndpoint,
  optionsEndpoint,
}: {
  value: Audience;
  onChange: (audience: Audience) => void;
  label?: string;
  directoryEndpoint: string;
  previewEndpoint: string;
  optionsEndpoint: string;
}) {
  const [options, setOptions] = useState<AudienceOptions | null>(null);
  /**
   * The named people, with their names.
   *
   * Held HERE rather than in the dialog, though only the dialog edits them: the
   * audience carries ids alone, so a dialog that owned the names would lose the
   * chips every time it closed and reopen showing "and also, by name" empty
   * beside an audience that still had two people in it.
   */
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<AudienceOptions>(optionsEndpoint)
      .then((o) => alive && setOptions(o))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [optionsEndpoint]);

  // The summary counts what has been SETTLED; the dialog counts its own draft.
  const { preview, counting } = useAudienceCount(value, previewEndpoint);
  const summary = describe(value, people, options);

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </label>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition',
          summary.chosen
            ? 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'
            : 'border-dashed border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60',
        )}
      >
        {value.everyone ? (
          <Globe2 className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
        ) : (
          <Users
            className={cn(
              'h-4 w-4 shrink-0',
              summary.chosen
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-slate-400',
            )}
          />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-sm',
              summary.chosen
                ? 'font-medium text-slate-800 dark:text-slate-100'
                : 'text-slate-400',
            )}
          >
            {summary.line}
          </span>
          {summary.chosen && (
            <span className="block truncate text-xs text-slate-400">
              {counting
                ? 'Working out who that is…'
                : preview
                  ? preview.count === 0
                    ? 'Reaches nobody — open and check the branches and roles'
                    : `Reaches ${preview.count} ${preview.count === 1 ? 'person' : 'people'}${
                        preview.names.length
                          ? ` — ${preview.names.join(', ')}`
                          : ''
                      }${
                        preview.count > preview.names.length
                          ? ` and ${preview.count - preview.names.length} others`
                          : ''
                      }`
                  : ''}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400">
          {summary.chosen ? 'Change' : 'Choose'}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </button>

      {open && (
        <AudienceDialog
          options={options}
          audience={value}
          people={people}
          directoryEndpoint={directoryEndpoint}
          previewEndpoint={previewEndpoint}
          title={label}
          onCancel={() => setOpen(false)}
          onDone={(audience, chosen) => {
            onChange(audience);
            setPeople(chosen);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------- the dialog --

/**
 * The picker itself, over the form.
 *
 * It edits a DRAFT and hands it back only on Done. Choosing an audience means
 * clicking through several companies, and a half-built one written straight to
 * the form would leave "reaches 3 people" sitting under a notice while somebody
 * was still on their way to the fourth branch.
 */
function AudienceDialog({
  options,
  audience,
  people,
  directoryEndpoint,
  previewEndpoint,
  title,
  onCancel,
  onDone,
}: {
  options: AudienceOptions | null;
  audience: Audience;
  people: PickedPerson[];
  directoryEndpoint: string;
  previewEndpoint: string;
  title: string;
  onCancel: () => void;
  onDone: (audience: Audience, people: PickedPerson[]) => void;
}) {
  const [draft, setDraft] = useState<Audience>(audience);
  const [draftPeople, setDraftPeople] = useState<PickedPerson[]>(people);
  const { preview, counting } = useAudienceCount(draft, previewEndpoint);

  // Escape gets you out with nothing changed, like every other dialog here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const patch = (change: Partial<Audience>) =>
    setDraft((d) => ({ ...d, ...change }));

  const everyone = draft.everyone === true;

  const toggle = (key: 'branchIds' | 'userGroupIds', id: number) => {
    const current = draft[key] ?? [];
    patch({
      [key]: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };

  /**
   * Tick or clear one company's whole column.
   *
   * Only that company's ids are touched: "all branches" on Bake House must not
   * quietly take the other two companies' branches with it.
   */
  const toggleAll = (
    key: 'branchIds' | 'userGroupIds',
    ids: number[],
    select: boolean,
  ) => {
    const current = draft[key] ?? [];
    const mine = new Set(ids);
    patch({
      [key]: select
        ? [...new Set([...current, ...ids])]
        : current.filter((x) => !mine.has(x)),
    });
  };

  const setPickedPeople = (chosen: PickedPerson[]) => {
    setDraftPeople(chosen);
    patch({ userIds: chosen.map((p) => p.id) });
  };

  const branchesByCompany = useMemo(
    () => groupBy(options?.branches ?? []),
    [options],
  );
  const groupsByCompany = useMemo(
    () => groupBy(options?.groups ?? []),
    [options],
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Pick <span className="font-medium">branches</span> and{' '}
              <span className="font-medium">roles</span> under a company — it
              goes to whoever is in one of those branches and holds one of those
              roles. All branches and all roles is the whole company.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <button
            type="button"
            onClick={() => {
              // Either way the named people go with it — leaving their chips on
              // screen beside an audience that no longer carries them would say
              // something untrue about who is getting it.
              setDraftPeople([]);
              setDraft(everyone ? {} : { everyone: true });
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition',
              everyone
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/50'
                : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60',
            )}
          >
            <Globe2
              className={cn(
                'h-4 w-4 shrink-0',
                everyone
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-slate-400',
              )}
            />
            <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">
              Everyone in the group
            </span>
            <span className="text-xs text-slate-400">
              {options ? `${options.everyoneCount} people` : '…'}
            </span>
          </button>

          {!everyone && (
            <div className="space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              {!options && (
                <p className="py-6 text-center text-xs text-slate-400">
                  Loading audiences…
                </p>
              )}

              {options && options.companies.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-400">
                  You are not in a company yet, so there is nobody to send to.
                </p>
              )}

              {options?.companies.map((company) => {
                const branches = branchesByCompany.get(company.id) ?? [];
                const groups = groupsByCompany.get(company.id) ?? [];
                // Half a rule reaches nobody, so say which half is missing
                // rather than leaving somebody to work it out from a count of
                // zero. A company with no branches at all asks for none.
                const someBranch = branches.some((b) =>
                  (draft.branchIds ?? []).includes(b.id),
                );
                const someRole = groups.some((g) =>
                  (draft.userGroupIds ?? []).includes(g.id),
                );
                const missing =
                  !someBranch && !someRole
                    ? null
                    : branches.length > 0 && !someBranch
                      ? 'Pick a branch as well, or this company gets nothing.'
                      : !someRole
                        ? 'Pick a role as well, or this company gets nothing.'
                        : null;
                return (
                  <div key={company.id} className="space-y-1.5">
                    {/* A heading, not a choice: a company is reached by picking
                        everything under it, which is what "the whole company"
                        is. */}
                    <div className="flex items-center gap-2 px-1.5">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {company.name}
                      </span>
                      {missing && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          {missing}
                        </span>
                      )}
                    </div>
                    {/* Branches down one column, roles down the other. They are
                        two different questions — WHERE somebody works and WHAT
                        they do — and one list alternating between them reads as
                        a single muddled one. */}
                    {(branches.length > 0 || groups.length > 0) && (
                      <div className="ml-5 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                        <Column
                          heading="Branches"
                          empty="No branches"
                          all={branches.map((b) => b.id)}
                          chosen={draft.branchIds ?? []}
                          onAll={(select) =>
                            toggleAll(
                              'branchIds',
                              branches.map((b) => b.id),
                              select,
                            )
                          }
                        >
                          {branches.map((b) => (
                            <Choice
                              key={b.id}
                              icon={<GitBranch className="h-3.5 w-3.5" />}
                              label={b.name}
                              checked={(draft.branchIds ?? []).includes(b.id)}
                              onToggle={() => toggle('branchIds', b.id)}
                            />
                          ))}
                        </Column>
                        <Column
                          heading="Roles"
                          empty="No user groups"
                          all={groups.map((g) => g.id)}
                          chosen={draft.userGroupIds ?? []}
                          onAll={(select) =>
                            toggleAll(
                              'userGroupIds',
                              groups.map((g) => g.id),
                              select,
                            )
                          }
                        >
                          {groups.map((g) => (
                            <Choice
                              key={g.id}
                              icon={<Users className="h-3.5 w-3.5" />}
                              label={g.name}
                              checked={(draft.userGroupIds ?? []).includes(
                                g.id,
                              )}
                              onToggle={() => toggle('userGroupIds', g.id)}
                            />
                          ))}
                        </Column>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!everyone && (
            <PeopleField
              label="And also, by name"
              endpoint={directoryEndpoint}
              chosen={draftPeople}
              onChange={setPickedPeople}
              placeholder="Anybody else who should get it…"
            />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
            {counting && 'Working out who that is…'}
            {!counting && !preview && 'Nobody chosen yet.'}
            {!counting && preview && preview.count === 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                That reaches nobody — a branch and a role are both needed.
              </span>
            )}
            {!counting && preview && preview.count > 0 && (
              <>
                Reaches{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {preview.count} {preview.count === 1 ? 'person' : 'people'}
                </span>
                {preview.names.length > 0 && (
                  <>
                    {' — '}
                    {preview.names.join(', ')}
                    {preview.count > preview.names.length &&
                      ` and ${preview.count - preview.names.length} others`}
                  </>
                )}
              </>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onDone(draft, draftPeople)}
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- the count --

/**
 * What an audience comes to, asked of the server once the clicking pauses.
 *
 * Anything less than a real count would be a guess, and a guess is what this
 * exists to replace: "all of Regency Bakers" is an abstraction, and nobody
 * should find out it meant 240 people by sending to them.
 */
function useAudienceCount(audience: Audience, endpoint: string) {
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [counting, setCounting] = useState(false);

  const chosen =
    audience.everyone === true ||
    (audience.branchIds?.length ?? 0) +
      (audience.userGroupIds?.length ?? 0) +
      (audience.userIds?.length ?? 0) >
      0;

  const key = JSON.stringify(audience);
  const seq = useRef(0);
  useEffect(() => {
    if (!chosen) {
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    setCounting(true);
    const t = setTimeout(() => {
      api
        .post<AudiencePreview>(endpoint, {
          audience: JSON.parse(key) as Audience,
        })
        .then((p) => {
          // A slower earlier request must not overwrite a later answer.
          if (mine === seq.current) setPreview(p);
        })
        .catch(() => {
          if (mine === seq.current) setPreview(null);
        })
        .finally(() => {
          if (mine === seq.current) setCounting(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [key, chosen, endpoint]);

  return { preview, counting };
}

// ------------------------------------------------------------- the summary --

/**
 * The chosen audience in one line — what the form shows instead of the picker.
 *
 * Named by company, because that is how it was chosen: "EK Bake House — 2
 * branches, 1 role" is checkable at a glance, where a list of every branch and
 * role would be the picker again, only harder to read.
 */
function describe(
  audience: Audience,
  people: PickedPerson[],
  options: AudienceOptions | null,
): { line: string; chosen: boolean } {
  if (audience.everyone) {
    return { line: 'Everyone in the group', chosen: true };
  }

  const branchIds = new Set(audience.branchIds ?? []);
  const roleIds = new Set(audience.userGroupIds ?? []);
  const named = audience.userIds?.length ?? 0;

  if (branchIds.size === 0 && roleIds.size === 0 && named === 0) {
    return { line: 'Nobody yet — choose branches and roles', chosen: false };
  }

  // Before the options arrive there are no company names to group by, but there
  // IS an audience — say what it holds rather than "nobody yet", which would be
  // a summary contradicting the form it summarises.
  if (!options) {
    const counted = [
      branchIds.size ? plural(branchIds.size, 'branch', 'branches') : '',
      roleIds.size ? plural(roleIds.size, 'role', 'roles') : '',
      named ? `${named} by name` : '',
    ].filter(Boolean);
    return { line: counted.join(', '), chosen: true };
  }

  const parts: string[] = [];
  for (const company of options?.companies ?? []) {
    const branches = (options?.branches ?? []).filter(
      (b) => b.companyId === company.id && branchIds.has(b.id),
    ).length;
    const roles = (options?.groups ?? []).filter(
      (g) => g.companyId === company.id && roleIds.has(g.id),
    ).length;
    if (branches === 0 && roles === 0) continue;
    parts.push(
      `${company.name} — ${plural(branches, 'branch', 'branches')}, ${plural(
        roles,
        'role',
        'roles',
      )}`,
    );
  }
  if (named > 0) {
    parts.push(
      people.length === named && named <= 2
        ? people.map((p) => p.name).join(', ')
        : `${named} by name`,
    );
  }

  return {
    line: parts.length
      ? parts.join(' · ')
      : 'Nobody yet — choose branches and roles',
    chosen: parts.length > 0,
  };
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function groupBy<T extends { companyId: number }>(list: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of list) {
    const found = map.get(item.companyId) ?? [];
    found.push(item);
    map.set(item.companyId, found);
  }
  return map;
}

// -------------------------------------------------------------- the pieces --

/**
 * One column of a company's audiences, under its own heading.
 *
 * The heading stays even when the column is empty, and says so: an absent
 * "Roles" column would leave the branches spread across the full width and the
 * two companies below it lining up differently, which reads as a rendering
 * fault rather than as "this company has no groups yet".
 */
function Column({
  heading,
  empty,
  all,
  chosen,
  onAll,
  children,
}: {
  heading: string;
  empty: string;
  /** Every id in this column, for the All / None toggle. */
  all: number[];
  /** The ids currently ticked anywhere in the form, of this kind. */
  chosen: number[];
  onAll: (select: boolean) => void;
  children: React.ReactNode;
}) {
  const items = Children.toArray(children);
  const mine = new Set(chosen);
  // "All" only when every one of THIS column's is ticked — other companies'
  // choices are none of this button's business.
  const allChosen = all.length > 0 && all.every((id) => mine.has(id));

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 px-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {heading}
        </h4>
        {all.length > 1 && (
          <button
            type="button"
            onClick={() => onAll(!allChosen)}
            className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {allChosen ? 'Clear' : 'Select all'}
          </button>
        )}
      </div>
      {items.length > 0 ? (
        items
      ) : (
        <p className="px-1.5 py-1 text-xs italic text-slate-300 dark:text-slate-600">
          {empty}
        </p>
      )}
    </div>
  );
}

/** One tickable audience. */
function Choice({
  icon,
  label,
  checked,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm transition',
        checked
          ? 'text-brand-700 dark:text-brand-300'
          : 'text-slate-600 dark:text-slate-300',
        'hover:bg-slate-50 dark:hover:bg-slate-800/60',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
      />
      <span className={checked ? 'text-brand-500' : 'text-slate-400'}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </label>
  );
}
