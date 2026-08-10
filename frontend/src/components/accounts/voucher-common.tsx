'use client';

import { useMemo, useState } from 'react';
import { Ban, Plus, Trash2 } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { resolveIcon } from '@/lib/icons';
import { isoDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type {
  BalanceSide,
  BillRefType,
  CoaAccount,
  CostCenter,
  CostObject,
  Customer,
  PartyKind,
  Supplier,
  Voucher,
  VoucherStatus,
  WorkflowStatus,
} from '@/lib/types';

/**
 * The parts every voucher screen needs whatever its layout — the masters it
 * reads, the rules it reads off them, and the listing it opens on.
 *
 * The ENTRY FORM deliberately lives outside this file. Each kind of voucher is
 * entered differently — a journal is two columns of Dr and Cr, a receipt is one
 * bank line against many bills — and forcing one form to serve all ten is what
 * makes each of them slightly wrong. What they genuinely share is here; what
 * they don't, each screen writes for itself.
 */

// ---- money and dates --------------------------------------------------------

export const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

export const money = (v: string | number) =>
  num(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Money is compared in paise: two decimals held as an integer never drift. */
export const paise = (v: string | number | null | undefined) =>
  Math.round(num(v) * 100);

/** The date HERE, not in UTC — see isoDate. */
export const today = () => isoDate();
export const asDate = (iso: string) => new Date(iso).toLocaleDateString();

export const statusColor = (s: VoucherStatus) =>
  s === 'POSTED' ? 'green' : s === 'CANCELLED' ? 'slate' : 'blue';

// ---- the draft a form holds -------------------------------------------------

/** One bill-wise allocation as a form holds it — amounts as text until saved. */
export type DraftBill = {
  refType: BillRefType;
  /**
   * Which way this allocation pulls. Normally its line's side; the other when a
   * credit or debit note is being adjusted against what is being settled, in
   * which case the line's amount is the NET of them all.
   */
  side: BalanceSide;
  billRef: string;
  /** What an advance or on-account amount is called. Those two only. */
  refNote: string;
  againstId: string;
  amount: string;
};

export const emptyBill = (side: BalanceSide = 'DR'): DraftBill => ({
  refType: 'NEW',
  side,
  billRef: '',
  refNote: '',
  againstId: '',
  amount: '',
});

/**
 * What a stack of allocations comes to, read against the side of its line.
 *
 * A NET, not a sum: an allocation pulling the other way subtracts. That is what
 * makes "two invoices less a credit note" one line whose amount is what
 * actually moved, with each bill still carrying its own true figure.
 */
export const netOf = (bills: DraftBill[], lineSide: BalanceSide) =>
  bills.reduce(
    (t, b) => t + (b.side === lineSide ? paise(b.amount) : -paise(b.amount)),
    0,
  );

export const BILL_TYPES: { value: BillRefType; label: string }[] = [
  { value: 'NEW', label: 'New bill' },
  { value: 'AGAINST', label: 'Against a bill' },
  { value: 'ADVANCE', label: 'Advance' },
  { value: 'ON_ACCOUNT', label: 'On account' },
];

export const otherSide = (side: BalanceSide): BalanceSide =>
  side === 'DR' ? 'CR' : 'DR';

export type Mode = 'list' | 'edit' | 'view';

/** What a line is asked for, decided by the account it names. */
export interface LineAsks {
  /** The account's balance is a total; the line must say whose. */
  party: boolean;
  partyKind: PartyKind | null;
  centre: boolean;
  object: boolean;
}

const ASKS_NOTHING: LineAsks = {
  party: false,
  partyKind: null,
  centre: false,
  object: false,
};

// ---- the masters every voucher screen reads --------------------------------

/**
 * The chart, the cost dimensions and the party masters, with the derived lists
 * an entry form picks from.
 *
 * `asksFor` is the one place a screen asks what a line must carry. It answers
 * from the account alone, exactly as the server does — the entry rules were
 * already resolved by both checkpoints (company setup, then the account) before
 * they were sent, so a screen that reads them cannot disagree with the posting
 * engine about what is required.
 */
/**
 * How a ledger reads in a picker: its name, and the company's own name for it
 * where it has one.
 *
 * No code. A voucher is written and read in the names of the accounts — nobody
 * says "post it to 14101" — and the code in front of every option only made the
 * list harder to scan and the search harder to use. The chart of accounts is
 * where a code is looked up; see the searchable-picker convention, which is
 * name-only across every master.
 *
 * Shared so a screen that offers a narrowed list of accounts words them exactly
 * as the full list does.
 */
export const accountOption = (a: CoaAccount) => ({
  value: String(a.id),
  label: a.localName ?? a.name,
});

export function useVoucherMasters() {
  const { data: accounts } = useFetch<CoaAccount[]>('/coa/accounts');
  const { data: centres } = useFetch<CostCenter[]>('/cost-centers');
  const { data: objects } = useFetch<CostObject[]>('/cost-objects');
  // Who a control-account line can name. Only two masters exist; employee
  // accounts wait on HR.
  const { data: suppliers } = useFetch<Supplier[]>('/suppliers');
  const { data: customers } = useFetch<Customer[]>('/customers');

  // Only accounts this company posts to, and only those that take a
  // hand-written entry — the rest would be refused on save anyway.
  const postable = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.adopted && a.isActive && a.allowManualJe && a.allowPosting !== false,
      ),
    [accounts],
  );

  const accountById = useMemo(
    () => new Map(postable.map((a) => [a.id, a])),
    [postable],
  );

  const accountOptions = useMemo(
    () => postable.map(accountOption),
    [postable],
  );

  const centreOptions = useMemo(
    () =>
      (centres ?? [])
        .filter((c) => c.isActive)
        .map((c) => ({ value: String(c.id), label: c.name })),
    [centres],
  );

  /** The departments under one division — an object is never named alone. */
  const objectOptions = (costCenterId: string) =>
    (objects ?? [])
      .filter((o) => o.isActive && String(o.costCenterId) === costCenterId)
      .map((o) => ({ value: String(o.id), label: o.name }));

  /**
   * Who a line to this account may name.
   *
   * The KIND comes from the account (creditors are aged by supplier), and the
   * account itself narrows it further: a control account is a total, and only
   * the parties kept under THAT account are part of THAT total. Name Trade
   * Creditors and the trade suppliers are offered, not every supplier in the
   * company.
   *
   * Every party master carries a main ledger, so the narrowing is exact: a
   * party is offered under its own control account and no other. The server
   * applies the same rule, so the list and the save agree.
   *
   * Named, not coded — the same rule the ledger picker follows. Nobody settles
   * a bill with SUP-0007; the code belongs on the master and the register, not
   * in front of every option in a list being searched by name.
   */
  const partyOptions = (kind: PartyKind | null, accountId?: string | number) => {
    const list =
      kind === 'SUPPLIER'
        ? suppliers ?? []
        : kind === 'CUSTOMER'
          ? customers ?? []
          : [];
    const account = accountId != null ? Number(accountId) : null;
    return list
      .filter((p) => p.isActive && (!account || p.controlAccountId === account))
      .map((p) => ({ value: String(p.id), label: p.name }));
  };

  /**
   * What a party is called, given the kind and the id a line carries.
   *
   * Read from the same two masters the picker offers, and unfiltered by control
   * account: this answers a question about a line already written, where the
   * narrowing has done its work — a document printed from the voucher must name
   * the payee even if that party has since been moved under another ledger.
   */
  const partyName = (kind: PartyKind | null, id: number | null) => {
    if (!id) return null;
    const list =
      kind === 'SUPPLIER' ? suppliers : kind === 'CUSTOMER' ? customers : null;
    return (list ?? []).find((p) => p.id === id)?.name ?? null;
  };

  /**
   * What a division and a department are called, for a line already written.
   *
   * Like partyName, and unfiltered for the same reason: `objectOptions` narrows
   * the departments to one division, which is what a picker wants and what a
   * printed voucher does not — the line already says which.
   */
  const centreName = (id: number | null) =>
    id ? ((centres ?? []).find((c) => c.id === id)?.name ?? null) : null;

  const objectName = (id: number | null) =>
    id ? ((objects ?? []).find((o) => o.id === id)?.name ?? null) : null;

  const asksFor = (accountId: string | number): LineAsks => {
    const account = accountById.get(Number(accountId));
    if (!account) return ASKS_NOTHING;
    return {
      party: !!account.isControl,
      partyKind: account.controlParty ?? null,
      centre: account.entryRules?.costCenter === 'REQUIRED',
      object: account.entryRules?.costObject === 'REQUIRED',
    };
  };

  return {
    accounts: postable,
    accountById,
    accountOptions,
    centreOptions,
    objectOptions,
    partyOptions,
    partyName,
    centreName,
    objectName,
    asksFor,
  };
}

