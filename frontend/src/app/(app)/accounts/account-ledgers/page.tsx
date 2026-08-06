'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Field';
import { useConfirm } from '@/providers/ConfirmProvider';
import { AccountDrawer } from './AccountDrawer';
import {
  AttributeChips,
  AttributeFilter,
  matchesAttributes,
  type AttributeFilters,
} from './AttributeFilter';
import type {
  AccountGroup,
  AccountNature,
  CoaAccount,
} from '@/lib/types';

const ROUTE = '/accounts/account-ledgers';

/**
 * The sides the five-digit code sorts into. Derived from the leading digit
 * rather than stored, exactly as the numbering intends.
 *
 * Five, not nine: the chart is numbered so that a code ASCENDS with the
 * statement it prints on. Equity moved to the head of the liabilities side, and
 * the profit and loss came down a decade behind it, so the five sides of the
 * chart are the first five decades and what is spare (6-9) sits above them
 * rather than as a hole in the middle.
 */
const BLOCKS: { digit: string; label: string }[] = [
  { digit: '1', label: '1 · Assets' },
  { digit: '2', label: '2 · Liabilities and Equity' },
  { digit: '3', label: '3 · Income' },
  { digit: '4', label: '4 · Purchases and Direct Expenses' },
  { digit: '5', label: '5 · Indirect and Operating Expenses' },
];

const NATURE_TONE: Record<AccountNature, string> = {
  ASSET: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  LIABILITY: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  EQUITY: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  INCOME: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  EXPENSE: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
};

/**
 * Only what a posting needs to know shows as a chip; the rest stays in detail.
 *
 * The cost chips read off the RESOLVED rules, not the account's own boxes: an
 * account that asks for a cost centre in a company that does not work in cost
 * centres asks for nothing, and the screen would be lying to say otherwise.
 */
const flagsOf = (a: CoaAccount) => {
  const out: string[] = [];
  if (a.isControl) out.push(`Control · ${a.controlParty}`);
  const asksCentre = a.entryRules
    ? a.entryRules.costCenter === 'REQUIRED'
    : a.hasCostCenter;
  const asksObject = a.entryRules
    ? a.entryRules.costObject === 'REQUIRED'
    : a.hasCostObject;
  if (asksObject) out.push('Cost centre + object');
  else if (asksCentre) out.push('Cost centre');
  // Ticked on the account but switched off for this company — worth saying,
  // because the box in the drawer will look ticked and nothing will ask.
  else if (a.hasCostCenter) out.push('Cost centre — off for this company');
  if (a.isContra) out.push('Contra');
  if (a.isIntercompany) out.push('Intercompany');
  if (a.isBankOrCash) out.push('Bank / cash');
  if (a.isGstRelevant) out.push('GST');
  if (a.isReconcilable) out.push('Reconcilable');
  if (!a.allowManualJe) out.push('No manual JE');
  // Last, and stated in the negative: a retired account still listed among live
  // ones has to say so, or the filter shows it and the row does not explain why.
  if (!a.isActive) out.push('Inactive');
  return out;
};

