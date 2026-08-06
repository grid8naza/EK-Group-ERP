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
import type {
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
  num,
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

const focusById = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.focus());

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
  const [lines, setLines] = useState<JvLine[]>(() => [
    emptyLine(++keySeq.current),
    emptyLine(++keySeq.current),
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
    setLines([emptyLine(nextKey()), emptyLine(nextKey())]);
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
        side: num(l.debit) > 0 ? 'DR' : 'CR',
        accountId: String(l.accountId),
        partyId: l.partyId ? String(l.partyId) : '',
        costCenterId: l.costCenterId ? String(l.costCenterId) : '',
        costObjectId: l.costObjectId ? String(l.costObjectId) : '',
        amount: String(num(l.debit) > 0 ? num(l.debit) : num(l.credit)),
        narration: l.narration ?? '',
        bills: (l.billRefs ?? []).map((b) => ({
          refType: b.refType,
          billRef: b.billRef ?? '',
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

  const setBill = (key: number, bi: number, patch: Partial<DraftBill>) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? { ...l, bills: l.bills.map((b, y) => (y === bi ? { ...b, ...patch } : b)) }
          : l,
      ),
    );

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

  const removeLine = (key: number) => {
    // Two lines is the least a voucher can be; below that there is nothing to
    // balance against.
    if (lines.length <= 2) {
      return toast.error('A journal needs at least two lines.');
    }
    setLines((ls) => ls.filter((l) => l.key !== key));
  };

  /**
   * Leaving the last field of a line.
   *
   * Within the voucher it simply moves to the next line. On the LAST line it is
   * the decision point: if the two columns still disagree the entry is not
   * finished, so a line opens for the rest of it; if they agree, the lines are
   * done and focus drops to the narration that closes the voucher.
   */
  const onLineEnd = (i: number, e: React.KeyboardEvent) => {
    const enter = e.key === 'Enter';
    const tab = e.key === 'Tab' && !e.shiftKey;
    if (!enter && !tab) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (i < lines.length - 1) {
      // Enter is the fast path — it jumps straight to the next line's Dr/Cr.
      // Tab is left alone so it keeps its ordinary meaning.
      if (enter) {
        e.preventDefault();
        focusById(fid(lines[i + 1].key, 'side'));
      }
      return;
    }
    if (balanced) {
      if (enter) {
        e.preventDefault();
        focusById(COMMON_NARRATION);
      }
      return;
    }
    e.preventDefault();
    addLine();
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
                billRef: b.refType === 'NEW' ? b.billRef.trim() : undefined,
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
          // Ctrl+Enter accepts the voucher from anywhere on the form — the one
          // shortcut worth knowing, and the only way to finish without the
          // mouse once the narration has the caret.
          if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
          if (readOnly || saving || !balanced) return;
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
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              <span className="w-14 flex-none">Dr/Cr</span>
              <span className="min-w-0 flex-1">Particulars</span>
              <span className="w-32 flex-none text-right">Debit</span>
              <span className="w-32 flex-none text-right">Credit</span>
              <span className="w-7 flex-none" />
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {lines.map((l, i) => {
                const asks = masters.asksFor(l.accountId);
                const bills = openBills[billsKey(asks.partyKind, l.partyId)] ?? [];
                const showBills = asks.party && !!l.partyId;
                const allocated = l.bills.reduce((t, b) => t + paise(b.amount), 0);
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
                    <div className="flex items-start gap-2">
                      <SideToggle
                        id={fid(l.key, 'side')}
                        value={l.side}
                        disabled={readOnly}
                        onChange={(side) => setLine(l.key, { side })}
                      />

                      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
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
                                  ? [{ ...emptyBill(), amount: l.amount }]
                                  : [],
                              });
                            }}
                            options={masters.partyOptions(asks.partyKind)}
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

                      <div className="w-7 flex-none pt-1.5 text-center">
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
                    </div>

                    {/* The line's own narration, on its own line under it. */}
                    <div className="mt-1.5 flex items-center gap-2 pl-16">
                      <label className="w-20 flex-none text-xs italic text-slate-400">
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
                        onChange={(e) => setLine(l.key, { narration: e.target.value })}
                      />
                      {/* Holds the two money columns and the row's own button
                          clear of the narration, so Debit and Credit stay one
                          straight edge down the page. */}
                      <span className="w-[18.75rem] flex-none" />
                    </div>

                    {/* Bill-wise details, under the narration, on the ledgers
                        that are kept bill by bill. Every part of the line has
                        to say which bill it belongs to — that is what bill-wise
                        tracking IS, and the server refuses the line without it. */}
                    {showBills && (
                      <div className="mt-1.5 space-y-1 pl-16">
                        {l.bills.map((b, bi) => (
                          <div key={bi} className="flex items-center gap-2">
                            <span className="w-20 flex-none text-xs italic text-slate-400">
                              {bi === 0 ? 'Bill details' : ''}
                            </span>
                            <Select
                              id={fid(l.key, `bill-${bi}-type`)}
                              value={b.refType}
                              disabled={readOnly}
                              wrapClassName="w-40 flex-none"
                              searchThreshold={4}
                              onChange={(e) =>
                                setBill(l.key, bi, {
                                  refType: e.target.value as BillRefType,
                                  billRef: '',
                                  againstId: '',
                                })
                              }
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
                                  setBill(l.key, bi, { billRef: e.target.value })
                                }
                              />
                            ) : b.refType === 'AGAINST' ? (
                              <Select
                                id={fid(l.key, `bill-${bi}-ref`)}
                                value={b.againstId}
                                disabled={readOnly}
                                wrapClassName="min-w-0 flex-1"
                                onChange={(e) => {
                                  const picked = bills.find(
                                    (o) => String(o.id) === e.target.value,
                                  );
                                  setBill(l.key, bi, {
                                    againstId: e.target.value,
                                    // Default to clearing it in full — the
                                    // common case, and still editable.
                                    amount: picked
                                      ? String(picked.pending)
                                      : b.amount,
                                  });
                                }}
                                options={bills.map((o) => ({
                                  value: String(o.id),
                                  label: `${o.billRef} · ${money(o.pending)} pending${
                                    o.overdueDays > 0
                                      ? ` · ${o.overdueDays}d overdue`
                                      : ''
                                  }`,
                                }))}
                                placeholder={
                                  bills.length ? 'Which bill' : 'Nothing outstanding'
                                }
                              />
                            ) : (
                              <span className="min-w-0 flex-1 text-xs text-slate-400">
                                Attached to no bill
                              </span>
                            )}
                            <Input
                              id={fid(l.key, `bill-${bi}-amount`)}
                              type="number"
                              step="0.01"
                              min="0"
                              value={b.amount}
                              disabled={readOnly}
                              wrapClassName="w-32 flex-none"
                              className="h-8 text-sm"
                              onKeyDown={(e) => {
                                if (bi !== l.bills.length - 1) return;
                                onLineEnd(i, e);
                              }}
                              onChange={(e) =>
                                setBill(l.key, bi, { amount: e.target.value })
                              }
                            />
                            <div className="w-7 flex-none text-center">
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
                            <span className="w-32 flex-none" />
                          </div>
                        ))}
                        <div className="flex items-center gap-3 pl-[5.5rem] text-xs">
                          {!readOnly && (
                            <button
                              type="button"
                              tabIndex={-1}
                              className="text-brand-600 hover:underline"
                              onClick={() =>
                                setLine(l.key, {
                                  bills: [
                                    ...l.bills,
                                    // Seeded with whatever is still unspread,
                                    // which is the answer most of the time.
                                    {
                                      ...emptyBill(),
                                      amount: left > 0 ? String(left) : '',
                                    },
                                  ],
                                })
                              }
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
                );
              })}
            </div>

            {/* The foot of the page: the two columns totalled, as they are
                printed, and what is still between them. */}
            <div className="flex items-center gap-2 border-t-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/60">
              <span className="w-14 flex-none" />
              <span className="min-w-0 flex-1">
                {!readOnly && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="text-xs font-normal text-brand-600 hover:underline"
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
              <span className="w-32 flex-none border-t border-slate-400 pt-0.5 text-right tabular-nums">
                {money(totals.dr)}
              </span>
              <span className="w-32 flex-none border-t border-slate-400 pt-0.5 text-right tabular-nums">
                {money(totals.cr)}
              </span>
              <span className="w-7 flex-none" />
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
          the side · Ctrl+Delete drops a line · Ctrl+Enter posts.
        </p>
      </div>
    </div>
  );
}

/**
 * Keep the sole bill allocation in step with the line it belongs to.
 *
 * One line against one bill is the ordinary case, and there the allocation is
 * not a second fact to enter — it is the line's own amount. The moment a second
 * bill is added the line is being split deliberately, and nothing is touched
 * again.
 */
function onAmountChange(
  line: JvLine,
  amount: string,
  setLine: (key: number, patch: Partial<JvLine>) => void,
) {
  setLine(line.key, {
    amount,
    bills:
      line.bills.length === 1
        ? [{ ...line.bills[0], amount }]
        : line.bills,
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
      wrapClassName="w-32 flex-none"
      className={cn(!active && 'bg-slate-50 dark:bg-slate-800/40')}
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
}: {
  id: string;
  value: 'DR' | 'CR';
  disabled?: boolean;
  onChange: (v: 'DR' | 'CR') => void;
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
      className="input-base w-14 flex-none text-center font-semibold text-slate-700 dark:text-slate-200"
    >
      {value === 'DR' ? 'Dr' : 'Cr'}
    </button>
  );
}
