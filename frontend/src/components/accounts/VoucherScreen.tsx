'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFetch, useLookupValues } from '@/lib/hooks';
import { resolveIcon } from '@/lib/icons';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Drawer, DrawerFooter } from '@/components/ui/Drawer';
import type {
  BalanceSide,
  BillRefType,
  OutstandingBill,
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
  today,
  useVoucherMasters,
} from './voucher-common';

export interface VoucherScreenProps {
  /** The one kind this screen writes — a `VoucherType.code` (e.g. CASH_RECEIPT). */
  typeCode: string;
  /** This screen's own route. Privileges are keyed on it, so it must match the
      scaffold entry exactly. */
  route: string;
  title: string;
  description: string;
  /** Sidebar icon name, resolved the same way the menu resolves it. */
  icon: string;
  /** Singular noun for messages — "cash receipt", "journal voucher". */
  noun: string;
}

/** A line as the form holds it — amounts as text until they are saved. */
type DraftLine = {
  accountId: string;
  side: 'DR' | 'CR';
  amount: string;
  costCenterId: string;
  costObjectId: string;
  narration: string;
  /** Empty = take the header's. Only a subtype is overridden per line; the type
      is whatever that subtype belongs to. */
  txnSubtypeId: string;
  /** Whose balance the line moves. Asked for only on a control account. */
  partyId: string;
  /** Which of that party's bills the amount belongs to. */
  bills: DraftBill[];
};

const emptyLine = (): DraftLine => ({
  accountId: '',
  side: 'DR',
  amount: '',
  costCenterId: '',
  costObjectId: '',
  narration: '',
  txnSubtypeId: '',
  partyId: '',
  bills: [],
});

/**
 * One kind of voucher, on its own screen.
 *
 * The kind is settled by the menu the user came through, not by a dropdown on
 * the form — so this component is given it and never offers to change it. That
 * is also what lets each kind be customised later: a screen passes its own
 * heading and, in time, its own extra fields, without the other nine inheriting
 * them.
 *
 * A voucher is a balanced statement, so the form is built around that one fact:
 * the totals sit under the lines and Post is refused until they agree. A draft
 * is scratch paper and may be rewritten or thrown away; once posted it is a
 * record, and the only thing left to do with it is cancel it — which marks it
 * and keeps it, because the books have to say what they said.
 */