export default function AccountLedgersPage() {
  const { can, activeCompany } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: accounts, loading, refetch } = useFetch<CoaAccount[]>('/coa/accounts');
  const { data: groups } = useFetch<AccountGroup[]>('/coa/groups');

  const [search, setSearch] = useState('');
  const [block, setBlock] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [adoption, setAdoption] = useState(''); // '' | 'yes' | 'no'
  // Contra / control / GST / bank / reconcilable / manual journal / active,
  // each unset, yes or no.
  const [attrs, setAttrs] = useState<AttributeFilters>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<CoaAccount | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);

  const canEdit = can(ROUTE, 'edit');
  const canAdd = can(ROUTE, 'add');
  const canDelete = can(ROUTE, 'delete');
  const activeCompanyName = activeCompany?.name ?? 'this company';
  const all = useMemo(() => accounts ?? [], [accounts]);

  const groupOptions = useMemo(
    () =>
      (groups ?? [])
        .filter((g) => !block || g.code.startsWith(block))
        .map((g) => ({ value: String(g.id), label: `${g.code} — ${g.name}` })),
    [groups, block],
  );

  const rows = useMemo(() => {
    let out = all;
    if (block) out = out.filter((a) => a.code.startsWith(block));
    if (groupFilter) out = out.filter((a) => String(a.groupId) === groupFilter);
    if (adoption === 'yes') out = out.filter((a) => a.adopted);
    else if (adoption === 'no') out = out.filter((a) => !a.adopted);
    out = out.filter((a) => matchesAttributes(a, attrs));
    return out;
  }, [all, block, groupFilter, adoption, attrs]);

  const adoptedCount = all.filter((a) => a.adopted).length;

  /**
   * Adoption is what makes the shared master usable per company, so it toggles
   * inline rather than behind a form — it is one decision, not a record to edit.
   */
  const toggleAdoption = async (a: CoaAccount) => {
    setBusy(a.id);
    try {
      await api.patch(`/coa/accounts/${a.id}/adoption`, { adopted: !a.adopted });
      toast.success(
        `${a.code} ${a.name} ${a.adopted ? 'dropped from' : 'adopted by'} this company.`,
      );
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to change adoption.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Only accounts added here can be deleted; the annexure master is deactivated
   * instead, and the server refuses it regardless of what the UI offers.
   */
  const remove = async (a: CoaAccount) => {
    const ok = await confirm({
      title: 'Delete account',
      message:
        `Delete ${a.code} ${a.name}? It was added here rather than shipped ` +
        `with the annexure, so it can go. Any company's adoption of it goes too.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/coa/accounts/${a.id}`);
      toast.success('Account deleted.');
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  const columns: Column<CoaAccount>[] = [
    {
      key: 'code',
      header: 'Code',
      className: 'tabular-nums font-medium',
      accessor: (a) => a.code,
    },
    {
      key: 'name',
      header: 'Account',
      accessor: (a) => `${a.name} ${a.localName ?? ''} ${a.group.name}`,
      render: (a) => (
        <div>
          <div className="font-medium text-slate-800 dark:text-slate-100">
            {a.localName ?? a.name}
            {a.localName && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                ({a.name})
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400">
            {a.group.code} · {a.group.name}
          </div>
          {flagsOf(a).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {flagsOf(a).map((f) => (
                <span
                  key={f}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'nature',
      header: 'Nature',
      accessor: (a) => a.nature,
      render: (a) => (
        <span
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium',
            NATURE_TONE[a.nature],
          )}
        >
          {a.nature}
        </span>
      ),
    },
    {
      key: 'statement',
      header: 'Statement',
      accessor: (a) => a.statement,
      render: (a) => (
        <span className="text-xs text-slate-500">
          {a.statement === 'BS' ? 'Balance Sheet' : 'Profit & Loss'} · {a.normalSide}
        </span>
      ),
    },
    {
      key: 'tallyGroup',
      header: 'Tally Group',
      accessor: (a) => a.tallyGroup ?? '',
      render: (a) => (
        <span className="text-xs text-slate-400">{a.tallyGroup ?? '—'}</span>
      ),
    },
    {
      key: 'adopted',
      header: 'Used here',
      headerClassName: 'text-center',
      className: 'text-center',
      sortAccessor: (a) => (a.adopted ? 1 : 0),
      render: (a) =>
        canEdit ? (
          <button
            disabled={busy === a.id}
            onClick={(e) => {
              e.stopPropagation();
              void toggleAdoption(a);
            }}
            title={
              a.adopted
                ? 'Adopted by this company — click to drop it'
                : 'Not adopted — click to adopt it for this company'
            }
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full transition',
              a.adopted
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-300 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-600',
            )}
          >
            {a.adopted ? <Check className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </button>
        ) : a.adopted ? (
          <Check className="mx-auto h-4 w-4 text-emerald-600" />
        ) : (
          <Minus className="mx-auto h-4 w-4 text-slate-300" />
        ),
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      className: 'w-20',
      render: (a) => (
        <div className="flex items-center gap-0.5">
          {canEdit && (
            <button
              title="Edit name, notes and posting rules"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(a);
              }}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {/* Shipped accounts have no delete at all, rather than one that
              always fails — the master is the signed-off baseline. */}
          {canDelete && !a.isSystem && (
            <button
              title="Delete this account"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
              onClick={(e) => {
                e.stopPropagation();
                void remove(a);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Account Ledgers"
        description="The postable accounts from Annexure D. Every company draws on the same master; “Used here” is what the active company has adopted."
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          canAdd ? (
            <button className="btn-primary" onClick={() => setAddingAccount(true)}>
              <Plus className="mr-1 inline h-4 w-4" />
              New Account
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-2 text-sm text-slate-500 dark:text-slate-400">
        <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
          {all.length} accounts in the master
        </span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          {adoptedCount} adopted by this company
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
          {groups?.length ?? 0} groups
        </span>
        <p className="basis-full pt-1 text-xs">
          Only these accounts are posted to; the headings they hang from are
          maintained under Account Groups. Codes are fixed by the annexure — the
          name, notes, adoption and what an entry is asked for (cost centre, cost
          object) are what you maintain here.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search code, account or group…"
          onRefresh={refetch}
          emptyMessage="No accounts match these filters."
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={block}
                onChange={(e) => {
                  setBlock(e.target.value);
                  setGroupFilter('');
                }}
                options={BLOCKS.map((b) => ({ value: b.digit, label: b.label }))}
                placeholder="All blocks"
                className="w-56"
              />
              <Select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                options={groupOptions}
                placeholder="All groups"
                className="w-64"
              />
              <Select
                value={adoption}
                onChange={(e) => setAdoption(e.target.value)}
                options={[
                  { value: 'yes', label: 'Adopted here' },
                  { value: 'no', label: 'Not adopted' },
                ]}
                placeholder="Any adoption"
                className="w-44"
              />
              <AttributeFilter value={attrs} onChange={setAttrs} />
              <AttributeChips value={attrs} onChange={setAttrs} />
            </div>
          }
        />
      </div>

      <AccountDrawer
        open={addingAccount || !!editing}
        account={editing}
        groups={groups ?? []}
        companyName={activeCompanyName}
        onClose={() => {
          setAddingAccount(false);
          setEditing(null);
        }}
        onSaved={refetch}
      />
    </div>
  );
}
