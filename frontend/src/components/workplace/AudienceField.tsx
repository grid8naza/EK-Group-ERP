'use client';

import { Children, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, GitBranch, Globe2, Users } from 'lucide-react';
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
 * The count under it is the honest part: "all of Regency Bakers" is an
 * abstraction, and nobody should find out it meant 240 people by sending to
 * them. It is answered by the server, because who an audience reaches is a rule
 * about company membership rather than something a form can add up.
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
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [counting, setCounting] = useState(false);

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

  // The chips are the picker's own state; the ids go out with the audience.
  const patch = (change: Partial<Audience>) =>
    onChange({ ...value, ...change });

  const setPickedPeople = (chosen: PickedPerson[]) => {
    setPeople(chosen);
    patch({ userIds: chosen.map((p) => p.id) });
  };

  const everyone = value.everyone === true;

  const toggle = (key: 'branchIds' | 'userGroupIds', id: number) => {
    const current = value[key] ?? [];
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
   * quietly take the other two companies' branches with it, and the same button
   * on each company is how somebody builds "both factories, every branch"
   * without being offered a single tick that means something bigger than they
   * looked at.
   */
  const toggleAll = (
    key: 'branchIds' | 'userGroupIds',
    ids: number[],
    select: boolean,
  ) => {
    const current = value[key] ?? [];
    const mine = new Set(ids);
    patch({
      [key]: select
        ? [...new Set([...current, ...ids])]
        : current.filter((x) => !mine.has(x)),
    });
  };

  const chosenCount =
    (value.branchIds?.length ?? 0) +
    (value.userGroupIds?.length ?? 0) +
    (value.userIds?.length ?? 0);

  // Ask the server what it comes to, once the clicking pauses. Anything less
  // than a real count would be a guess, and a guess is what this line exists to
  // replace.
  const key = JSON.stringify(value);
  const seq = useRef(0);
  useEffect(() => {
    if (!everyone && chosenCount === 0) {
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    setCounting(true);
    const t = setTimeout(() => {
      api
        .post<AudiencePreview>(previewEndpoint, {
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
  }, [key, everyone, chosenCount, previewEndpoint]);

  const branchesByCompany = useMemo(() => {
    const map = new Map<number, AudienceOptions['branches']>();
    for (const b of options?.branches ?? []) {
      const list = map.get(b.companyId) ?? [];
      list.push(b);
      map.set(b.companyId, list);
    }
    return map;
  }, [options]);

  const groupsByCompany = useMemo(() => {
    const map = new Map<number, AudienceOptions['groups']>();
    for (const g of options?.groups ?? []) {
      const list = map.get(g.companyId) ?? [];
      list.push(g);
      map.set(g.companyId, list);
    }
    return map;
  }, [options]);

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </label>

      <button
        type="button"
        onClick={() => {
          // Either way the named people go with it — leaving their chips on
          // screen beside an audience that no longer carries them would say
          // something untrue about who is getting it.
          setPeople([]);
          onChange(everyone ? {} : { everyone: true });
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
            everyone ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400',
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
        <p className="text-xs text-slate-400">
          Pick <span className="font-medium">branches</span> and{' '}
          <span className="font-medium">roles</span> under a company — it goes
          to whoever is in one of those branches and holds one of those roles.
          All branches and all roles is the whole company.
        </p>
      )}

      {!everyone && (
        <div className="max-h-72 space-y-4 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-800">
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
            // Half a rule reaches nobody, so say which half is missing rather
            // than leaving somebody to work it out from a count of zero. A
            // company with no branches at all asks for none.
            const someBranch = branches.some((b) =>
              (value.branchIds ?? []).includes(b.id),
            );
            const someRole = groups.some((g) =>
              (value.userGroupIds ?? []).includes(g.id),
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
                    everything under it, which is what "the whole company" is. */}
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
                {/* Branches down one column, roles down the other. They are two
                    different questions — WHERE somebody works and WHAT they do —
                    and one list alternating between them reads as a single
                    muddled one, with "Vazhakulam" and "Branch Manager" looking
                    like the same kind of thing. */}
                {(branches.length > 0 || groups.length > 0) && (
                  <div className="ml-5 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    <Column
                      heading="Branches"
                      empty="No branches"
                      all={branches.map((b) => b.id)}
                      chosen={value.branchIds ?? []}
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
                          checked={(value.branchIds ?? []).includes(b.id)}
                          onToggle={() => toggle('branchIds', b.id)}
                        />
                      ))}
                    </Column>
                    <Column
                      heading="Roles"
                      empty="No user groups"
                      all={groups.map((g) => g.id)}
                      chosen={value.userGroupIds ?? []}
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
                          checked={(value.userGroupIds ?? []).includes(g.id)}
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
          chosen={people}
          onChange={setPickedPeople}
          placeholder="Anybody else who should get it…"
        />
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {counting && 'Working out who that is…'}
        {!counting && !preview && 'Choose who the circular is for.'}
        {!counting && preview && preview.count === 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            That reaches nobody — try another company, branch or group.
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
    </div>
  );
}

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