// ---- the listing every voucher screen opens on ------------------------------

export interface VoucherListProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  noun: string;
  rows: Voucher[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  onRefresh: () => void;
  onNew: () => void;
  onOpen: (v: Voucher) => void;
  onPost: (v: Voucher) => void;
  onCancel: (v: Voucher) => void;
  onDelete: (v: Voucher) => void;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** The grey second line under the narration. Defaults to the line count. */
  subLabel?: (v: Voucher) => string;
  /** Columns a kind adds for itself, placed after the date. */
  extraColumns?: Column<Voucher>[];
}

/**
 * The register — every voucher of one kind, and what may still be done to each.
 *
 * A draft may be posted, rewritten or thrown away. A posted voucher may only be
 * cancelled, and cancelling keeps it: the books have to be able to say what
 * they said, so nothing that reached them is ever removed.
 */
export function VoucherList({
  title,
  description,
  icon,
  noun,
  rows,
  loading,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onRefresh,
  onNew,
  onOpen,
  onPost,
  onCancel,
  onDelete,
  canAdd,
  canEdit,
  canDelete,
  subLabel,
  extraColumns = [],
}: VoucherListProps) {
  /**
   * The approval vocabulary — only for the icon and colour a stage is shown
   * with. The stage itself is on the voucher; this says what it looks like.
   */
  const { data: approvalStatuses } = useFetch<WorkflowStatus[]>(
    '/workflow-statuses',
  );
  const styleOf = useMemo(
    () => new Map((approvalStatuses ?? []).map((s) => [s.name, s])),
    [approvalStatuses],
  );

  /**
   * The stages actually present in this register, for a filter that offers only
   * what is there. Absent entirely on a kind nobody has put a workflow on —
   * which is nine of the ten, and none of them should grow a filter for it.
   */
  const stages = useMemo(
    () =>
      [...new Set(rows.map((v) => v.workflowStatus).filter(Boolean))].sort() as string[],
    [rows],
  );
  const [stage, setStage] = useState('');
  const shown = useMemo(
    () => (stage ? rows.filter((v) => v.workflowStatus === stage) : rows),
    [rows, stage],
  );

  // No Type column: every row on this screen is the same kind.
  const columns: Column<Voucher>[] = [
    {
      key: 'voucherNo',
      header: 'Voucher No',
      className: 'font-medium',
      accessor: (v) => v.voucherNo,
    },
    {
      key: 'date',
      header: 'Date',
      accessor: (v) => v.date,
      render: (v) => asDate(v.date),
    },
    ...extraColumns,
    {
      key: 'narration',
      header: 'Narration',
      accessor: (v) => v.narration ?? '',
      render: (v) => (
        <div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {v.narration || '—'}
          </div>
          <div className="text-xs text-slate-400">
            {subLabel
              ? subLabel(v)
              : `${v.lines.length} line${v.lines.length === 1 ? '' : 's'}${
                  v.lines[0]?.account ? ` · ${v.lines[0].account.name}` : ''
                }`}
          </div>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      headerClassName: 'text-right',
      className: 'text-right tabular-nums',
      sortAccessor: (v) => num(v.totalDebit),
      render: (v) => money(v.totalDebit),
    },
    {
      key: 'status',
      header: 'Status',
      headerClassName: 'text-center',
      className: 'text-center',
      accessor: (v) => `${v.status} ${v.workflowStatus ?? ''}`,
      render: (v) => {
        const style = v.workflowStatus ? styleOf.get(v.workflowStatus) : null;
        const Icon = style?.icon ? resolveIcon(style.icon) : null;
        return (
          <div className="flex flex-col items-center gap-1">
            <Badge color={statusColor(v.status)}>
              {v.status === 'DRAFT'
                ? 'Draft'
                : v.status === 'POSTED'
                  ? 'Posted'
                  : 'Cancelled'}
            </Badge>
            {/* Beside the books status rather than instead of it. "Draft" and
                "with the Accounts Head" are two different facts, and an
                accountant reading a register needs both — a draft nobody has
                finished and one waiting on a signature look identical
                otherwise, which is what this column used to show. */}
            {v.workflowStatus && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
                style={style?.color ? { color: style.color } : undefined}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {v.workflowStatus}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      className: 'w-32',
      render: (v) => (
        <div className="flex items-center justify-end gap-1">
          {v.status === 'DRAFT' && canEdit && (
            <button
              className="rounded px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              title="Write it to the books"
              onClick={(e) => {
                e.stopPropagation();
                onPost(v);
              }}
            >
              Post
            </button>
          )}
          {v.status === 'POSTED' && canEdit && (
            <button
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
              title={`Cancel this ${noun}`}
              onClick={(e) => {
                e.stopPropagation();
                onCancel(v);
              }}
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
          {v.status === 'DRAFT' && canDelete && (
            <button
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
              title="Delete this draft"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(v);
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
        title={title}
        description={description}
        icon={icon}
        actions={
          canAdd ? (
            <button className="btn-primary" onClick={onNew}>
              <Plus className="mr-1 inline h-4 w-4" />
              New {title}
            </button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(v) => v.id}
          loading={loading}
          search={search}
          onSearchChange={onSearchChange}
          searchPlaceholder="Search voucher no or narration…"
          onRefresh={onRefresh}
          onRowClick={(v) => onOpen(v)}
          emptyMessage={`No ${noun}s yet.`}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={statusFilter}
                onChange={(e) => onStatusFilterChange(e.target.value)}
                options={[
                  { value: 'DRAFT', label: 'Draft' },
                  { value: 'POSTED', label: 'Posted' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
                placeholder="Any status"
                className="w-40"
              />
              {/* Kept apart from the status filter, and only where there is
                  something to filter. Where a voucher stands in the BOOKS and
                  where it stands in its approval are different questions —
                  every stage below is a draft, so folding them into one list
                  would offer three ways to ask for the same rows. */}
              {stages.length > 0 && (
                <Select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  options={stages.map((s) => ({ value: s, label: s }))}
                  placeholder="Any approval stage"
                  className="w-48"
                />
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
