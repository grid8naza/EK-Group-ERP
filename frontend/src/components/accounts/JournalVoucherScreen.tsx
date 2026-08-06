'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch } from '@/lib/hooks';
import { resolveIcon } from '@/lib/icons';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  DateInput,
  Input,
  Select,
  Textarea,
  focusNextField,
} from '@/components/ui/Field';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { BillPicker, type BillPick } from './BillPicker';
import type {
  BalanceSide,
  BillRefType,
  OutstandingBill,
  PartyKind,
  Voucher,
  VoucherType,
} from '@/lib/types';
import {
  BILL_TYPES,
  type DraftBill,
  type Mode,
  VoucherList,
  emptyBill,
  money,
  netOf,
  num,
  otherSide,
  paise,
  today,
  useVoucherMasters,
} from './voucher-common';

/**
 * One line of a journal, as the form holds it.
 *
 * `key` is not the line's identity in the books — a line has none until it is
 * saved — but its identity on SCREEN. Lines are added, removed and re-ordered
 * mid-entry, and keying rows by array index would move focus out from under
 * whoever is typing.
 *
 * A line carries a SIDE and one amount rather than a debit and a credit,
 * because that is what a line is: it moves an account one way. The form shows
 * two money columns because an accountant reads two, and only the side's own
 * column accepts anything.
 */
type JvLine = {
  key: number;
  side: 'DR' | 'CR';
  /** The user has said which side this is, so nothing may quietly change it. */
  sideTouched: boolean;
  accountId: string;
  /** Whose balance the line moves. Asked for only on a control account. */
  partyId: string;
  costCenterId: string;
  costObjectId: string;
  amount: string;
  narration: string;
  bills: DraftBill[];
};

const emptyLine = (key: number, side: 'DR' | 'CR' = 'DR', amount = ''): JvLine => ({
  key,
  side,
  sideTouched: false,
  accountId: '',
  partyId: '',
  costCenterId: '',
  costObjectId: '',
  amount,
  narration: '',
  bills: [],
});

/** Every control on the form has a stable id, so focus can be aimed at it. */
const fid = (key: number, part: string) => `jv-${key}-${part}`;
const DATE_FIELD = 'jv-date';
const COMMON_NARRATION = 'jv-common-narration';

/**
 * The one column definition the whole voucher is laid out on: side,
 * particulars, the two money columns, the row's own button.
 *
 * Every row of a line group — the line, its narration, its bill details — is
 * placed in this same grid, so a narration box ends exactly where the ledger
 * box above it ends and a bill amount sits exactly under Debit. Alignment by
 * shared structure rather than by matching spacer widths, which drift the
 * moment a column changes.
 */
const GRID = '3.5rem minmax(0,1fr) 8rem 8rem 1.75rem';

/** The same columns from Particulars rightward, for rows that start there. */
const BILL_GRID = 'minmax(0,1fr) 8rem 8rem 1.75rem';

const focusById = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.focus());

/** How a chosen bill reads back on the line. Null when none is chosen yet. */
function billLabel(bills: OutstandingBill[], againstId: string): string | null {
  if (!againstId) return null;
  const bill = bills.find((b) => String(b.id) === againstId);
  if (!bill) return 'That bill is no longer outstanding';
  return bill.overdueDays > 0
    ? `${bill.billRef ?? '—'} · ${bill.overdueDays}d overdue`
    : (bill.billRef ?? '—');
}

export interface JournalVoucherScreenProps {
  /** The one kind this screen writes — a `VoucherType.code`. */
  typeCode: string;
  /** This screen's own route; privileges are keyed on it. */
  route: string;
  title: string;
  description: string;
  icon: string;
  noun: string;
}

/**
 * Journal Voucher — entered the way a journal is written.
 *
 * The shape is Tally's, because Tally's shape is the one every accountant who
 * will use this already has in their hands: a date and a reference at the top,
 * then Dr and Cr lines down the page with a narration under each, and the two
 * money columns totalled at the foot. What is NOT there matters as much — a
 * journal moves no money and sells nothing, so it is not classified by
 * transaction type; that question belongs to the sales and purchase screens.
 *
 * It is built for the keyboard first. Every picker is searchable, Enter walks
 * forward through the fields, and leaving the last field of the last line while
 * the two columns disagree opens a fresh line already carrying the difference
 * on the opposite side — which is almost always the line the user was about to
 * type. Reaching for the mouse during entry should never be necessary.
 */
