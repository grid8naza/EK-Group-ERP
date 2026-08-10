'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  Check,
  FileText,
  Printer,
  Send,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useDocumentLink,
  useFetch,
  useLookupValues,
  useUnsavedChangesGuard,
} from '@/lib/hooks';
import { resolveIcon } from '@/lib/icons';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  DateInput,
  Input,
  MoneyInput,
  Select,
  Textarea,
  focusNextField,
} from '@/components/ui/Field';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { BillPicker, type BillPick } from './BillPicker';
import { RUPEES, type CurrencyWords } from '@/lib/amountWords';
import { fmtDate, openPrintWindow } from '@/lib/docFormat';
import {
  buildChequeHtml,
  buildPaymentAdviceHtml,
  type DocBill,
} from '@/lib/paymentDocs';
import { buildVoucherHtml, type VoucherDocLine } from '@/lib/voucherPrint';
import { WorkflowStallNotice } from '@/components/workflow/StallNotice';
import type {
  BalanceSide,
  BillRefType,
  CoaAccount,
  Company,
  Currency,
  OutstandingBill,
  PartyKind,
  Voucher,
  VoucherLine,
  VoucherType,
  VoucherWorkflowState,
} from '@/lib/types';
import {
  BILL_TYPES,
  type DraftBill,
  type Mode,
  VoucherList,
  accountOption,
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
 * One line of a voucher, as the form holds it.
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
type EntryLine = {
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

const emptyLine = (key: number, side: 'DR' | 'CR' = 'DR', amount = ''): EntryLine => ({
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
const fid = (key: number, part: string) => `ve-${key}-${part}`;
const DATE_FIELD = 've-date';
const COMMON_NARRATION = 've-common-narration';

/**
 * The one column definition the whole voucher is laid out on: side,
 * particulars, the two money columns, the row's own button.
 *
 * Every row of a line — the line itself and its narration — is placed in this
 * same grid, so a narration box ends exactly where the ledger box above it
 * ends. Alignment by shared structure rather than by matching spacer widths,
 * which drift the moment a column changes.
 *
 * The bill rows are the exception, and on purpose: they are packed left on
 * their own widths, because a bill amount sitting under Debit reads as a second
 * debit when it is only part of the one above it.
 */
const GRID = '3.5rem minmax(0,1fr) 8rem 8rem 1.75rem';

/**
 * The gutter the rows UNDER a line start after — wide enough for the longest of
 * the little italic labels that sit in it.
 *
 * One width, shared: the narration box and the bill rows below it are both
 * indented past their own label, and two labels of their own natural widths
 * would start those controls at two different places for no reason anyone
 * reading the voucher could name.
 */
const ROW_LABEL = 'w-[4.5rem] flex-none text-xs italic text-slate-400';
/** The same gutter, for a row with no label of its own to hold it open. */
const ROW_INDENT = 'pl-[5rem]';

const focusById = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.focus());

/**
 * The engine's verbs, as the foot of a voucher says them.
 *
 * A workflow logs what it did — CREATE, FORWARD, APPROVE — which is the right
 * vocabulary for an engine and the wrong one for a signature block. Nobody
 * writes "FORWARD" under a name on a voucher; they write who checked it.
 *
 * Unmapped verbs print as they come. A new action type should read oddly rather
 * than disappear, since a name against a blank role is worse than an ugly one.
 */
const SIGNED_AS: Record<string, string> = {
  CREATE: 'Prepared by',
  FORWARD: 'Checked by',
  REVIEW: 'Reviewed by',
  APPROVE: 'Approved by',
  REJECT: 'Rejected by',
  REFERENCE: 'Seen by',
  CANCEL: 'Cancelled by',
};
const signedAs = (action: string) => SIGNED_AS[action] ?? action;

/** How a chosen bill reads back on the line. Null when none is chosen yet. */
function billLabel(bills: OutstandingBill[], againstId: string): string | null {
  if (!againstId) return null;
  const bill = bills.find((b) => String(b.id) === againstId);
  if (!bill) return 'That bill is no longer outstanding';
  return bill.overdueDays > 0
    ? `${bill.billRef ?? '—'} · ${bill.overdueDays}d overdue`
    : (bill.billRef ?? '—');
}

/**
 * Which ledgers a line may name — the money it is kept in, the party it is kept
 * by, or both where a kind serves both.
 *
 * Naming what a kind is ABOUT rather than listing accounts: the chart is the
 * company's to change, and a screen that named Trade Creditors would be wrong
 * the first time somebody added a second payable.
 */
type LedgerScope = {
  money?: 'CASH' | 'BANK' | Array<'CASH' | 'BANK'>;
  party?: PartyKind | PartyKind[];
  /** The ledgers a post-dated cheque waits in — written out, or taken in. */
  pdc?: 'ISSUED' | 'RECEIVED';
};

const asList = <T,>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** How the money moved, as the form holds it — ids and dates as text. */
type DraftInstrument = {
  modeValueId: string;
  bankAccountId: string;
  instrumentNo: string;
  instrumentDate: string;
  /** Whose bank a cheque taken in was drawn on. Receipts only. */
  issuerBankValueId: string;
  chequeKind: '' | 'CDC' | 'PDC';
};

/**
 * Due now, or due later. Two options and a real difference: a current-dated
 * cheque leaves the bank when it is written, a post-dated one is watched on the
 * PDC register until the day it is presented.
 */
const CHEQUE_KINDS = [
  { value: 'CDC', label: 'Current-dated (CDC)' },
  { value: 'PDC', label: 'Post-dated (PDC)' },
];

/** Written out, because Tailwind reads the class names rather than the number. */
const INSTRUMENT_COLUMNS: Record<number, string> = {
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
};

const EMPTY_INSTRUMENT: DraftInstrument = {
  modeValueId: '',
  bankAccountId: '',
  instrumentNo: '',
  instrumentDate: '',
  issuerBankValueId: '',
  chequeKind: '',
};

export interface VoucherEntryScreenProps {
  /** The one kind this screen writes — a `VoucherType.code`. */
  typeCode: string;
  /** This screen's own route; privileges are keyed on it. */
  route: string;
  title: string;
  description: string;
  icon: string;
  noun: string;
  /**
   * Show what the transaction WAS — the type and subtype — on the header.
   *
   * Present at all: the pair is shown. `type` names the one this kind always
   * is (by its lookup label, e.g. 'Purchase'), which is then fixed rather than
   * asked. `askSubtype` makes the subtype a picker narrowed to that type — the
   * one part of the classification a person still chooses, because which KIND
   * of purchase this was is not something the ledger lines say.
   *
   * With neither, both fields stand disabled: on the kinds an invoice will
   * raise, the document behind the voucher is what will say. See
   * {@link TransactionFields}.
   */
  transaction?: { type?: string; askSubtype?: boolean };
  /**
   * What the FIRST line of this kind always is.
   *
   * Some kinds are named after their first line: a cash receipt is money
   * arriving in the till, so its first line debits a cash account and there is
   * nothing to decide about that — the decision was made in the menu. Fixing it
   * takes two answers off every entry and makes the wrong one impossible.
   *
   * `side` locks the Dr/Cr toggle on that line, and the {@link LedgerScope}
   * narrows its ledger picker — to the cash accounts on a cash receipt, or to
   * the control accounts aged by a party on a purchase, where naming the ledger
   * is what makes the sub-ledger beside it offer the right people. The lines
   * below are ordinary and take whatever the entry needs, unless `lines` says
   * otherwise.
   */
  firstLine?: { side: 'DR' | 'CR' } & LedgerScope;
  /**
   * What EVERY line of this kind may name.
   *
   * For the kinds that are about one thing from top to bottom: a contra moves
   * the company's own money between its own accounts, so both sides of it are
   * cash or bank and an ordinary ledger has no business on either.
   */
  lines?: LedgerScope;
  /**
   * Ask how the money moved — the bank kinds, and nothing else.
   *
   * Cash needs no instrument and a journal moves no money. Here it is the
   * difference between a payment and a record of one: which bank, by what
   * means, on whose cheque. See {@link InstrumentFields}.
   */
  askInstrument?: boolean;
  /**
   * The paper this kind produces, offered on a voucher once it is saved.
   *
   * 'ADVICE' is the sheet the payee is sent — who paid, how much, out of which
   * bank, against which bills. 'CHEQUE' prints onto a pre-printed leaf, and is
   * offered only where the instrument actually is a cheque.
   *
   * Both read the company's own bank details from the ledger the money left, so
   * they belong to the kinds that name a bank. See src/lib/paymentDocs.ts.
   */
  documents?: ('ADVICE' | 'CHEQUE')[];
}

/**
 * A voucher, entered the way a voucher is written.
 *
 * The shape is Tally's, because Tally's shape is the one every accountant who
 * will use this already has in their hands: a date and a reference at the top,
 * then Dr and Cr lines down the page with a narration under each, and the two
 * money columns totalled at the foot. Written for the journal first, it turned
 * out to be the right shape for every kind — a sale, a receipt and a contra are
 * all Dr and Cr lines that must agree — and it is now the form behind all ten,
 * the bank pair included.
 *
 * What each kind adds to it, it adds from its own page: a first line fixed to a
 * side and a set of ledgers, a classification it always carries, the instrument
 * a bank voucher moved by. Nothing here knows what a cash receipt is; every one
 * of those is a prop, so a new kind is a page and not a fork of this file.
 *
 * It is built for the keyboard first. Every picker is searchable, Enter walks
 * forward through the fields, and leaving the last field of the last line while
 * the two columns disagree opens a fresh line already carrying the difference
 * on the opposite side — which is almost always the line the user was about to
 * type. Reaching for the mouse during entry should never be necessary.
 */
export function VoucherEntryScreen({
  typeCode,
  route,
  title,
  description,
  icon,
  noun,
  transaction,
  firstLine,
  lines: lineScope,
  askInstrument = false,
  documents,
}: VoucherEntryScreenProps) {
  const { can, activeCompany, branches } = useAuth();
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

  // The taxonomy, fetched only by the kinds that show it. `useLookupValues`
  // with no code finds no lookup and returns nothing, which is what the other
  // six kinds want.
  const txnTypes = useLookupValues(transaction ? 'TRANSACTION_TYPE' : '');
  const txnSubtypes = useLookupValues(
    transaction?.askSubtype ? 'TRANSACTION_SUBTYPE' : '',
  );
  /** The one type this kind always is, resolved from its label. */
  const txnType = useMemo(
    () =>
      transaction?.type
        ? (txnTypes.find(
            (v) => v.value === transaction.type || v.label === transaction.type,
          ) ?? null)
        : null,
    [txnTypes, transaction?.type],
  );
  // How the money may have moved — the company's own list, fetched only by the
  // kinds that ask.
  const paymentModes = useLookupValues(askInstrument ? 'PAYMENT_MODE' : '');
  /**
   * Money coming IN was sent by somebody, on somebody's bank — the thread a
   * returned cheque is followed back along. Money going out was sent by this
   * company on the bank already named, so there is no second issuer to ask
   * about. The side says which this is.
   */
  const takesIssuer = askInstrument && firstLine?.side === 'DR';
  const issuerBanks = useLookupValues(takesIssuer ? 'ISSUER_BANK' : '');
  const issuerOptions = useMemo(
    () => issuerBanks.map((b) => ({ value: String(b.id), label: b.label })),
    [issuerBanks],
  );
  const modeOptions = useMemo(
    () => paymentModes.map((m) => ({ value: String(m.id), label: m.label })),
    [paymentModes],
  );
  /** The banks this company may draw on. */
  const bankOptions = useMemo(
    () => masters.accounts.filter((a) => a.isBank).map(accountOption),
    [masters.accounts],
  );

  /** The ways of being that type — all a person is asked for. */
  const txnSubtypeOptions = useMemo(
    () =>
      txnType
        ? txnSubtypes
            .filter((v) => v.parentValueId === txnType.id)
            .map((v) => ({ value: String(v.id), label: v.label }))
        : [],
    [txnSubtypes, txnType],
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
  /** Which kind of purchase, sale… — asked for only where `askSubtype` is on. */
  const [txnSubtypeId, setTxnSubtypeId] = useState('');
  /** How the money moved — asked for only where `askInstrument` is on. */
  const [instrument, setInstrument] = useState({ ...EMPTY_INSTRUMENT });

  /**
   * Change the instrument, and keep the money line saying the same thing.
   *
   * The two must agree, and only one of them is a choice. On anything but a
   * post-dated cheque the line IS the bank the instrument names, so it follows
   * it rather than being typed twice and risking a voucher that credits one
   * bank while the cheque was drawn on another. On a post-dated cheque the two
   * genuinely differ — the bank is where it WILL go — so the line is cleared
   * instead, for the narrowed picker to offer the holding ledgers.
   */
  const applyInstrument = (next: DraftInstrument) => {
    setInstrument(next);
    if (!askInstrument) return;
    const postDated = next.chequeKind === 'PDC';
    setLines((ls) => {
      const [first, ...rest] = ls;
      if (!first) return ls;
      const held = masters.accountById.get(Number(first.accountId));
      const wanted = postDated
        ? // A bank account left on a line that has just become post-dated is
          // now the one thing it may not be.
          held && !held.isPdcIssued && !held.isPdcReceived
          ? ''
          : first.accountId
        : next.bankAccountId;
      if (wanted === first.accountId) return ls;
      // A different ledger asks for different things — none of the old answers
      // survive it, exactly as when one is picked by hand.
      return [
        {
          ...first,
          accountId: wanted,
          partyId: '',
          costCenterId: '',
          costObjectId: '',
          bills: [],
        },
        ...rest,
      ];
    });
  };

  /** A cheque is the one mode with anything left to say. */
  const isCheque = useMemo(() => {
    const mode = paymentModes.find(
      (m) => String(m.id) === instrument.modeValueId,
    );
    return mode?.value === 'Cheque' || mode?.label === 'Cheque';
  }, [paymentModes, instrument.modeValueId]);

  const keySeq = useRef(0);
  const nextKey = () => ++keySeq.current;
  // Dr then Cr: a voucher's second line answers its first, and starting both on
  // the same side would mean correcting one of them on every single entry. A
  // kind that fixes its first line says which way round instead.
  const firstSide = firstLine?.side ?? 'DR';
  const [lines, setLines] = useState<EntryLine[]>(() => [
    emptyLine(++keySeq.current, firstSide),
    emptyLine(++keySeq.current, firstSide === 'DR' ? 'CR' : 'DR'),
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

  /**
   * Which ledgers a line may name.
   *
   * A line is narrowed to what its kind is about — the cash accounts on a cash
   * receipt, the payables on a purchase, cash or bank on either side of a
   * contra. Offering the other two hundred ledgers there is offering a mistake.
   * The first line may be narrowed further than the rest.
   *
   * Whatever the line already holds stays on the list even if it does not
   * belong there: a voucher written before the rule, or under a ledger since
   * reclassified, must still read back as what it says rather than as blank.
   */
  const scopeFor = (index: number): LedgerScope | undefined => {
    // On a bank voucher the first line is the money itself, and WHERE it sits
    // follows from the instrument. A post-dated cheque has not reached the bank
    // and waits in a ledger of its own — which one depends on whose cheque it
    // is, and the side says that without being told: money going out is a
    // cheque we wrote, money coming in is one we were given. Anything else —
    // a current-dated cheque, a transfer, a card — moved the bank the day it
    // was entered, so the line is the bank.
    if (index === 0 && askInstrument) {
      return instrument.chequeKind === 'PDC'
        ? { pdc: firstLine?.side === 'DR' ? 'RECEIVED' : 'ISSUED' }
        : { money: 'BANK' };
    }
    return index === 0 && (firstLine?.money || firstLine?.party)
      ? firstLine
      : lineScope;
  };

  /**
   * The money line of an ordinary bank voucher is not a choice at all.
   *
   * The bank was named on the instrument, and this line is that same bank — so
   * it is shown, filled in and locked rather than offered again. Two fields
   * that must hold one answer should be asked once; asking twice only creates
   * the chance of a voucher that credits one bank while the cheque was drawn on
   * another. A post-dated cheque is the exception, where the two are genuinely
   * different accounts.
   */
  const ledgerLocked = (index: number) =>
    index === 0 && askInstrument && instrument.chequeKind !== 'PDC';

  const ledgerOptions = (index: number, selectedId: string) => {
    if (ledgerLocked(index)) {
      // One option, and it is the one already chosen above.
      return masters.accounts
        .filter((a) => String(a.id) === instrument.bankAccountId)
        .map(accountOption);
    }
    const scope = scopeFor(index);
    const monies = asList(scope?.money);
    const parties = asList(scope?.party);
    if (!monies.length && !parties.length && !scope?.pdc) {
      return masters.accountOptions;
    }
    const wanted = (a: CoaAccount) =>
      monies.some((m) => (m === 'CASH' ? a.isCash : a.isBank)) ||
      (a.isControl && !!a.controlParty && parties.includes(a.controlParty)) ||
      (scope?.pdc === 'ISSUED' && a.isPdcIssued) ||
      (scope?.pdc === 'RECEIVED' && a.isPdcReceived);
    return masters.accounts
      .filter((a) => wanted(a) || String(a.id) === selectedId)
      .map(accountOption);
  };

  /** What a narrowed ledger picker calls itself. */
  const ledgerPlaceholder = (index: number) => {
    if (ledgerLocked(index)) return 'Choose the bank account above';
    const scope = scopeFor(index);
    if (scope?.pdc) {
      return scope.pdc === 'ISSUED'
        ? 'Post-dated cheques issued'
        : 'Post-dated cheques received';
    }
    const monies = asList(scope?.money);
    const parties = asList(scope?.party);
    if (monies.length && parties.length) return 'Ledger';
    if (monies.length > 1) return 'Cash or bank account';
    if (monies.length) {
      return monies[0] === 'CASH' ? 'Cash account' : 'Bank account';
    }
    if (parties.length > 1) return 'Supplier or customer ledger';
    if (parties[0] === 'SUPPLIER') return 'Payable ledger';
    if (parties[0] === 'CUSTOMER') return 'Receivable ledger';
    return 'Ledger';
  };

  const canAdd = can(route, 'add');
  const canEdit = can(route, 'edit');
  const canDelete = can(route, 'delete');

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

  /**
   * The voucher as it stood when it was opened, or as it was last saved.
   *
   * A voucher is a page, not a drawer: leaving it is a click on Back, on the
   * sidebar, or a browser refresh, and any of the three would take an unfinished
   * entry with it. Compared against the same fields it was hydrated from, so it
   * says touched-and-different rather than merely touched — retyping a figure
   * back to what it was leaves nothing to warn about.
   */
  const baselineRef = useRef('');
  const snapshot = () =>
    JSON.stringify({ date, reference, narration, txnSubtypeId, instrument, lines });
  /** Take what is on the form now as the clean state. */
  const rebaseline = (
    d: string,
    r: string,
    n: string,
    sub: string,
    inst: DraftInstrument,
    ls: EntryLine[],
  ) => {
    baselineRef.current = JSON.stringify({
      date: d,
      reference: r,
      narration: n,
      txnSubtypeId: sub,
      instrument: inst,
      lines: ls,
    });
  };
  // A posted voucher is read, not written, so only an editable one can be dirty.
  const dirty = () => mode === 'edit' && snapshot() !== baselineRef.current;
  useUnsavedChangesGuard(dirty);

  const startNew = () => {
    const ls = [
      emptyLine(nextKey(), firstSide),
      emptyLine(nextKey(), firstSide === 'DR' ? 'CR' : 'DR'),
    ];
    const d = today();
    setEditing(null);
    setDate(d);
    setReference('');
    setNarration('');
    setLines(ls);
    setTxnSubtypeId('');
    setInstrument({ ...EMPTY_INSTRUMENT });
    rebaseline(d, '', '', '', EMPTY_INSTRUMENT, ls);
    setMode('edit');
    pendingFocus.current = DATE_FIELD;
  };

  const open = (v: Voucher) => {
    const date = v.date.slice(0, 10);
    const reference = v.reference ?? '';
    const narration = v.narration ?? '';
    const sub = v.transactionSubtypeId ? String(v.transactionSubtypeId) : '';
    const inst: DraftInstrument = v.instrument
      ? {
          modeValueId: String(v.instrument.modeValueId),
          bankAccountId: String(v.instrument.bankAccountId),
          instrumentNo: v.instrument.instrumentNo ?? '',
          instrumentDate: v.instrument.instrumentDate?.slice(0, 10) ?? '',
          issuerBankValueId: v.instrument.issuerBankValueId
            ? String(v.instrument.issuerBankValueId)
            : '',
          chequeKind: v.instrument.chequeKind ?? '',
        }
      : { ...EMPTY_INSTRUMENT };
    const ls: EntryLine[] = v.lines.map((l) => ({
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
    }));
    setEditing(v);
    setDate(date);
    setReference(reference);
    setNarration(narration);
    setTxnSubtypeId(sub);
    setInstrument(inst);
    setLines(ls);
    rebaseline(date, reference, narration, sub, inst, ls);
    setMode(v.status === 'DRAFT' ? 'edit' : 'view');
    // A saved voucher's parties already have bills on file; load them so the
    // rows read as bills rather than ids.
    for (const l of v.lines) {
      if (l.partyKind && l.partyId) void loadBills(l.partyKind, String(l.partyId));
    }
  };

  // ---- the paper this kind produces ---------------------------------------------
  //
  // Built from the SAVED voucher rather than from the form: a document says what
  // the books say, and half an edit is not a payment. Everything is on hand
  // already — the party masters and the account master, bank details included,
  // come with `masters`, and the bills came with the voucher.

  // ---- who signs for it ----------------------------------------------------
  //
  // Fetched beside the voucher rather than carried on it, because it is the
  // VIEWER's state and not the document's: two people open the same voucher and
  // only one of them holds a task on it, and it changes when somebody else acts
  // rather than when this form saves. Re-read after every action, which is what
  // moves the buttons on without a reload.
  const {
    data: wf,
    refetch: refetchWorkflow,
  } = useFetch<VoucherWorkflowState>(
    editing ? `/vouchers/${editing.id}/workflow` : null,
    [editing?.id],
  );
  const governed = !!wf?.governed;
  const myTask = wf?.state.myTask ?? null;
  const trail = wf?.state.timeline ?? [];
  /** Sent, and not yet through. Editing it now would change what people signed. */
  const inApproval = wf?.state.status === 'IN_PROGRESS';

  /**
   * A posted voucher is read, not edited — and so is one under approval, unless
   * the step the viewer holds says otherwise. Two people have signed a figure;
   * changing it beneath them would leave their names against an entry they
   * never saw. The engine's own `canEdit` is the exception, for the level whose
   * job IS to correct the entry before passing it on.
   */
  const readOnly = mode === 'view' || (inApproval && !myTask?.canEdit);

  // Every kind prints the voucher itself, so these are fetched once a form is
  // open rather than by the kinds that print something extra — but not on the
  // register, which is most of the time this screen is on and needs neither.
  // The letterhead wants more of the company than the profile carries, and the
  // words on a cheque want the currency's own name for its units.
  const onForm = mode !== 'list';
  const { data: companies } = useFetch<Company[]>(
    onForm ? '/companies' : null,
    [onForm],
  );
  const { data: currencies } = useFetch<Currency[]>(
    onForm ? '/currencies' : null,
    [onForm],
  );

  /** The bank the money left, and this company's own account behind it. */
  const docBank = useMemo(() => {
    const id = editing?.instrument?.bankAccountId;
    return id ? (masters.accountById.get(id) ?? null) : null;
  }, [editing, masters.accountById]);

  /**
   * What to call the units on a document — Rupees and Paise unless the account
   * is held in something else. Never guessed from the company: an account in
   * dirhams pays in dirhams whoever holds it.
   */
  const docCurrency = useMemo((): CurrencyWords => {
    const id = docBank?.bankDetail?.currencyId;
    const c = id ? (currencies ?? []).find((x) => x.id === id) : null;
    if (!c || c.code === 'INR') return RUPEES;
    // "Indian Rupee" → "Rupees": the master names one unit, a cheque writes
    // several. Crude, and right for every currency whose plural is an s.
    return { major: `${c.name}s`, minor: `${c.fractionalUnit}s` };
  }, [docBank, currencies]);

  /** Who is being paid — the party the lines name, or the ledger they name. */
  const docPayee = useMemo(() => {
    if (!editing) return '';
    for (const l of editing.lines) {
      const named = masters.partyName(l.partyKind, l.partyId);
      if (named) return named;
    }
    // No party: a payment to a ledger rather than to somebody with a
    // sub-ledger — bank charges, a tax payment. The ledger IS the payee.
    //
    // Read off the DEBIT side rather than "whichever line is not the bank": on
    // a post-dated cheque no line is the bank at all — the credit goes to the
    // holding ledger — and that test would name Post-dated Cheques Issued as
    // the payee. What is being paid for is always the debit.
    const paid = editing.lines.find((l) => num(l.debit) > 0);
    return paid?.account?.name ?? '';
  }, [editing, masters]);

  /**
   * Which of the payee's bills this settles.
   *
   * An allocation points at the bill it pays by id rather than by number, so
   * the number is read back from the outstanding list the form already loaded.
   * A bill this payment CLEARED is no longer outstanding and will not be found
   * there — it is still shown, by amount, rather than dropped: the payee has to
   * be able to add the lines up to the total whatever we can name.
   */
  const billsOfLine = (l: VoucherLine): DocBill[] =>
    (l.billRefs ?? []).map((b) => {
      const against = b.againstId
        ? (openBills[billsKey(l.partyKind, String(l.partyId ?? ''))] ?? []).find(
            (x) => x.id === b.againstId,
          )
        : null;
      return {
        billRef:
          b.billRef ??
          against?.billRef ??
          b.refNote ??
          (b.refType === 'ADVANCE'
            ? 'Advance'
            : b.refType === 'ON_ACCOUNT'
              ? 'On account'
              : '—'),
        date: against?.date ?? null,
        dueDate: b.dueDate ?? against?.dueDate ?? null,
        amount: num(b.amount),
      };
    });

  const docBills = useMemo(
    (): DocBill[] => (editing?.lines ?? []).flatMap(billsOfLine),
    // billsOfLine reads both of these and nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, openBills],
  );

  /** How the money moved, by the label the company gave the mode. */
  const docMode = useMemo(
    () =>
      paymentModes.find((m) => m.id === editing?.instrument?.modeValueId)
        ?.label ?? null,
    [paymentModes, editing],
  );

  /** A cheque is printable only where the instrument actually is one. */
  const canPrintCheque =
    !!documents?.includes('CHEQUE') && !!editing?.instrument && docMode === 'Cheque';
  const canPrintAdvice = !!documents?.includes('ADVICE') && !!editing;

  /**
   * The branch the voucher was RAISED in — not the one the reader happens to be
   * switched to.
   *
   * They are routinely different. Approval is not branch-scoped: a director on a
   * company-wide workflow signs for every branch, and reading a voucher never
   * required switching to its branch. Taking the name from the active branch
   * printed a Kadathy payment under Head Office, on the sheet that goes in the
   * file as the record of it.
   *
   * Null where the reader cannot see that branch — a name we cannot vouch for is
   * worse than none, and the voucher number already identifies the entry.
   */
  const docBranch = useMemo(
    () =>
      editing?.branchId
        ? (branches.find((b) => b.id === editing.branchId)?.name ?? null)
        : null,
    [editing, branches],
  );

  const docCompany = useMemo(() => {
    const c = (companies ?? []).find((x) => x.id === activeCompany?.id);
    return {
      name: c?.name ?? activeCompany?.name ?? '',
      legalName: c?.legalName,
      address: c?.address,
      city: c?.city,
      state: c?.state,
      phone: c?.phone,
      email: c?.email,
      gstin: c?.gstin,
    };
  }, [companies, activeCompany]);

  /**
   * Send it for approval. Saves first: what the approvers are being shown has
   * to be what is on the screen, and a submit that quietly forwarded the last
   * saved version would be the worst kind of surprise.
   */
  const submitForApproval = async () => {
    if (!balanced) return toast.error('It does not balance yet.');
    const saved = await save(false);
    if (!saved) return;
    setSaving(true);
    try {
      await api.patch(`/vouchers/${saved.id}/submit`, {});
      const [fresh, state] = await Promise.all([
        api.get<Voucher>(`/vouchers/${saved.id}`),
        api.get<VoucherWorkflowState>(`/vouchers/${saved.id}/workflow`),
      ]);
      // Told at the moment it happens, not left to be noticed on the form. A
      // voucher that has stopped dead looks exactly like one on its way, and
      // the difference is a fortnight of everyone assuming somebody else has it.
      if (state.state.stalled) {
        toast.error(
          `Sent, but it has stopped at level ${state.state.currentSequence} — nobody there can act on it.`,
        );
      } else {
        toast.success(
          fresh.status === 'POSTED'
            ? `${fresh.voucherNo} posted.`
            : 'Sent for approval.',
        );
      }
      open(fresh);
      await Promise.all([refetch(), refetchWorkflow()]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to submit.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Approve, forward, reject or cancel the viewer's own task.
   *
   * The engine decides what each of those means on the step it was configured
   * on; this only reports which was taken and re-reads the result. The LAST
   * approval is what writes the voucher to the books — the server does that,
   * not this, because posting is what approval MEANS and it cannot be left to
   * whether a screen remembered to ask.
   */
  const actOnTask = async (
    action: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL',
  ) => {
    // The two that undo somebody's work ask first. Approving and forwarding are
    // the ordinary way through and do not.
    const ask =
      action === 'REJECT'
        ? {
            title: `Reject ${editing?.voucherNo}`,
            message:
              'It goes back to its writer as a draft they may correct and send ' +
              'again. Nothing reaches the books.',
            confirmText: 'Reject',
            cancelText: 'Keep',
          }
        : action === 'CANCEL'
          ? {
              title: `Withdraw ${editing?.voucherNo}`,
              message:
                'It comes back to you as a draft to correct. Whoever has ' +
                'already signed will have to sign again when you send it once ' +
                'more.',
              confirmText: 'Withdraw',
              cancelText: 'Leave it',
            }
          : null;
    if (ask) {
      const ok = await confirm({ ...ask, danger: true, defaultCancel: true });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await api.patch<Voucher>(`/vouchers/${editing!.id}/act`, {
        action,
      });
      // Passing it on can be what stalls it — the level below may have nobody
      // who can act. Whoever just acted is the one person in a position to
      // chase it, so they are the one told.
      const after = await api.get<VoucherWorkflowState>(
        `/vouchers/${editing!.id}/workflow`,
      );
      if (after.state.stalled) {
        toast.error(
          `Done, but it has stopped at level ${after.state.currentSequence} — nobody there can act on it.`,
        );
      } else {
        toast.success(
          res.status === 'POSTED'
            ? `${res.voucherNo} approved and posted.`
            : action === 'CANCEL'
              ? `${res.voucherNo} withdrawn — it is yours to correct again.`
              : action === 'REJECT'
                ? `${res.voucherNo} sent back to its writer.`
                : 'Done.',
        );
      }
      await Promise.all([refetch(), refetchWorkflow()]);
      open(res);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * The voucher itself — every kind, and the one document all ten share.
   *
   * The lines are read off the SAVED voucher and dressed with what only the
   * screen knows: a party is an id on a line and a name in the master, and the
   * same is true of a division and a department. A document showing ids would
   * be a document nobody can check the entry against.
   */
  const printVoucher = () => {
    if (!editing) return;
    const lines: VoucherDocLine[] = editing.lines.map((l) => {
      const debit = num(l.debit);
      return {
        side: debit > 0 ? 'DR' : 'CR',
        accountCode: l.account?.code ?? '',
        accountName: l.account?.name ?? '',
        amount: debit > 0 ? debit : num(l.credit),
        party: masters.partyName(l.partyKind, l.partyId),
        costCentre: masters.centreName(l.costCenterId),
        costObject: masters.objectName(l.costObjectId),
        narration: l.narration,
        bills: billsOfLine(l).map((b) => ({
          label: b.dueDate
            ? `${b.billRef} (due ${fmtDate(b.dueDate)})`
            : b.billRef,
          amount: b.amount,
        })),
      };
    });
    const html = buildVoucherHtml({
      company: docCompany,
      branchName: docBranch,
      kind: title,
      voucherNo: editing.voucherNo,
      date: editing.date,
      status: editing.status,
      cancelReason: editing.cancelReason,
      postedAt: editing.postedAt,
      reference: editing.reference,
      narration: editing.narration,
      transactionType: txnType?.label ?? null,
      transactionSubtype:
        txnSubtypes.find((s) => s.id === editing.transactionSubtypeId)?.label ??
        null,
      mode: docMode,
      instrumentNo: editing.instrument?.instrumentNo ?? null,
      instrumentDate: editing.instrument?.instrumentDate ?? null,
      postDated: editing.instrument?.chequeKind === 'PDC',
      bankLedger: docBank ? `${docBank.code} — ${docBank.name}` : null,
      lines,
      currency: docCurrency,
      // Who signed, where a workflow governs the kind. With none, this is empty
      // and the sheet prints the blank ruled blocks for people to sign by hand.
      // The writer, then everybody who acted after them. CREATE is dropped: it
      // IS the writer, and a sheet naming the same person twice — once as
      // preparer and once as creator — reads as two people.
      //
      // Only a LIVE or approved chain signs. A withdrawn or rejected attempt is
      // history worth keeping on the screen, but printing it would put
      // "Checked by" against a name on a voucher that was pulled back — a
      // signature on a document nobody has agreed to.
      signatories:
        governed &&
        (wf?.state.status === 'IN_PROGRESS' ||
          wf?.state.status === 'APPROVED')
          ? [
              ...(wf?.preparedBy
                ? [
                    {
                      role: 'Prepared by',
                      name: wf.preparedBy,
                      on: wf.preparedOn,
                    },
                  ]
                : []),
              ...trail
                .filter((t) => t.action !== 'CREATE')
                .map((t) => ({
                  role: signedAs(t.action),
                  name: t.userName,
                  on: t.createdAt,
                })),
            ]
          : [],
    });
    if (!openPrintWindow(html)) {
      toast.error('The browser blocked the print window. Allow pop-ups for this site.');
    }
  };

  const printAdvice = () => {
    if (!editing) return;
    const inst = editing.instrument;
    const html = buildPaymentAdviceHtml({
      company: docCompany,
      branchName: docBranch,
      voucherNo: editing.voucherNo,
      date: editing.date,
      status: editing.status,
      payee: docPayee,
      // The two columns agree on a voucher that has been checked, so either
      // says what was paid.
      amount: num(editing.totalDebit),
      currency: docCurrency,
      mode: docMode,
      instrumentNo: inst?.instrumentNo ?? null,
      instrumentDate: inst?.instrumentDate ?? null,
      postDated: inst?.chequeKind === 'PDC',
      bankLedger: docBank ? `${docBank.code} — ${docBank.name}` : null,
      bank: docBank?.bankDetail ?? null,
      bills: docBills,
      reference: editing.reference,
      narration: editing.narration,
    });
    if (!openPrintWindow(html)) {
      toast.error('The browser blocked the print window. Allow pop-ups for this site.');
    }
  };

  const printCheque = () => {
    if (!editing?.instrument) return;
    const inst = editing.instrument;
    const html = buildChequeHtml({
      payee: docPayee,
      amount: num(editing.totalDebit),
      // The date ON the cheque, which on a post-dated one is the day it may be
      // presented rather than the day the voucher was written.
      date: (inst.instrumentDate ?? editing.date).slice(0, 10),
      currency: docCurrency,
      bank: docBank?.bankDetail ?? null,
      bankLedger: docBank ? `${docBank.code} — ${docBank.name}` : null,
      chequeNo: inst.instrumentNo,
      postDated: inst.chequeKind === 'PDC',
    });
    if (!openPrintWindow(html, 980, 560)) {
      toast.error('The browser blocked the print window. Allow pop-ups for this site.');
    }
  };

  /**
   * Opened straight from a link — the approvals inbox sends an id, not a row.
   *
   * Read from the server rather than found in the register: an approver may
   * hold a task on a voucher their listing filters out, and in any case the
   * form wants the full voucher with its lines.
   */
  useDocumentLink((id) => {
    void api
      .get<Voucher>(`/vouchers/${id}`)
      .then(open)
      .catch(() => toast.error('That voucher could not be opened.'));
  });

  // Back to the register. The one deliberate way out of the form, so it asks
  // before dropping an entry that has been written but not saved — the sidebar
  // and a browser refresh are covered by the guard above.
  const closeForm = async () => {
    if (dirty()) {
      const ok = await confirm({
        title: `Leave this ${noun}?`,
        message:
          'What has been entered here has not been saved. Go back and lose it?',
        danger: true,
        confirmText: 'Yes',
        cancelText: 'No',
        defaultCancel: true,
      });
      if (!ok) return;
    }
    setMode('list');
    setEditing(null);
  };

  // ---- editing the lines --------------------------------------------------------

  const setLine = (key: number, patch: Partial<EntryLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /**
   * Say which side a line is — and answer it on the line below.
   *
   * A journal is written in pairs, so naming one side has all but named the
   * other. The line below only takes it while it is still blank and its own
   * side has never been set: a default may be improved on, a decision may not.
   */
  const setSide = (index: number, side: 'DR' | 'CR') => {
    // The fixed first line is not a question; the toggle is disabled, and this
    // is the same answer to anything that reaches past it.
    if (index === 0 && firstLine) return;
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
  };

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
  const setBill = (l: EntryLine, bi: number, patch: Partial<DraftBill>) => {
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
  const addBill = (l: EntryLine, remainderPaise: number) => {
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

  /** The line a fixed kind is built on — never removed, so never offered. */
  const isFixedLine = (key: number) => !!firstLine && lines[0]?.key === key;

  const removeLine = (key: number) => {
    // The first line of a fixed kind IS the kind: a cash receipt without its
    // cash line is not a cash receipt, so it is corrected rather than dropped.
    if (isFixedLine(key)) {
      return toast.error(`The first line is what makes this a ${noun}.`);
    }
    // Two lines is the least a voucher can be; below that there is nothing to
    // balance against.
    if (lines.length <= 2) {
      return toast.error(`A ${noun} needs at least two lines.`);
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
  const onBillEnd = (i: number, l: EntryLine, bi: number, e: React.KeyboardEvent) => {
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
    // Only from the kinds that show it. Left out entirely elsewhere, so a
    // classification an invoice put on a voucher is not wiped by a form that
    // never asked about it — an omitted field is left alone.
    ...(txnType ? { transactionTypeId: txnType.id } : {}),
    ...(transaction?.askSubtype
      ? {
          transactionSubtypeId: txnSubtypeId ? Number(txnSubtypeId) : null,
        }
      : {}),
    ...(askInstrument
      ? {
          instrument: {
            modeValueId: Number(instrument.modeValueId),
            bankAccountId: Number(instrument.bankAccountId),
            instrumentNo: instrument.instrumentNo.trim() || null,
            instrumentDate: instrument.instrumentDate || null,
            // Refused on a payment, where the issuer is this company.
            issuerBankValueId: takesIssuer
              ? Number(instrument.issuerBankValueId) || null
              : null,
            // Only a cheque is post-dated or current-dated; the server refuses
            // the field on anything else.
            chequeKind: isCheque ? instrument.chequeKind || null : null,
          },
        }
      : {}),
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

  /**
   * Write the voucher — as a draft or into the books — and say what happens to
   * the form afterwards.
   *
   * Saving never abandons the voucher. `andNew` is the only thing that clears
   * the form, and it is asked for by its own button: a draft saved mid-entry is
   * work still in hand, and sending it back to the register would make the user
   * find it again to carry on. So the form re-opens on what the server actually
   * stored — which is also how the real voucher number replaces the preview.
   */
  const save = async (
    post: boolean,
    andNew = false,
  ): Promise<Voucher | null> => {
    const payload = body();
    // Every one of these is checked on the server too. Here as well so the
    // answer arrives while the field is still under the cursor rather than
    // after a round trip — and, now that submitting saves first, so that a
    // half-written entry never reaches an approver's inbox.
    const reject = (message: string) => {
      toast.error(message);
      return null;
    };
    if (!payload.voucherTypeId) {
      return reject(`The ${noun} type is not set up yet.`);
    }
    if (payload.lines.length < 2) {
      return reject(`A ${noun} needs at least two lines.`);
    }
    if (post && !balanced) {
      return reject('Debits and credits must agree before posting.');
    }
    if (askInstrument) {
      if (!instrument.modeValueId) return reject('Say how the money moved.');
      if (!instrument.bankAccountId) {
        return reject('Choose the bank account it goes through.');
      }
      if (isCheque) {
        if (!instrument.instrumentNo.trim()) {
          return reject('Give the cheque number.');
        }
        if (!instrument.instrumentDate) {
          return reject('Give the date written on the cheque.');
        }
        if (!instrument.chequeKind) {
          return reject(
            'Say whether the cheque is current-dated or post-dated.',
          );
        }
        if (takesIssuer && !instrument.issuerBankValueId) {
          return reject('Say which bank the cheque is drawn on.');
        }
      }
    }
    setSaving(true);
    try {
      const saved = editing
        ? await api.patch<Voucher>(`/vouchers/${editing.id}`, {
            ...payload,
            post,
          })
        : await api.post<Voucher>('/vouchers', { ...payload, post });
      toast.success(post ? 'Voucher posted.' : 'Draft saved.');
      await Promise.all([refetch(), refetchNextNo()]);
      if (andNew) {
        startNew();
      } else {
        // Re-opening a POSTED voucher lands in view mode by itself — a posted
        // voucher is read, not edited.
        open(saved);
        if (!post) pendingFocus.current = DATE_FIELD;
      }
      // Handed back so submitting can save and then forward the SAME voucher.
      return saved;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
      return null;
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
          // Whose entry this is, said on a SAVED voucher. Approval is not
          // branch-scoped — a director on a company-wide workflow is asked to
          // sign for every branch, and the register lists them all together —
          // so without this an approver is signing an amount and a number.
          editing
            ? [
                docBranch,
                readOnly
                  ? 'Posted — a correction is a fresh voucher, never an edit to this one'
                  : 'Enter moves to the next field. The lines close when the two columns agree.',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Enter moves to the next field. The lines close when the two columns agree.'
        }
        icon={<Icon className="h-5 w-5" />}
        actions={
          // One line, always: the four ways to finish are read as a set, and a
          // row that breaks in two reads as two decisions. The header lets the
          // title wrap instead.
          <div className="flex items-center justify-end gap-2">
            <button className="btn-secondary" onClick={() => void closeForm()}>
              <ArrowLeft className="mr-1 inline h-4 w-4" />
              Back
            </button>
            {/* The paper, on a voucher that exists. All of it prints what was
                SAVED, so it sits apart from the ways of finishing rather than
                among them — and a draft prints marked as one. */}
            {editing && (
              <button
                className="btn-secondary whitespace-nowrap"
                title="Print the voucher — the entry as the books hold it"
                onClick={printVoucher}
              >
                <Printer className="mr-1 inline h-4 w-4" />
                Print
              </button>
            )}
            {canPrintAdvice && (
              <button
                className="btn-secondary whitespace-nowrap"
                title="The advice for the payee — amount, bank and bills settled"
                onClick={printAdvice}
              >
                <FileText className="mr-1 inline h-4 w-4" />
                Advice
              </button>
            )}
            {canPrintCheque && (
              <button
                className="btn-secondary whitespace-nowrap"
                title="Print onto a pre-printed cheque leaf from this bank's book"
                onClick={printCheque}
              >
                <Banknote className="mr-1 inline h-4 w-4" />
                Cheque
              </button>
            )}
            {!readOnly && (
              <>
                {/* Two ways to finish, each with a "and start the next one"
                    twin: a draft is saved to be carried on with, and posting
                    one voucher is usually the start of posting several. */}
                <button
                  className="btn-secondary whitespace-nowrap"
                  disabled={saving}
                  title="Save it as a draft and stay on it"
                  onClick={() => void save(false)}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn-secondary whitespace-nowrap"
                  disabled={saving}
                  title="Save it as a draft and open a fresh voucher"
                  onClick={() => void save(false, true)}
                >
                  Save &amp; New
                </button>
                {/* Where somebody has said who signs for this kind, the button
                    that wrote straight to the ledger becomes the one that sends
                    it to them — and Post & New goes with it, because there is
                    no longer a posting to repeat. */}
                {governed ? (
                  <button
                    className="btn-primary whitespace-nowrap"
                    disabled={saving || !balanced}
                    title={
                      balanced
                        ? `Send it to ${wf?.firstStep?.buttonText ?? 'the next level'} for approval`
                        : 'It does not balance yet'
                    }
                    onClick={() => void submitForApproval()}
                  >
                    <Send className="mr-1 inline h-4 w-4" />
                    {wf?.firstStep?.buttonText || 'Send for approval'}
                  </button>
                ) : (
                  <>
                    <button
                      className="btn-primary whitespace-nowrap"
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
                    <button
                      className="btn-secondary whitespace-nowrap"
                      disabled={saving || !balanced}
                      title={
                        balanced
                          ? 'Write it to the books and open a fresh voucher'
                          : 'It does not balance yet'
                      }
                      onClick={() => void save(true, true)}
                    >
                      Post &amp; New
                    </button>
                  </>
                )}
              </>
            )}
            {/* The writer's way out, on a voucher of their own that is away
                being signed. Not among the approver's buttons below: this is
                the only thing the person who wrote it can still do, and it is
                the opposite of acting on it. */}
            {wf?.canWithdraw && (
              <button
                className="btn-secondary whitespace-nowrap"
                disabled={saving}
                title="Pull it back out of the approval to correct it"
                onClick={() => void actOnTask('CANCEL')}
              >
                <Undo2 className="mr-1 inline h-4 w-4" />
                Withdraw
              </button>
            )}
            {/* The approver's side of the same header. Shown on a voucher the
                viewer holds a task on, whatever mode the form is in — a posted
                voucher is read-only and an approver still has to be able to act
                on the one in front of them. */}
            {myTask && (
              <>
                {myTask.canReject && (
                  <button
                    className="btn-secondary whitespace-nowrap"
                    disabled={saving}
                    title="Send it back to its writer as a draft"
                    onClick={() => void actOnTask('REJECT')}
                  >
                    <X className="mr-1 inline h-4 w-4" />
                    Reject
                  </button>
                )}
                <button
                  className="btn-primary whitespace-nowrap"
                  disabled={saving}
                  title={
                    myTask.canApprove
                      ? 'Approve it — the last approval writes it to the books'
                      : 'Beyond your limit: you may review it and pass it up'
                  }
                  onClick={() =>
                    void actOnTask(myTask.canApprove ? 'APPROVE' : 'FORWARD')
                  }
                >
                  <Check className="mr-1 inline h-4 w-4" />
                  {myTask.buttonText}
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
          // mouse once the narration has the caret. It does whatever the
          // primary button does, so the shortcut does not quietly go on trying
          // to post where posting is no longer how a voucher is finished.
          if (!(e.ctrlKey || e.metaKey) || saving || !balanced) return;
          e.preventDefault();
          if (governed) void submitForApproval();
          else void save(true);
        }}
      >
        <ReadOnlyFieldset readOnly={readOnly}>
          {/* Top block. Date, the number the voucher will take, a reference —
              and, on the kinds an invoice will raise, what that invoice said
              the transaction was. Nowhere else: the lines say what the voucher
              did, and a taxonomy typed above them only repeats it. */}
          <div
            className={cn(
              'card grid grid-cols-1 gap-4 p-4 sm:grid-cols-3',
              // Five fields on one row where there is room for five, so the
              // whole header is read at a glance rather than in two passes.
              transaction && 'xl:grid-cols-5',
            )}
          >
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
              id="ve-reference"
              label="Reference"
              value={reference}
              disabled={readOnly}
              placeholder="Advice no, bill no, resolution…"
              onChange={(e) => setReference(e.target.value)}
            />
            {transaction && (
              <TransactionFields
                // The kind's own type where it has one; otherwise whatever the
                // voucher already carries, which is nothing until an invoice
                // raises it.
                typeLabel={
                  txnType?.label ??
                  txnTypes.find((v) => v.id === editing?.transactionTypeId)
                    ?.label ??
                  ''
                }
                subtypeId={txnSubtypeId}
                subtypeOptions={txnSubtypeOptions}
                askSubtype={!!transaction.askSubtype}
                readOnlySubtypeLabel={
                  txnSubtypes.find(
                    (v) => v.id === editing?.transactionSubtypeId,
                  )?.label ?? ''
                }
                disabled={readOnly}
                onSubtypeChange={setTxnSubtypeId}
              />
            )}
          </div>

          {/* How the money actually moved. Its own block under the header,
              because it is a different kind of fact from the entry: the lines
              say what the payment DID, this says what carried it. */}
          {askInstrument && (
            <div
              className={cn(
                'card mt-3 grid grid-cols-1 gap-4 p-4 sm:grid-cols-3',
                // As many columns as there are fields, so the block is one row
                // wherever there is room for one. How many there are depends on
                // the mode and the kind — a transfer asks four questions, a
                // cheque taken in asks six — and a fixed count would leave one
                // field stranded on a line of its own.
                INSTRUMENT_COLUMNS[
                  4 + (isCheque ? 1 : 0) + (takesIssuer && isCheque ? 1 : 0)
                ],
              )}
            >
              <Select
                label="Mode"
                required
                value={instrument.modeValueId}
                disabled={readOnly}
                options={modeOptions}
                placeholder={modeOptions.length ? 'How it moved' : 'None set up'}
                onChange={(e) =>
                  applyInstrument({
                    ...instrument,
                    modeValueId: e.target.value,
                    // Only a cheque is dated and numbered; changing away from
                    // one takes its answers with it rather than sending them.
                    chequeKind: '',
                  })
                }
              />
              <Select
                label="Bank account"
                required
                value={instrument.bankAccountId}
                disabled={readOnly}
                options={bankOptions}
                placeholder={bankOptions.length ? 'Drawn on' : 'No bank account'}
                onChange={(e) =>
                  applyInstrument({ ...instrument, bankAccountId: e.target.value })
                }
              />
              <Input
                label={isCheque ? 'Cheque no' : 'Reference no'}
                required={isCheque}
                value={instrument.instrumentNo}
                disabled={readOnly}
                placeholder={isCheque ? 'e.g. 004512' : 'UTR, advice no…'}
                onChange={(e) =>
                  setInstrument({ ...instrument, instrumentNo: e.target.value })
                }
              />
              <DateInput
                label={isCheque ? 'Cheque date' : 'Instrument date'}
                required={isCheque}
                value={instrument.instrumentDate}
                disabled={readOnly}
                onChange={(v) =>
                  setInstrument({ ...instrument, instrumentDate: v })
                }
              />
              {/* Whose cheque it is. Only where money is coming in: on a
                  payment the issuer is this company and the bank is named
                  above. */}
              {takesIssuer && isCheque && (
                <Select
                  label="Issuer bank"
                  required
                  value={instrument.issuerBankValueId}
                  disabled={readOnly}
                  options={issuerOptions}
                  placeholder={
                    issuerOptions.length ? 'Drawn on' : 'None set up'
                  }
                  onChange={(e) =>
                    setInstrument({
                      ...instrument,
                      issuerBankValueId: e.target.value,
                    })
                  }
                />
              )}
              {isCheque && (
                <div>
                  <Select
                    label="Due"
                    required
                    value={instrument.chequeKind}
                    disabled={readOnly}
                    options={CHEQUE_KINDS}
                    placeholder="Now or later?"
                    onChange={(e) =>
                      applyInstrument({
                        ...instrument,
                        chequeKind: e.target.value as 'CDC' | 'PDC' | '',
                      })
                    }
                  />
                  {instrument.chequeKind === 'PDC' && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Post it to Post-dated Cheques Issued, not to the bank — the
                      bank is credited from the PDC register on the day it
                      clears.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

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
                      {/* Locked on the first line of a kind that names it —
                          a cash receipt's cash line is a debit by definition,
                          and there is nothing there to get wrong. */}
                      <SideToggle
                        id={fid(l.key, 'side')}
                        value={l.side}
                        disabled={readOnly || (i === 0 && !!firstLine)}
                        onChange={(side) => setSide(i, side)}
                      />

                      <div className="flex min-w-0 flex-wrap items-start gap-2">
                        <Select
                          id={fid(l.key, 'ledger')}
                          value={l.accountId}
                          disabled={readOnly || ledgerLocked(i)}
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
                          options={ledgerOptions(i, l.accountId)}
                          placeholder={ledgerPlaceholder(i)}
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
                        {!readOnly && lines.length > 2 && !isFixedLine(l.key) && (
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
                        <label className={ROW_LABEL}>Narration</label>
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
                            /* Packed left, and deliberately NOT on the line's
                               columns: a bill amount under Debit reads as a
                               second debit, when it is only part of the one
                               above it. Reference, amount and side stay
                               together, well inside the money columns, so the
                               eye sees a detail of the line rather than another
                               line. */
                            <div key={bi} className="flex flex-wrap items-center gap-2">
                              {/* Held open even when empty, or the second bill
                                  row would start further left than the first. */}
                              <span className={ROW_LABEL}>
                                {bi === 0 ? 'Bills' : ''}
                              </span>
                              <Select
                                id={fid(l.key, `bill-${bi}-type`)}
                                value={b.refType}
                                disabled={readOnly}
                                wrapClassName="w-40 flex-none"
                                onChange={(e) => {
                                  const refType = e.target.value as BillRefType;
                                  // The amount goes with the reference. It
                                  // was the outstanding on the bill that was
                                  // picked, or what an advance was for —
                                  // either way it belonged to the OLD kind of
                                  // row, and carrying it into the new one
                                  // quietly allocates a figure nobody typed
                                  // for the thing now named.
                                  setBill(l, bi, {
                                    refType,
                                    billRef: '',
                                    refNote: '',
                                    againstId: '',
                                    amount: '',
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
                                  wrapClassName="w-56 flex-none"
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
                                    'input-base h-8 w-56 flex-none truncate text-left text-sm',
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
                                  wrapClassName="w-56 flex-none"
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
                              <MoneyInput
                                id={fid(l.key, `bill-${bi}-amount`)}
                                value={b.amount}
                                disabled={readOnly}
                                wrapClassName="w-32 flex-none"
                                className="h-8 text-sm"
                                onKeyDown={(e) => onBillEnd(i, l, bi, e)}
                                onChange={(amount) => setBill(l, bi, { amount })}
                              />
                              {/* Which way this one pulls. Nearly always the
                                  line's own side — the exception is the credit
                                  or debit note being adjusted against what is
                                  being settled, which is why it is here at all.
                                  Kept beside the amount it applies to. */}
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
                          <div
                            className={cn(
                              'flex items-center gap-3 text-xs',
                              ROW_INDENT,
                            )}
                          >
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
          </div>

          {/* The foot of the page: the two columns totalled, as they are
              printed, and what is still between them.

              Frozen to the bottom of the form, and outside the lines card to be
              able to: `overflow-hidden` on that card would pin a sticky child
              inside it and it would never move. So the totals stay in view
              however long the voucher grows — on a twenty-line entry, whether
              the two columns agree is the one thing worth always seeing. */}
          <div
            className="card sticky bottom-0 z-10 grid items-center gap-2 border-slate-400 bg-slate-50 px-3 py-1.5 text-sm font-semibold shadow-sm dark:border-slate-500 dark:bg-slate-800"
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
            {/* No rule above the figures: the box around the totals already
                says these are the totals, and a second line under the last
                amount only crowds it. */}
            <span className="text-right tabular-nums">{money(totals.dr)}</span>
            <span className="text-right tabular-nums">{money(totals.cr)}</span>
            <span />
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

        {/* Who has signed, in the order they did. On the form rather than only
            on the printed voucher, because the question "where has this got
            to?" is asked far more often than the sheet is printed. */}
        {(trail.length > 0 || inApproval) && (
          <div className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Approval trail
              </p>
              {editing?.workflowStatus && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  {editing.workflowStatus}
                </span>
              )}
            </div>
            <ol className="mt-3 space-y-2">
              {/* The writer first. The engine's trail starts at the step they
                  acted on, and on a workflow whose first level is somebody
                  else it would otherwise begin with the reviewer — leaving the
                  sheet with no answer to who prepared it. */}
              {wf?.preparedBy && (
                <li className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                  <div>
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      Prepared
                    </span>
                    <span className="text-slate-500">
                      {' '}
                      — {wf.preparedBy}
                      {wf.preparedOn ? ` · ${fmtDate(wf.preparedOn)}` : ''}
                    </span>
                  </div>
                </li>
              )}
              {trail
                .filter((t) => t.action !== 'CREATE')
                .map((t) => (
                  <li key={t.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {signedAs(t.action)}
                      </span>
                      <span className="text-slate-500">
                        {' '}
                        — {t.userName} · {fmtDate(t.createdAt)}
                      </span>
                      {t.comment && (
                        <p className="text-slate-500">“{t.comment}”</p>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
            {/* Waiting on nobody is not the same as waiting on somebody, and
                saying the second when the first is true is how a voucher sits
                for a fortnight while everyone assumes it is with the next
                level. */}
            {inApproval && !myTask && wf?.state.stalled && (
              <WorkflowStallNotice
                className="mt-3"
                sequence={wf.state.currentSequence}
              >
                {wf.canWithdraw && 'You may also withdraw it.'}
              </WorkflowStallNotice>
            )}
            {inApproval && !myTask && !wf?.state.stalled && (
              <p className="mt-3 text-xs text-slate-400">
                Waiting on the next level. It reaches the books when the last
                approver has signed, not before.
                {wf?.canWithdraw &&
                  ' You may withdraw it while it is still with them.'}
              </p>
            )}
          </div>
        )}

        {editing?.status === 'CANCELLED' && editing.cancelReason && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Cancelled — {editing.cancelReason}
          </p>
        )}
        <p className="text-xs text-slate-400">
          {activeCompany?.name ?? 'This company'} · Enter moves on · D and C set
          the side · Alt+Enter adds a line · Ctrl+Delete drops one · Ctrl+Enter{' '}
          {governed ? 'sends it for approval' : 'posts'}.
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
  line: EntryLine,
  amount: string,
  setLine: (key: number, patch: Partial<EntryLine>) => void,
) {
  setLine(line.key, {
    amount,
    bills: rebalance(line.bills, amount, line.side),
  });
}

/**
 * What the transaction WAS.
 *
 * The TYPE is never asked: a purchase voucher records a purchase, and a field
 * offering nine answers to a question the menu already settled is a field that
 * will one day be answered wrongly. It is shown, disabled, so a reader can see
 * what the voucher is filed as — and on the kinds an invoice will raise, where
 * even the type comes from the document, it stands empty saying where the
 * answer is meant to come from.
 *
 * The SUBTYPE is the part a person still chooses, on the kinds that ask: which
 * KIND of purchase this was — intercompany, B2B, B2C — is not something the
 * ledger lines say, and nothing else on the form can work it out. Narrowed to
 * the subtypes belonging to the type, so the pair cannot disagree.
 */
function TransactionFields({
  typeLabel,
  subtypeId,
  subtypeOptions,
  askSubtype,
  readOnlySubtypeLabel,
  disabled,
  onSubtypeChange,
}: {
  typeLabel: string;
  subtypeId: string;
  subtypeOptions: { value: string; label: string }[];
  askSubtype: boolean;
  readOnlySubtypeLabel: string;
  disabled: boolean;
  onSubtypeChange: (id: string) => void;
}) {
  return (
    <>
      <Input
        label="Transaction type"
        value={typeLabel}
        placeholder="From the invoice that raises it"
        disabled
        readOnly
      />
      {askSubtype ? (
        <Select
          label="Transaction subtype"
          value={subtypeId}
          disabled={disabled}
          options={subtypeOptions}
          placeholder={
            subtypeOptions.length ? 'Which kind?' : 'None set up for this type'
          }
          onChange={(e) => onSubtypeChange(e.target.value)}
        />
      ) : (
        <Input
          label="Transaction subtype"
          value={readOnlySubtypeLabel}
          placeholder="From the invoice that raises it"
          disabled
          readOnly
        />
      )}
    </>
  );
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
    <MoneyInput
      id={id}
      value={active ? value : ''}
      disabled={disabled || !active}
      className={cn(!active && 'bg-slate-50 dark:bg-slate-800/40')}
      onChange={onChange}
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
