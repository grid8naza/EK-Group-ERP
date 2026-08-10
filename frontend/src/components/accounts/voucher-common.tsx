'use client';

import { useMemo } from 'react';
import { Ban, Plus, Trash2 } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
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
      accessor: (v) => v.status,
      render: (v) => (
        <Badge color={statusColor(v.status)}>
          {v.status === 'DRAFT'
            ? 'Draft'
            : v.status === 'POSTED'
              ? 'Posted'
              : 'Cancelled'}
        </Badge>
      ),
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
          rows={rows}
          rowKey={(v) => v.id}
          loading={loading}
          search={search}
          onSearchChange={onSearchChange}
          searchPlaceholder="Search voucher no or narration…"
          onRefresh={onRefresh}
          onRowClick={(v) => onOpen(v)}
          emptyMessage={`No ${noun}s yet.`}
          toolbar={
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
          }
        />
      </div>
    </div>
  );
}