export function JournalVoucherScreen({
  typeCode,
  route,
  title,
  description,
  icon,
  noun,
}: JournalVoucherScreenProps) {
  const { can, activeCompany } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const Icon = resolveIcon(icon);

  const { data: types } = useFetch<VoucherType[]>('/vouchers/types');
  const masters = useVoucherMasters();

  // The kind's id in THIS database — the screen knows its code, the server
  // assigns the id.
  const voucherType = useMemo(
    () => (types ?? []).find((t) => t.code === typeCode) ?? null,
    [types, typeCode],
  );

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const query = [
    `typeCode=${encodeURIComponent(typeCode)}`,
    statusFilter ? `status=${statusFilter}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const {
    data: rows,
    loading,
    refetch,
  } = useFetch<Voucher[]>(`/vouchers?${query}`, [query]);

  // The number the next one would take. A preview only — it is settled on save,
  // so it is refetched after every save rather than held.
  const { data: nextNo, refetch: refetchNextNo } = useFetch<{ voucherNo: string }>(
    `/vouchers/next-no?typeCode=${encodeURIComponent(typeCode)}`,
    [typeCode],
  );

  const [mode, setMode] = useState<Mode>('list');
  const [editing, setEditing] = useState<Voucher | null>(null);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const keySeq = useRef(0);
  const nextKey = () => ++keySeq.current;
  // Dr then Cr: a journal's second line answers its first, and starting both on
  // the same side would mean correcting one of them on every single entry.
  const [lines, setLines] = useState<JvLine[]>(() => [
    emptyLine(++keySeq.current, 'DR'),
    emptyLine(++keySeq.current, 'CR'),
  ]);

  // Where focus should land once the lines have re-rendered — set by whatever
  // changed them, honoured by the effect below. Focus cannot be moved to a row
  // that React has not painted yet.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    focusById(id);
  }, [lines, mode]);

  const canAdd = can(route, 'add');
  const canEdit = can(route, 'edit');
  const canDelete = can(route, 'delete');
  const readOnly = mode === 'view';

  // ---- what each party still owes, per line -----------------------------------
  // Fetched when a party is named rather than up front: it is per party, and
  // most journals name none. Keyed by party so two lines to the same one share
  // a single read.
  const [openBills, setOpenBills] = useState<Record<string, OutstandingBill[]>>({});
  const billsKey = (kind: PartyKind | null, partyId: string) => `${kind}:${partyId}`;

  const loadBills = async (kind: PartyKind | null, partyId: string) => {
    if (!kind || !partyId) return;
    const k = billsKey(kind, partyId);
    if (openBills[k]) return;
    try {
      const list = await api.get<OutstandingBill[]>(
        `/vouchers/bills?partyKind=${kind}&partyId=${partyId}`,
      );
      setOpenBills((m) => ({ ...m, [k]: list }));
    } catch {
      setOpenBills((m) => ({ ...m, [k]: [] }));
    }
  };

  // ---- opening and closing the form -------------------------------------------

  const startNew = () => {
    setEditing(null);
    setDate(today());
    setReference('');
    setNarration('');
    setLines([emptyLine(nextKey(), 'DR'), emptyLine(nextKey(), 'CR')]);
    setMode('edit');
    pendingFocus.current = DATE_FIELD;
  };

  const open = (v: Voucher) => {
    setEditing(v);
    setDate(v.date.slice(0, 10));
    setReference(v.reference ?? '');
    setNarration(v.narration ?? '');
    setLines(
      v.lines.map((l) => ({
        key: nextKey(),
        side: (num(l.debit) > 0 ? 'DR' : 'CR') as 'DR' | 'CR',
        // A saved line's side is a fact, not a default waiting to be improved.
        sideTouched: true,
        accountId: String(l.accountId),
        partyId: l.partyId ? String(l.partyId) : '',
        costCenterId: l.costCenterId ? String(l.costCenterId) : '',
        costObjectId: l.costObjectId ? String(l.costObjectId) : '',
        amount: String(num(l.debit) > 0 ? num(l.debit) : num(l.credit)),
        narration: l.narration ?? '',
        bills: (l.billRefs ?? []).map((b) => ({
          refType: b.refType,
          // Written before allocations carried a side: those all went the way
          // of their line, which is what null means.
          side: b.side ?? ((num(l.debit) > 0 ? 'DR' : 'CR') as BalanceSide),
          billRef: b.billRef ?? '',
          refNote: b.refNote ?? '',
          againstId: b.againstId ? String(b.againstId) : '',
          amount: String(b.amount),
        })),
      })),
    );
    setMode(v.status === 'DRAFT' ? 'edit' : 'view');
    // A saved voucher's parties already have bills on file; load them so the
    // rows read as bills rather than ids.
    for (const l of v.lines) {
      if (l.partyKind && l.partyId) void loadBills(l.partyKind, String(l.partyId));
    }
  };

  const closeForm = () => {
    setMode('list');
    setEditing(null);
  };

  // ---- editing the lines --------------------------------------------------------

  const setLine = (key: number, patch: Partial<JvLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /**
   * Say which side a line is — and answer it on the line below.
   *
   * A journal is written in pairs, so naming one side has all but named the
   * other. The line below only takes it while it is still blank and its own
   * side has never been set: a default may be improved on, a decision may not.
   */
  const setSide = (index: number, side: 'DR' | 'CR') =>
    setLines((ls) =>
      ls.map((l, x) => {
        if (x === index) {
          return {
            ...l,
            side,
            sideTouched: true,
            // The bills turn with the line. What each one said was "the same
            // way as this line" or "the other way", and turning the line over
            // does not change which of those it was.
            bills:
              l.side === side
                ? l.bills
                : l.bills.map((b) => ({ ...b, side: otherSide(b.side) })),
          };
        }
        if (
          x === index + 1 &&
          !l.sideTouched &&
          !l.accountId &&
          !num(l.amount)
        ) {
          return { ...l, side: side === 'DR' ? 'CR' : 'DR' };
        }
        return l;
      }),
    );

  /**
   * Change one bill row — and, where that changes a figure, re-balance the
   * stack behind it.
   *
   * The LAST row of a stack is not a number someone typed: it is what the line
   * has left over, opened automatically and carrying the remainder. So it
   * follows the rows above it. Cut an earlier bill from 5,000 to 2,000 and the
   * last row absorbs the 3,000, instead of sitting there over-allocating the
   * line until somebody notices the amber warning.
   *
   * Changes to the last row itself are left alone — that one IS being typed.
   */
  const setBill = (l: JvLine, bi: number, patch: Partial<DraftBill>) => {
    const next = l.bills.map((b, y) => (y === bi ? { ...b, ...patch } : b));
    const isLast = bi === l.bills.length - 1;
    // A side is a figure too — flipping a row to Dr changes what the stack
    // comes to just as surely as retyping its amount.
    const moved = patch.amount !== undefined || patch.side !== undefined;
    setLine(l.key, {
      bills: moved && !isLast ? rebalance(next, l.amount, l.side) : next,
    });
  };

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      if (l.side === 'DR') dr += paise(l.amount);
      else cr += paise(l.amount);
    }
    return { dr: dr / 100, cr: cr / 100, diff: (dr - cr) / 100 };
  }, [lines]);
  const balanced = totals.diff === 0 && totals.dr > 0;

  /**
   * Open a fresh line, already carrying what is missing.
   *
   * The difference is the whole point: a journal that is out by 1,020.41 on the
   * debit side needs 1,020.41 credited, and typing that number again is work
   * the form can do. The side flips for the same reason.
   */
  const addLine = () => {
    const key = nextKey();
    const diff = totals.diff;
    const line = emptyLine(
      key,
      diff > 0 ? 'CR' : 'DR',
      diff === 0 ? '' : Math.abs(diff).toFixed(2),
    );
    pendingFocus.current = fid(key, 'side');
    setLines((ls) => [...ls, line]);
  };

  // ---- settling against bills --------------------------------------------------
  // Which bill row is choosing its bills, and on which line. Opening the picker
  // is what an AGAINST row does — a settlement is decided by reading the list
  // of what is owed, not by typing a bill number somebody already knows.
  const [picking, setPicking] = useState<{
    lineKey: number;
    lineIndex: number;
    billIndex: number;
  } | null>(null);
  const pickingLine = lines.find((l) => l.key === picking?.lineKey) ?? null;

  /**
   * Take what was ticked and turn it into allocations.
   *
   * One row per bill, in place of the row the picker was opened from: "5,000
   * against INV-002 and INV-007" is two facts, and the sub-ledger needs both or
   * neither bill knows where it stands. Whatever the settlements leave over
   * opens a row of its own, exactly as it does anywhere else on this form.
   */
  const applyPicks = (picks: BillPick[]) => {
    const l = pickingLine;
    if (!picking || !l) return;
    // Nothing ticked changes nothing — the row stays where it was, waiting to
    // be answered. Closing with an empty selection is a change of mind, not an
    // instruction to rearrange the stack around it.
    if (!picks.length) return setPicking(null);

    const bi = picking.billIndex;
    const rows: DraftBill[] = picks.map((p) => ({
      ...emptyBill(p.side),
      refType: 'AGAINST',
      againstId: String(p.id),
      amount: p.amount,
    }));
    let next = [
      ...l.bills.slice(0, bi),
      ...rows,
      ...l.bills.slice(bi + 1),
    ];
    const last = next[next.length - 1];
    if (last?.refType === 'AGAINST') {
      // No balancing row left to absorb the rest, so open one.
      const left = paise(l.amount) - netOf(next, l.side);
      if (left !== 0) {
        next = [
          ...next,
          {
            ...emptyBill(left < 0 ? otherSide(l.side) : l.side),
            amount: (Math.abs(left) / 100).toFixed(2),
          },
        ];
      }
    } else {
      next = rebalance(next, l.amount, l.side);
    }

    setLine(l.key, { bills: next });
    setPicking(null);
    // Carry on where the entry was: into the row that still needs answering,
    // or out of the line altogether if the settlements finished it.
    const spliced = l.bills.length - 1 + rows.length;
    if (next.length > spliced) {
      pendingFocus.current = fid(l.key, `bill-${next.length - 1}-type`);
    } else {
      advanceFromLine(picking.lineIndex);
    }
  };

  /**
   * Open another bill row on a line, carrying whatever of it is still
   * unallocated — the same rule as adding a line, one level down.
   */
  const addBill = (l: JvLine, remainderPaise: number) => {
    pendingFocus.current = fid(l.key, `bill-${l.bills.length}-type`);
    setLine(l.key, {
      bills: [
        ...l.bills,
        {
          // A remainder that pulls the other way opens the row already marked
          // as the adjustment it must be.
          ...emptyBill(remainderPaise < 0 ? otherSide(l.side) : l.side),
          amount:
            remainderPaise === 0
              ? ''
              : (Math.abs(remainderPaise) / 100).toFixed(2),
        },
      ],
    });
  };

  const removeLine = (key: number) => {
    // Two lines is the least a voucher can be; below that there is nothing to
    // balance against.
    if (lines.length <= 2) {
      return toast.error('A journal needs at least two lines.');
    }
    setLines((ls) => ls.filter((l) => l.key !== key));
  };

  /**
   * The line is finished with — move on.
   *
   * Within the voucher that is simply the next line. On the LAST line it is the
   * decision point: if the two columns still disagree the entry is not
   * finished, so a line opens for the rest of it; if they agree, the lines are
   * done and focus drops to the narration that closes the voucher.
   */
  const advanceFromLine = (i: number) => {
    if (i < lines.length - 1) return focusById(fid(lines[i + 1].key, 'side'));
    if (!balanced) return addLine();
    focusById(COMMON_NARRATION);
  };

  /** Leaving the last field of a line, by key. */
  const onLineEnd = (i: number, e: React.KeyboardEvent) => {
    const enter = e.key === 'Enter';
    const tab = e.key === 'Tab' && !e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Enter is the fast path and always moves on. Tab keeps its ordinary
    // meaning except at the one place it would walk out of an unfinished
    // voucher — the end of the last line while the columns disagree.
    const decisionPoint = i === lines.length - 1 && !balanced;
    if (!enter && !(tab && decisionPoint)) return;
    e.preventDefault();
    advanceFromLine(i);
  };

  /**
   * Leaving a bill amount.
   *
   * The line's amount has to be spread across bills to the penny, so the same
   * rule that governs the voucher governs the line: while the parts do not add
   * up to the whole, another row opens for the rest. Only once they agree does
   * the line itself close.
   */
  const onBillEnd = (i: number, l: JvLine, bi: number, e: React.KeyboardEvent) => {
    const enter = e.key === 'Enter';
    const tab = e.key === 'Tab' && !e.shiftKey;
    if (!enter && !tab) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (bi !== l.bills.length - 1) return; // an earlier row: ordinary advance

    const allocated = netOf(l.bills, l.side);
    const wanted = paise(l.amount);
    if (wanted > 0 && allocated !== wanted) {
      e.preventDefault();
      addBill(l, wanted - allocated);
      return;
    }
    onLineEnd(i, e);
  };

  // ---- saving ------------------------------------------------------------------

  const body = () => ({
    voucherTypeId: voucherType?.id ?? 0,
    date,
    // Always sent, even empty: on a patch an absent field means "leave it
    // alone", so omitting a cleared reference would quietly restore the old one.
    reference: reference.trim(),
    narration,
    lines: lines
      .filter((l) => l.accountId && num(l.amount) > 0)
      .map((l) => ({
        accountId: Number(l.accountId),
        debit: l.side === 'DR' ? num(l.amount) : 0,
        credit: l.side === 'CR' ? num(l.amount) : 0,
        costCenterId: l.costCenterId ? Number(l.costCenterId) : undefined,
        costObjectId: l.costObjectId ? Number(l.costObjectId) : undefined,
        narration: l.narration || undefined,
        partyId: l.partyId ? Number(l.partyId) : undefined,
        bills: l.bills.length
          ? l.bills
              .filter((b) => num(b.amount) > 0)
              .map((b) => ({
                refType: b.refType,
                side: b.side,
                billRef: b.refType === 'NEW' ? b.billRef.trim() : undefined,
                // Only an advance or an on-account amount carries a note — a
                // bill is identified by its own number.
                refNote:
                  b.refType === 'ADVANCE' || b.refType === 'ON_ACCOUNT'
                    ? b.refNote.trim()
                    : undefined,
                againstId:
                  b.refType === 'AGAINST' && b.againstId
                    ? Number(b.againstId)
                    : undefined,
                amount: num(b.amount),
              }))
          : undefined,
      })),
  });

  const save = async (post: boolean) => {
    const payload = body();
    if (!payload.voucherTypeId) {
      return toast.error(`The ${noun} type is not set up yet.`);
    }
    if (payload.lines.length < 2) {
      return toast.error(`A ${noun} needs at least two lines.`);
    }
    if (post && !balanced) {
      return toast.error('Debits and credits must agree before posting.');
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/vouchers/${editing.id}`, { ...payload, post });
      } else {
        await api.post('/vouchers', { ...payload, post });
      }
      toast.success(post ? 'Voucher posted.' : 'Draft saved.');
      await Promise.all([refetch(), refetchNextNo()]);
      // Posting one journal is usually the start of posting several, so the
      // form stays open on a fresh voucher. A draft is unfinished work and
      // goes back to the register.
      if (post && !editing) startNew();
      else closeForm();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const postExisting = async (v: Voucher) => {
    try {
      await api.patch(`/vouchers/${v.id}/post`, {});
      toast.success(`${v.voucherNo} posted.`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to post.');
    }
  };

  const cancel = async (v: Voucher) => {
    const ok = await confirm({
      title: `Cancel ${noun}`,
      message:
        `Cancel ${v.voucherNo}? It stays in the books, marked cancelled — a ` +
        `posted voucher is never removed.`,
      confirmText: 'Cancel it',
      cancelText: 'Keep',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.patch(`/vouchers/${v.id}/cancel`, {
        reason: `Cancelled from ${title}`,
      });
      toast.success('Voucher cancelled.');
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to cancel.');
    }
  };

  const remove = async (v: Voucher) => {
    const ok = await confirm({
      title: 'Delete draft',
      message: `Delete draft ${v.voucherNo}? It has not reached the books.`,
      confirmText: 'Delete',
      danger: true,
      defaultCancel: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/vouchers/${v.id}`);
      toast.success('Draft deleted.');
      await Promise.all([refetch(), refetchNextNo()]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  if (mode === 'list') {
    return (
      <VoucherList
        title={title}
        description={description}
        icon={<Icon className="h-5 w-5" />}
        noun={noun}
        rows={rows ?? []}
        loading={loading}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={refetch}
        onNew={startNew}
        onOpen={open}
        onPost={(v) => void postExisting(v)}
        onCancel={(v) => void cancel(v)}
        onDelete={(v) => void remove(v)}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        extraColumns={[
          {
            key: 'reference',
            header: 'Reference',
            accessor: (v) => v.reference ?? '',
            render: (v) => v.reference || '—',
          },
        ]}
      />
    );
  }

  // ---- entry form ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={editing ? `${editing.voucherNo} — ${title}` : `New ${title}`}
        description={
          readOnly
            ? 'Posted — a correction is a fresh voucher, never an edit to this one'
            : 'Enter moves to the next field. The lines close when the two columns agree.'
        }
        icon={<Icon className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={closeForm}>
              <ArrowLeft className="mr-1 inline h-4 w-4" />
              Back
            </button>
            {!readOnly && (
              <>
                <button
                  className="btn-secondary"
                  disabled={saving}
                  onClick={() => void save(false)}
                >
                  Save draft
                </button>
                <button
                  className="btn-primary"
                  disabled={saving || !balanced}
                  title={
                    balanced
                      ? 'Write it to the books (Ctrl+Enter)'
                      : 'It does not balance yet'
                  }
                  onClick={() => void save(true)}
                >
                  <Check className="mr-1 inline h-4 w-4" />
                  Post
                </button>
              </>
            )}
          </div>
        }
      />

      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-6"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || readOnly) return;
          // Alt+Enter opens a line wherever the caret is — the lines normally
          // grow on their own, but a voucher of three or more legs needs a way
          // to say so up front.
          if (e.altKey) {
            e.preventDefault();
            addLine();
            return;
          }
          // Ctrl+Enter accepts the voucher from anywhere on the form — the one
          // shortcut worth knowing, and the only way to finish without the
          // mouse once the narration has the caret.
          if (!(e.ctrlKey || e.metaKey) || saving || !balanced) return;
          e.preventDefault();
          void save(true);
        }}
      >
        <ReadOnlyFieldset readOnly={readOnly}>
          {/* Top block. No transaction type or subtype: a journal moves no
              money and sells nothing, so there is nothing for that taxonomy to
              say about it. */}
          <div className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            <DateInput
              id={DATE_FIELD}
              label="Date"
              required
              value={date}
              disabled={readOnly}
              onChange={setDate}
            />
            <div>
              <label className="label">Voucher No</label>
              {/* Disabled rather than merely read-only: nobody types a voucher
                  number, and disabling it also takes it out of the keyboard's
                  path so Enter runs Date → Reference without a dead stop. */}
              <input
                className="input-base bg-slate-50 font-medium text-slate-500 dark:bg-slate-800/60 dark:text-slate-400"
                value={editing?.voucherNo ?? nextNo?.voucherNo ?? 'Auto'}
                disabled
                readOnly
              />
              {!editing && (
                <p className="mt-1 text-xs text-slate-400">
                  Assigned on save — the next in this company&apos;s series.
                </p>
              )}
            </div>
            <Input
              id="jv-reference"
              label="Reference"
              value={reference}
              disabled={readOnly}
              placeholder="Advice no, bill no, resolution…"
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          {/* The lines. Two money columns down the right, as a journal is read;
              everything that varies by ledger sits in Particulars so those two
              columns stay put whatever a line asks for. */}
          <div className="card mt-3 overflow-hidden">
            <div
              className="grid items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
              style={{ gridTemplateColumns: GRID }}
            >
              <span>Dr/Cr</span>
              <span>Particulars</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span />
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {lines.map((l, i) => {
                const asks = masters.asksFor(l.accountId);
                const bills = openBills[billsKey(asks.partyKind, l.partyId)] ?? [];
                const showBills = asks.party && !!l.partyId;
                const allocated = netOf(l.bills, l.side);
                const wanted = paise(l.amount);
                const left = (wanted - allocated) / 100;
                // The line's LAST field — where leaving it decides whether a
                // new line opens. Bills sit below the narration, so when they
                // are shown they hold that position.
                const lastBill = showBills && l.bills.length > 0;

                return (
                  <div
                    key={l.key}
                    className="px-3 py-2"
                    onKeyDown={(e) => {
                      // Ctrl+Delete drops the line without leaving the keyboard.
                      if (e.key !== 'Delete' || !(e.ctrlKey || e.metaKey)) return;
                      if (readOnly) return;
                      e.preventDefault();
                      removeLine(l.key);
                    }}
                  >
                    <div
                      className="grid items-start gap-x-2 gap-y-1.5"
                      style={{ gridTemplateColumns: GRID }}
                    >
                      <SideToggle
                        id={fid(l.key, 'side')}
                        value={l.side}
                        disabled={readOnly}
                        onChange={(side) => setSide(i, side)}
                      />

                      <div className="flex min-w-0 flex-wrap items-start gap-2">
                        <Select
                          id={fid(l.key, 'ledger')}
                          value={l.accountId}
                          disabled={readOnly}
                          wrapClassName="min-w-[16rem] flex-1"
                          onChange={(e) =>
                            // A different ledger may be kept by a different
                            // party, or by none, and may ask for different
                            // dimensions. None of the old answers survive it.
                            setLine(l.key, {
                              accountId: e.target.value,
                              partyId: '',
                              costCenterId: '',
                              costObjectId: '',
                              bills: [],
                            })
                          }
                          options={masters.accountOptions}
                          placeholder="Ledger"
                        />

                        {/* Only where the ledger is a control account — its
                            balance is a total, and this is whose. */}
                        {asks.party && (
                          <Select
                            id={fid(l.key, 'subledger')}
                            value={l.partyId}
                            disabled={readOnly}
                            wrapClassName="w-52"
                            onChange={(e) => {
                              const partyId = e.target.value;
                              void loadBills(asks.partyKind, partyId);
                              // The bills belonged to the old party. A ledger
                              // kept bill by bill always needs at least one
                              // allocation, so the first row opens with it.
                              setLine(l.key, {
                                partyId,
                                bills: partyId
                                  ? [{ ...emptyBill(l.side), amount: l.amount }]
                                  : [],
                              });
                            }}
                            options={masters.partyOptions(asks.partyKind, l.accountId)}
                            placeholder={
                              asks.partyKind === 'SUPPLIER'
                                ? 'Supplier'
                                : asks.partyKind === 'CUSTOMER'
                                  ? 'Customer'
                                  : 'Master not built yet'
                            }
                          />
                        )}

                        {/* Offered only where the ledger asks for it — the same
                            two checkpoints the server enforces. */}
                        {asks.centre && (
                          <Select
                            id={fid(l.key, 'centre')}
                            value={l.costCenterId}
                            disabled={readOnly}
                            wrapClassName="w-44"
                            onChange={(e) =>
                              setLine(l.key, {
                                costCenterId: e.target.value,
                                costObjectId: '',
                              })
                            }
                            options={masters.centreOptions}
                            placeholder="Cost centre"
                          />
                        )}
                        {asks.object && (
                          <Select
                            id={fid(l.key, 'object')}
                            value={l.costObjectId}
                            disabled={readOnly || !l.costCenterId}
                            wrapClassName="w-44"
                            onChange={(e) =>
                              setLine(l.key, { costObjectId: e.target.value })
                            }
                            options={masters.objectOptions(l.costCenterId)}
                            placeholder={l.costCenterId ? 'Cost object' : 'Centre first'}
                          />
                        )}
                      </div>

                      {/* One column per side, and only the side's own column
                          takes a figure — the other is dead, the way the paper
                          it copies is. */}
                      <AmountCell
                        id={fid(l.key, 'debit')}
                        active={l.side === 'DR'}
                        value={l.amount}
                        disabled={readOnly}
                        onChange={(v) => onAmountChange(l, v, setLine)}
                      />
                      <AmountCell
                        id={fid(l.key, 'credit')}
                        active={l.side === 'CR'}
                        value={l.amount}
                        disabled={readOnly}
                        onChange={(v) => onAmountChange(l, v, setLine)}
                      />

                      <div className="pt-1.5 text-center">
                        {!readOnly && lines.length > 2 && (
                          <button
                            type="button"
                            tabIndex={-1}
                            className="rounded p-1 text-slate-300 hover:text-rose-600"
                            title="Remove this line (Ctrl+Delete)"
                            onClick={() => removeLine(l.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* The line's own narration, under it. Placed in the
                          Particulars column, so its box ends exactly where the
                          ledger box above it ends. */}
                      <div className="col-start-2 flex items-center gap-2">
                        <label className="flex-none text-xs italic text-slate-400">
                          Narration
                        </label>
                        <Input
                          id={fid(l.key, 'narration')}
                          value={l.narration}
                          disabled={readOnly}
                          wrapClassName="min-w-0 flex-1"
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (lastBill) return; // the bills below close the line
                            onLineEnd(i, e);
                          }}
                          onChange={(e) =>
                            setLine(l.key, { narration: e.target.value })
                          }
                        />
                      </div>

                      {/* Bill-wise details, under the narration, on the ledgers
                          that are kept bill by bill. Every part of the line has
                          to say which bill it belongs to — that is what bill-wise
                          tracking IS, and the server refuses the line without it.
                          Laid out on the same columns, so a bill's amount sits
                          under Debit. */}
                      {showBills && (
                        <div className="col-start-2 col-end-6 space-y-1">
                          {l.bills.map((b, bi) => (
                            <div
                              key={bi}
                              className="grid items-center gap-2"
                              style={{ gridTemplateColumns: BILL_GRID }}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {/* Fixed width, or the second bill row would
                                    start further left than the first. */}
                                <span className="w-9 flex-none text-xs italic text-slate-400">
                                  {bi === 0 ? 'Bills' : ''}
                                </span>
                                <Select
                                  id={fid(l.key, `bill-${bi}-type`)}
                                  value={b.refType}
                                  disabled={readOnly}
                                  wrapClassName="w-40 flex-none"
                                  onChange={(e) => {
                                    const refType = e.target.value as BillRefType;
                                    setBill(l, bi, {
                                      refType,
                                      billRef: '',
                                      refNote: '',
                                      againstId: '',
                                    });
                                    // Settling means picking from the list, so
                                    // choosing the method IS the request to see
                                    // it — no second click to get there.
                                    if (refType === 'AGAINST') {
                                      setPicking({
                                        lineKey: l.key,
                                        lineIndex: i,
                                        billIndex: bi,
                                      });
                                    }
                                  }}
                                  options={BILL_TYPES}
                                />
                                {b.refType === 'NEW' ? (
                                  <Input
                                    id={fid(l.key, `bill-${bi}-ref`)}
                                    value={b.billRef}
                                    disabled={readOnly}
                                    wrapClassName="min-w-0 flex-1"
                                    className="h-8 text-sm"
                                    placeholder="Bill number, e.g. INV-001"
                                    onChange={(e) =>
                                      setBill(l, bi, {
                                        billRef: e.target.value,
                                      })
                                    }
                                  />
                                ) : b.refType === 'AGAINST' ? (
                                  /* Not a dropdown: which invoices a payment
                                     clears is decided by READING what is owed
                                     — how old, how overdue, how much left — so
                                     the button opens the list rather than
                                     asking for a bill number up front. */
                                  <button
                                    id={fid(l.key, `bill-${bi}-ref`)}
                                    type="button"
                                    data-field=""
                                    disabled={readOnly}
                                    onClick={() =>
                                      setPicking({
                                        lineKey: l.key,
                                        lineIndex: i,
                                        billIndex: bi,
                                      })
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return;
                                      e.preventDefault();
                                      setPicking({
                                        lineKey: l.key,
                                        lineIndex: i,
                                        billIndex: bi,
                                      });
                                    }}
                                    className={cn(
                                      'input-base h-8 min-w-0 flex-1 truncate text-left text-sm',
                                      !b.againstId && 'text-slate-400',
                                    )}
                                  >
                                    {billLabel(bills, b.againstId) ??
                                      (bills.length
                                        ? 'Choose bills…'
                                        : 'Nothing outstanding')}
                                  </button>
                                ) : (
                                  /* An advance or an on-account amount names no
                                     bill — but it still has to be recognisable
                                     when someone comes back to it, so it takes
                                     whatever the entry wants to call it. */
                                  <Input
                                    id={fid(l.key, `bill-${bi}-ref`)}
                                    value={b.refNote}
                                    disabled={readOnly}
                                    wrapClassName="min-w-0 flex-1"
                                    className="h-8 text-sm"
                                    placeholder={
                                      b.refType === 'ADVANCE'
                                        ? 'What this advance is for (optional)'
                                        : 'What this is against (optional)'
                                    }
                                    onChange={(e) =>
                                      setBill(l, bi, {
                                        refNote: e.target.value,
                                      })
                                    }
                                  />
                                )}
                              </div>
                              <Input
                                id={fid(l.key, `bill-${bi}-amount`)}
                                type="number"
                                step="0.01"
                                min="0"
                                value={b.amount}
                                disabled={readOnly}
                                className="no-spinner h-8 text-sm"
                                onKeyDown={(e) => onBillEnd(i, l, bi, e)}
                                onChange={(e) =>
                                  setBill(l, bi, { amount: e.target.value })
                                }
                              />
                              {/* Which way this one pulls. Nearly always the
                                  line's own side — the exception is the credit
                                  or debit note being adjusted against what is
                                  being settled, which is why it is here at all. */}
                              <div>
                                <SideToggle
                                  id={fid(l.key, `bill-${bi}-side`)}
                                  value={b.side}
                                  disabled={readOnly}
                                  onChange={(side) => setBill(l, bi, { side })}
                                  className={cn(
                                    'h-8 text-xs',
                                    b.side !== l.side &&
                                      'border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400',
                                  )}
                                />
                              </div>
                              <div className="text-center">
                                {!readOnly && l.bills.length > 1 && (
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    className="rounded p-1 text-slate-300 hover:text-rose-600"
                                    title="Remove this bill"
                                    onClick={() =>
                                      setLine(l.key, {
                                        bills: l.bills.filter((_, y) => y !== bi),
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center gap-3 pl-11 text-xs">
                            {!readOnly && (
                              <button
                                type="button"
                                tabIndex={-1}
                                className="text-brand-600 hover:underline"
                                onClick={() => addBill(l, wanted - allocated)}
                              >
                                + Add a bill
                              </button>
                            )}
                            <span
                              className={cn(
                                left === 0 && wanted > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400',
                              )}
                            >
                              {wanted === 0
                                ? 'Enter the line amount first'
                                : left === 0
                                  ? 'Fully allocated'
                                  : `${money(Math.abs(left))} ${
                                      left > 0 ? 'unallocated' : 'over-allocated'
                                    }`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* The foot of the page: the two columns totalled, as they are
                printed, and what is still between them. */}
            <div
              className="grid items-center gap-2 border-t-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/60"
              style={{ gridTemplateColumns: GRID }}
            >
              <span />
              <span className="min-w-0">
                {!readOnly && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="text-xs font-normal text-brand-600 hover:underline"
                    title="Alt+Enter"
                    onClick={addLine}
                  >
                    + Add line
                  </button>
                )}
                <span
                  className={cn(
                    'ml-3 text-xs font-normal',
                    balanced
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {balanced
                    ? 'Balanced'
                    : totals.dr === 0 && totals.cr === 0
                      ? 'Nothing entered yet'
                      : `Out by ${money(Math.abs(totals.diff))}`}
                </span>
              </span>
              <span className="border-t border-slate-400 pt-0.5 text-right tabular-nums">
                {money(totals.dr)}
              </span>
              <span className="border-t border-slate-400 pt-0.5 text-right tabular-nums">
                {money(totals.cr)}
              </span>
              <span />
            </div>
          </div>

          {/* Bottom block — the narration for the voucher as a whole. */}
          <div className="card mt-3 p-4">
            <Textarea
              id={COMMON_NARRATION}
              label="Narration"
              rows={2}
              value={narration}
              disabled={readOnly}
              placeholder="Why this entry was passed"
              onChange={(e) => setNarration(e.target.value)}
            />
          </div>
        </ReadOnlyFieldset>

        {editing?.status === 'CANCELLED' && editing.cancelReason && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Cancelled — {editing.cancelReason}
          </p>
        )}
        <p className="text-xs text-slate-400">
          {activeCompany?.name ?? 'This company'} · Enter moves on · D and C set
          the side · Alt+Enter adds a line · Ctrl+Delete drops one · Ctrl+Enter
          posts.
        </p>
      </div>

      {/* Which bills a settlement clears, chosen from the list of what is
          owed. Several at once — one payment routinely clears several
          invoices, and each has to be recorded against its own bill. */}
      {pickingLine && (
        <BillPicker
          open
          onClose={() => setPicking(null)}
          bills={
            openBills[
              billsKey(
                masters.asksFor(pickingLine.accountId).partyKind,
                pickingLine.partyId,
              )
            ] ?? []
          }
          partyLabel={
            masters
              .partyOptions(
                masters.asksFor(pickingLine.accountId).partyKind,
                pickingLine.accountId,
              )
              .find((p) => p.value === pickingLine.partyId)?.label ?? 'This party'
          }
          lineAmount={pickingLine.amount}
          lineSide={pickingLine.side}
          otherAllocated={netOf(
            pickingLine.bills.filter((_, y) => y !== picking!.billIndex),
            pickingLine.side,
          )}
          initial={
            pickingLine.bills[picking!.billIndex]?.againstId
              ? [
                  {
                    id: Number(pickingLine.bills[picking!.billIndex].againstId),
                    amount: pickingLine.bills[picking!.billIndex].amount,
                    side: pickingLine.bills[picking!.billIndex].side,
                  },
                ]
              : []
          }
          onApply={applyPicks}
        />
      )}
    </div>
  );
}

/**
 * Point the last bill row at whatever the line has left over.
 *
 * A bill stack has to add up to its line exactly — that is what bill-wise
 * tracking IS, and the server refuses the line otherwise. The last row is the
 * balancing figure: it was opened by the form carrying the remainder, so it
 * keeps carrying the remainder as the rows above it change.
 *
 * When there is nothing left over it goes away rather than sitting at nil: the
 * rows above already name the whole line, and an empty one would be one more
 * thing to tab past. The sole row of a stack is never removed, only blanked —
 * a control line always needs somewhere to say which bill it belongs to.
 *
 * A remainder that has gone NEGATIVE means the rows above already exceed the
 * line. The balancing row cannot fix that by going negative too, so it steps
 * out of the way and the over-allocation is left visible, which is the only
 * honest thing to do with a figure only the user can resolve.
 */
function rebalance(
  bills: DraftBill[],
  lineAmount: string,
  lineSide: BalanceSide,
): DraftBill[] {
  if (bills.length === 0) return bills;
  // A settlement is capped by what its bill still owes, so it cannot absorb
  // whatever the line has left. When the stack ends in one, the remainder is
  // the user's to place — into another bill, an advance, or on account.
  if (bills[bills.length - 1].refType === 'AGAINST') return bills;
  const others = netOf(bills.slice(0, -1), lineSide);
  const left = paise(lineAmount) - others;
  // The sign says which way the remainder has to pull. Overshoot the line with
  // the rows above and the balancing row turns into the adjustment that brings
  // it back — which is exactly what it is.
  if (left === 0 && bills.length > 1) return bills.slice(0, -1);
  return [
    ...bills.slice(0, -1),
    {
      ...bills[bills.length - 1],
      side: left < 0 ? otherSide(lineSide) : lineSide,
      amount: left === 0 ? '' : (Math.abs(left) / 100).toFixed(2),
    },
  ];
}

/**
 * Change the line's amount, and let its bills follow.
 *
 * One line against one bill is the ordinary case, and there the allocation is
 * not a second fact to enter — it is the line's own amount, which falls out of
 * the same rule.
 */
function onAmountChange(
  line: JvLine,
  amount: string,
  setLine: (key: number, patch: Partial<JvLine>) => void,
) {
  setLine(line.key, {
    amount,
    bills: rebalance(line.bills, amount, line.side),
  });
}

/**
 * One money column. Both are always drawn — an accountant reads a journal as
 * two columns — but only the line's own side accepts anything, so there is
 * never a question of which figure the line carries. The dead one is disabled
 * rather than hidden, which also takes it out of the keyboard's path.
 */
function AmountCell({
  id,
  active,
  value,
  disabled,
  onChange,
}: {
  id: string;
  active: boolean;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      step="0.01"
      min="0"
      value={active ? value : ''}
      disabled={disabled || !active}
      // No spinner: nobody nudges money a penny at a time with a mouse, and the
      // arrows only steal width from the figure.
      className={cn('no-spinner', !active && 'bg-slate-50 dark:bg-slate-800/40')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Dr or Cr, set by typing the letter.
 *
 * A two-option dropdown would be slower than the thing it replaces: D and C are
 * what an accountant's fingers already do, and a search box over two rows helps
 * nobody. It still counts as a field for Enter-to-advance (`data-field`), so
 * the run through the line is unbroken.
 */
function SideToggle({
  id,
  value,
  disabled,
  onChange,
  className,
}: {
  id: string;
  value: 'DR' | 'CR';
  disabled?: boolean;
  onChange: (v: 'DR' | 'CR') => void;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      data-field=""
      disabled={disabled}
      title="D for debit, C for credit"
      onClick={() => onChange(value === 'DR' ? 'CR' : 'DR')}
      onKeyDown={(e) => {
        const k = e.key.toLowerCase();
        if (k === 'd') {
          e.preventDefault();
          onChange('DR');
        } else if (k === 'c') {
          e.preventDefault();
          onChange('CR');
        } else if (k === ' ' || k === 'arrowup' || k === 'arrowdown') {
          e.preventDefault();
          onChange(value === 'DR' ? 'CR' : 'DR');
        } else if (k === 'enter') {
          e.preventDefault();
          focusNextField(e.currentTarget);
        }
      }}
      className={cn(
        'input-base w-14 flex-none text-center font-semibold text-slate-700 dark:text-slate-200',
        className,
      )}
    >
      {value === 'DR' ? 'Dr' : 'Cr'}
    </button>
  );
}