export function VoucherScreen({
  typeCode,
  route,
  title,
  description,
  icon,
  noun,
}: VoucherScreenProps) {
  const { can, activeCompany } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const Icon = resolveIcon(icon);

  const { data: types } = useFetch<VoucherType[]>('/vouchers/types');
  const masters = useVoucherMasters();
  // What the transaction WAS, over and above which voucher recorded it. One
  // global taxonomy, shared with stock movements and documents.
  const txnTypes = useLookupValues('TRANSACTION_TYPE');
  const txnSubtypes = useLookupValues('TRANSACTION_SUBTYPE');

  // The kind's id in THIS database — the screen knows its code, the server
  // assigns the id.
  const voucherType = useMemo(
    () => (types ?? []).find((t) => t.code === typeCode) ?? null,
    [types, typeCode],
  );

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  // Filtered by code rather than id, so the list is right on first paint
  // instead of showing every kind until the type master arrives.
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

  const [mode, setMode] = useState<Mode>('list');
  const [editing, setEditing] = useState<Voucher | null>(null);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState('');
  const [txnTypeId, setTxnTypeId] = useState('');
  const [txnSubtypeId, setTxnSubtypeId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  /** Only the subtypes belonging to the chosen type — a Sale is never a B2B
      purchase, and the server refuses the pair anyway. */
  const subtypesOfType = useMemo(
    () =>
      txnTypeId
        ? txnSubtypes.filter((s) => String(s.parentValueId ?? '') === txnTypeId)
        : [],
    [txnSubtypes, txnTypeId],
  );
  const txnLabel = useMemo(
    () => new Map(txnSubtypes.map((s) => [s.id, s.label])),
    [txnSubtypes],
  );

  const canAdd = can(route, 'add');
  const canEdit = can(route, 'edit');
  const canDelete = can(route, 'delete');

  const startNew = () => {
    setEditing(null);
    setDate(today());
    setNarration('');
    setTxnTypeId('');
    setTxnSubtypeId('');
    setLines([emptyLine(), emptyLine()]);
    setMode('edit');
  };

  const open = (v: Voucher, next: Mode) => {
    setEditing(v);
    setDate(v.date.slice(0, 10));
    setNarration(v.narration ?? '');
    setTxnTypeId(v.transactionTypeId ? String(v.transactionTypeId) : '');
    setTxnSubtypeId(
      v.transactionSubtypeId ? String(v.transactionSubtypeId) : '',
    );
    setLines(
      v.lines.map((l) => ({
        accountId: String(l.accountId),
        side: num(l.debit) > 0 ? 'DR' : 'CR',
        amount: String(num(l.debit) > 0 ? num(l.debit) : num(l.credit)),
        costCenterId: l.costCenterId ? String(l.costCenterId) : '',
        costObjectId: l.costObjectId ? String(l.costObjectId) : '',
        narration: l.narration ?? '',
        // Only a line that says something DIFFERENT from the header is an
        // override; one that merely matches was inherited and stays so.
        txnSubtypeId:
          l.transactionSubtypeId &&
          l.transactionSubtypeId !== v.transactionSubtypeId
            ? String(l.transactionSubtypeId)
            : '',
        partyId: l.partyId ? String(l.partyId) : '',
        bills: (l.billRefs ?? []).map((b) => ({
          refType: b.refType,
          // This form does not offer adjustments, but it must not lose one
          // written elsewhere. Null means the row predates the column, and
          // those all went the way of their line.
          side: b.side ?? ((num(l.debit) > 0 ? 'DR' : 'CR') as BalanceSide),
          billRef: b.billRef ?? '',
          refNote: b.refNote ?? '',
          againstId: b.againstId ? String(b.againstId) : '',
          amount: String(b.amount),
        })),
      })),
    );
    setMode(next);
  };

  // ---- bill-wise editor -------------------------------------------------------
  // Which line's bill stack is open, and that party's still-standing bills. The
  // outstanding list is fetched when the editor opens rather than up front: it
  // is per party, and most lines never need it.
  const [billsFor, setBillsFor] = useState<number | null>(null);
  const [openBills, setOpenBills] = useState<OutstandingBill[]>([]);

  const openBillEditor = async (i: number) => {
    const l = lines[i];
    const account = masters.accountById.get(Number(l.accountId));
    setBillsFor(i);
    setOpenBills([]);
    if (!account?.controlParty || !l.partyId) return;
    try {
      setOpenBills(
        await api.get<OutstandingBill[]>(
          `/vouchers/bills?partyKind=${account.controlParty}&partyId=${l.partyId}`,
        ),
      );
    } catch {
      setOpenBills([]);
    }
  };

  const setBill = (li: number, bi: number, patch: Partial<DraftBill>) =>
    setLines((ls) =>
      ls.map((l, x) =>
        x === li
          ? { ...l, bills: l.bills.map((b, y) => (y === bi ? { ...b, ...patch } : b)) }
          : l,
      ),
    );

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      const amount = Math.round(num(l.amount) * 100);
      if (l.side === 'DR') dr += amount;
      else cr += amount;
    }
    return { dr: dr / 100, cr: cr / 100, diff: (dr - cr) / 100 };
  }, [lines]);
  const balanced = totals.diff === 0 && totals.dr > 0;

  const body = () => ({
    voucherTypeId: voucherType?.id ?? 0,
    date,
    narration,
    transactionTypeId: txnTypeId ? Number(txnTypeId) : undefined,
    transactionSubtypeId: txnSubtypeId ? Number(txnSubtypeId) : undefined,
    lines: lines
      .filter((l) => l.accountId && num(l.amount) > 0)
      .map((l) => ({
        accountId: Number(l.accountId),
        debit: l.side === 'DR' ? num(l.amount) : 0,
        credit: l.side === 'CR' ? num(l.amount) : 0,
        costCenterId: l.costCenterId ? Number(l.costCenterId) : undefined,
        costObjectId: l.costObjectId ? Number(l.costObjectId) : undefined,
        narration: l.narration || undefined,
        // Sent only when overridden; otherwise the server applies the header's.
        transactionSubtypeId: l.txnSubtypeId
          ? Number(l.txnSubtypeId)
          : undefined,
        partyId: l.partyId ? Number(l.partyId) : undefined,
        bills: l.bills.length
          ? l.bills
              .filter((b) => num(b.amount) > 0)
              .map((b) => ({
                refType: b.refType,
                side: b.side,
                billRef: b.refType === 'NEW' ? b.billRef.trim() : undefined,
                // Not offered on this form, but carried through so re-saving a
                // draft written elsewhere does not drop what it was called.
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
      await refetch();
      setMode('list');
      setEditing(null);
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
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // ---- listing ----------------------------------------------------------------

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
        onOpen={(v) => open(v, v.status === 'DRAFT' ? 'edit' : 'view')}
        onPost={(v) => void postExisting(v)}
        onCancel={(v) => void cancel(v)}
        onDelete={(v) => void remove(v)}
        canAdd={canAdd}
        canEdit={canEdit}
        canDelete={canDelete}
        // What the transaction WAS, ahead of the line count — on these kinds it
        // is the thing that tells two otherwise identical vouchers apart.
        subLabel={(v) =>
          [
            v.transactionSubtypeId
              ? txnLabel.get(v.transactionSubtypeId) ?? '—'
              : '',
            `${v.lines.length} line${v.lines.length === 1 ? '' : 's'}`,
            v.lines[0]?.account
              ? `${v.lines[0].account.code} ${v.lines[0].account.name}`
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
        }
      />
    );
  }

  // ---- entry form -------------------------------------------------------------

  const readOnly = mode === 'view';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={editing ? `${editing.voucherNo} — ${title}` : `New ${title}`}
        description={
          readOnly
            ? 'Posted — a correction is a fresh voucher, never an edit to this one'
            : 'Every line carries one side. The voucher posts once the two agree.'
        }
        icon={<Icon className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setMode('list');
                setEditing(null);
              }}
            >
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
                  title={balanced ? 'Write it to the books' : 'It does not balance yet'}
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
        {/* No voucher-type field — the menu already decided the kind. What the
            transaction WAS is a separate question, and this is where it is
            answered: the subtype list follows the type above it. */}
        <div className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-4">
          <Input
            type="date"
            label="Date"
            required
            value={date}
            disabled={readOnly}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="Transaction type"
            value={txnTypeId}
            disabled={readOnly}
            onChange={(e) => {
              setTxnTypeId(e.target.value);
              // The old subtype belonged to the old type — it cannot survive.
              setTxnSubtypeId('');
              setLines((ls) => ls.map((l) => ({ ...l, txnSubtypeId: '' })));
            }}
            options={txnTypes.map((t) => ({
              value: String(t.id),
              label: t.label,
            }))}
            placeholder="Not classified"
          />
          <Select
            label="Transaction subtype"
            value={txnSubtypeId}
            disabled={readOnly || !txnTypeId}
            onChange={(e) => setTxnSubtypeId(e.target.value)}
            options={subtypesOfType.map((s) => ({
              value: String(s.id),
              label: s.label,
            }))}
            placeholder={txnTypeId ? 'Any' : 'Choose a type first'}
          />
          <Textarea
            label="Narration"
            rows={1}
            value={narration}
            disabled={readOnly}
            onChange={(e) => setNarration(e.target.value)}
          />
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-[24%] px-3 py-2 text-left">Account</th>
                <th className="w-[16%] px-3 py-2 text-left">Party</th>
                <th className="w-[8%] px-3 py-2 text-left">Dr/Cr</th>
                <th className="w-[14%] px-3 py-2 text-right">Amount</th>
                <th className="w-[14%] px-3 py-2 text-left">Cost Centre</th>
                <th className="w-[14%] px-3 py-2 text-left">Cost Object</th>
                {txnTypeId && (
                  <th className="w-[14%] px-3 py-2 text-left">Transaction</th>
                )}
                <th className="w-[10%] px-3 py-2 text-left">Bills</th>
                <th className="px-3 py-2 text-left">Narration</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const asks = masters.asksFor(l.accountId);
                const centreOptions = masters.centreOptions;
                const objectOptions = masters.objectOptions(l.costCenterId);
                return (
                  <tr
                    key={i}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="px-2 py-1.5">
                      <Select
                        value={l.accountId}
                        disabled={readOnly}
                        onChange={(e) =>
                          setLine(i, {
                            accountId: e.target.value,
                            costCenterId: '',
                            costObjectId: '',
                            // A different account may be kept by a different
                            // party, or by none.
                            partyId: '',
                            bills: [],
                          })
                        }
                        options={masters.accountOptions}
                        placeholder="Choose an account"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Only where the account is a control account — its
                          balance is a total, and this is whose. */}
                      {asks.party ? (
                        <Select
                          value={l.partyId}
                          disabled={readOnly}
                          onChange={(e) =>
                            // The bills belonged to the old party.
                            setLine(i, { partyId: e.target.value, bills: [] })
                          }
                          options={masters.partyOptions(asks.partyKind, l.accountId)}
                          placeholder={
                            asks.partyKind === 'SUPPLIER'
                              ? 'Which supplier'
                              : asks.partyKind === 'CUSTOMER'
                                ? 'Which customer'
                                : 'Master not built yet'
                          }
                        />
                      ) : (
                        <span className="px-1 text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={l.side}
                        disabled={readOnly}
                        onChange={(e) =>
                          setLine(i, { side: e.target.value as 'DR' | 'CR' })
                        }
                        options={[
                          { value: 'DR', label: 'Dr' },
                          { value: 'CR', label: 'Cr' },
                        ]}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.amount}
                        disabled={readOnly}
                        onChange={(e) => setLine(i, { amount: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Offered only where the account asks for it — the same
                          two checkpoints the server enforces. */}
                      {asks.centre ? (
                        <Select
                          value={l.costCenterId}
                          disabled={readOnly}
                          onChange={(e) =>
                            setLine(i, {
                              costCenterId: e.target.value,
                              costObjectId: '',
                            })
                          }
                          options={centreOptions}
                          placeholder="Required"
                        />
                      ) : (
                        <span className="px-1 text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {asks.object ? (
                        <Select
                          value={l.costObjectId}
                          disabled={readOnly || !l.costCenterId}
                          onChange={(e) =>
                            setLine(i, { costObjectId: e.target.value })
                          }
                          options={objectOptions}
                          placeholder={l.costCenterId ? 'Required' : 'Centre first'}
                        />
                      ) : (
                        <span className="px-1 text-xs text-slate-300">—</span>
                      )}
                    </td>
                    {/* Offered only once the header says what this is. Blank
                        means "as the header" — one voucher may still carry a
                        B2B line beside a B2C one. */}
                    {txnTypeId && (
                      <td className="px-2 py-1.5">
                        <Select
                          value={l.txnSubtypeId}
                          disabled={readOnly}
                          onChange={(e) =>
                            setLine(i, { txnSubtypeId: e.target.value })
                          }
                          options={subtypesOfType.map((s) => ({
                            value: String(s.id),
                            label: s.label,
                          }))}
                          placeholder={
                            txnSubtypeId
                              ? txnLabel.get(Number(txnSubtypeId)) ?? 'As header'
                              : 'As header'
                          }
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      {/* The bill stack, on a control line only. The label is
                          the check itself: allocated against the line. */}
                      {asks.party ? (
                        (() => {
                          const alloc = l.bills.reduce(
                            (t, b) => t + Math.round(num(b.amount) * 100),
                            0,
                          );
                          const want = Math.round(num(l.amount) * 100);
                          const agree = alloc === want && want > 0;
                          return (
                            <button
                              type="button"
                              disabled={!l.partyId}
                              onClick={() => void openBillEditor(i)}
                              title={
                                l.partyId
                                  ? 'Which bills this amount belongs to'
                                  : 'Choose the party first'
                              }
                              className={cn(
                                'w-full rounded border px-2 py-1 text-xs',
                                !l.partyId
                                  ? 'border-slate-200 text-slate-300 dark:border-slate-700'
                                  : agree
                                    ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                                    : 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40',
                              )}
                            >
                              {l.bills.length === 0
                                ? 'Set bills'
                                : agree
                                  ? `${l.bills.length} bill${l.bills.length === 1 ? '' : 's'}`
                                  : `Out by ${money(Math.abs(want - alloc) / 100)}`}
                            </button>
                          );
                        })()
                      ) : (
                        <span className="px-1 text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={l.narration}
                        disabled={readOnly}
                        onChange={(e) => setLine(i, { narration: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {!readOnly && lines.length > 2 && (
                        <button
                          className="rounded p-1 text-slate-400 hover:text-rose-600"
                          title="Remove this line"
                          onClick={() =>
                            setLines((ls) => ls.filter((_, x) => x !== i))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800/60">
                <td className="px-3 py-2" colSpan={3}>
                  {!readOnly && (
                    <button
                      className="text-xs font-normal text-brand-600 hover:underline"
                      onClick={() => setLines((ls) => [...ls, emptyLine()])}
                    >
                      + Add line
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <div className="text-slate-500">Dr {money(totals.dr)}</div>
                  <div className="text-slate-500">Cr {money(totals.cr)}</div>
                </td>
                <td className="px-3 py-2" colSpan={txnTypeId ? 6 : 5}>
                  <span
                    className={cn(
                      'text-sm',
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
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {editing?.status === 'CANCELLED' && editing.cancelReason && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Cancelled — {editing.cancelReason}
          </p>
        )}
        <p className="text-xs text-slate-400">
          {activeCompany?.name ?? 'This company'} · a cost centre or object is
          asked for only where the account calls for one.
        </p>
      </div>

      {/* Bill-wise details for one line. A party's balance is a stack of bills,
          and this is where the line's amount is spread across them. */}
      <Drawer
        open={billsFor !== null}
        onClose={() => setBillsFor(null)}
        title="Bill-wise details"
        subtitle={
          billsFor !== null
            ? `Line ${billsFor + 1} · ${money(lines[billsFor]?.amount ?? 0)}`
            : undefined
        }
        width="lg"
        footer={
          <DrawerFooter
            onCancel={() => setBillsFor(null)}
            onSave={() => setBillsFor(null)}
            saveLabel="Done"
          />
        }
      >
        {billsFor !== null &&
          (() => {
            const li = billsFor;
            const l = lines[li];
            const alloc = l.bills.reduce(
              (t, b) => t + Math.round(num(b.amount) * 100),
              0,
            );
            const want = Math.round(num(l.amount) * 100);
            const left = (want - alloc) / 100;
            return (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Every part of this line has to say which bill it belongs to.
                  Raise a <b>new bill</b> for an invoice, post{' '}
                  <b>against a bill</b> to settle one, or leave it{' '}
                  <b>on account</b> when the bill is not yet known — that is an
                  answer, not a gap, and it stays visible as unallocated.
                </p>

                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="w-[26%] px-2 py-2 text-left">Method</th>
                      <th className="px-2 py-2 text-left">Bill</th>
                      <th className="w-[22%] px-2 py-2 text-right">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {l.bills.map((b, bi) => (
                      <tr
                        key={bi}
                        className="border-t border-slate-100 dark:border-slate-800"
                      >
                        <td className="px-2 py-1.5">
                          <Select
                            value={b.refType}
                            disabled={readOnly}
                            onChange={(e) =>
                              setBill(li, bi, {
                                refType: e.target.value as BillRefType,
                                billRef: '',
                                againstId: '',
                              })
                            }
                            options={BILL_TYPES}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {b.refType === 'NEW' ? (
                            <Input
                              value={b.billRef}
                              disabled={readOnly}
                              placeholder="Bill number, e.g. INV-001"
                              onChange={(e) =>
                                setBill(li, bi, { billRef: e.target.value })
                              }
                            />
                          ) : b.refType === 'AGAINST' ? (
                            <Select
                              value={b.againstId}
                              disabled={readOnly}
                              onChange={(e) => {
                                const picked = openBills.find(
                                  (o) => String(o.id) === e.target.value,
                                );
                                setBill(li, bi, {
                                  againstId: e.target.value,
                                  // Default to clearing it, capped by what is
                                  // still unallocated on this line.
                                  amount: picked
                                    ? String(
                                        Math.min(
                                          picked.pending,
                                          Math.max(
                                            picked.pending,
                                            num(b.amount) || picked.pending,
                                          ),
                                        ),
                                      )
                                    : b.amount,
                                });
                              }}
                              options={openBills.map((o) => ({
                                value: String(o.id),
                                label: `${o.billRef} · ${money(o.pending)} pending${
                                  o.overdueDays > 0
                                    ? ` · ${o.overdueDays}d overdue`
                                    : ''
                                }`,
                              }))}
                              placeholder={
                                openBills.length
                                  ? 'Which bill'
                                  : 'Nothing outstanding'
                              }
                            />
                          ) : (
                            <span className="text-xs text-slate-400">
                              Attached to no bill
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={b.amount}
                            disabled={readOnly}
                            onChange={(e) =>
                              setBill(li, bi, { amount: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {!readOnly && (
                            <button
                              className="rounded p-1 text-slate-400 hover:text-rose-600"
                              title="Remove"
                              onClick={() =>
                                setLine(li, {
                                  bills: l.bills.filter((_, y) => y !== bi),
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex items-center justify-between">
                  {!readOnly && (
                    <button
                      className="text-xs text-brand-600 hover:underline"
                      onClick={() =>
                        setLine(li, {
                          bills: [
                            ...l.bills,
                            // Seed the amount with whatever is still unspread,
                            // which is the answer most of the time. This form
                            // does not offer adjustments, so a row it opens
                            // always goes the way of its line.
                            {
                              ...emptyBill(l.side),
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
                      'text-sm',
                      left === 0 && want > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {want === 0
                      ? 'Enter the line amount first'
                      : left === 0
                        ? 'Fully allocated'
                        : `${money(Math.abs(left))} ${left > 0 ? 'unallocated' : 'over-allocated'}`}
                  </span>
                </div>
              </div>
            );
          })()}
      </Drawer>
    </div>
  );
}
