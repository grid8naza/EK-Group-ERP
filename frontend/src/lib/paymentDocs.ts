/**
 * The two pieces of paper a payment produces: the advice that tells the payee
 * the money is on its way, and the cheque itself.
 *
 * Both are built as standalone documents in their own window rather than as
 * components on the screen, for the same reason the recipe sheet is: what
 * matters is what comes out of the printer. The cheque especially — it prints
 * onto a leaf somebody else designed, at millimetre positions, and a layout
 * inherited from the application's stylesheet would be at the mercy of every
 * change made to it.
 *
 * Both take the company's OWN bank account from the ledger the payment was
 * drawn on — see BankAccountDetail, which is per company because the chart is
 * shared and the bank account is not.
 */

import { amountInWords, type CurrencyWords, RUPEES } from './amountWords';
import { esc, fmtDate, money } from './docFormat';
import type { BankAccountDetail } from './types';

/**
 * A bank account number on a document that leaves the building.
 *
 * Last four only. The payee reconciles against the cheque or UTR number, never
 * against our account number, so the whole of it on an outgoing advice is a
 * detail given away for nothing. The drawer holds it in full for the people who
 * maintain it.
 */
const maskAccountNo = (no: string) =>
  no.length <= 4 ? no : `••••${no.slice(-4)}`;

/** How the company identifies itself at the head of the advice. */
export interface DocCompany {
  name: string;
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
}

/** One bill the payment settles. */
export interface DocBill {
  billRef: string;
  date?: string | null;
  dueDate?: string | null;
  amount: number;
}

export interface PaymentAdviceInput {
  company: DocCompany;
  branchName?: string | null;
  voucherNo: string;
  date: string;
  status: string;
  /** Who is being paid — the party named on the lines, where there is one. */
  payee: string;
  amount: number;
  currency?: CurrencyWords;
  /** How it moved: Cheque, NEFT, RTGS… and the number written on it. */
  mode?: string | null;
  instrumentNo?: string | null;
  instrumentDate?: string | null;
  /** True where the cheque is post-dated, which changes what the advice says. */
  postDated?: boolean;
  /** The ledger the money left, and this company's bank behind it. */
  bankLedger?: string | null;
  bank?: BankAccountDetail | null;
  bills: DocBill[];
  reference?: string | null;
  narration?: string | null;
}

/**
 * The advice, as a single sheet: who paid, who is being paid, how much, how it
 * moved, and which of the payee's bills it settles.
 *
 * The bank block is the point of it. Told only the amount, a payee with three
 * bills outstanding and two of our companies to reconcile has to ring somebody;
 * told the bank, the branch and the cheque number, they can match the credit
 * themselves the day it lands.
 */
export function buildPaymentAdviceHtml(p: PaymentAdviceInput): string {
  const currency = p.currency ?? RUPEES;
  const where = [p.company.address, p.company.city, p.company.state]
    .filter(Boolean)
    .join(', ');
  const contact = [p.company.phone, p.company.email].filter(Boolean).join('  ·  ');

  const bankRows = p.bank
    ? [
        ['Bank', [p.bank.bankName, p.bank.branchName].filter(Boolean).join(', ')],
        ['Account', maskAccountNo(p.bank.accountNumber)],
        // Only the codes this account actually carries: a blank IBAN row on a
        // domestic payment is a question the payee does not need to ask.
        p.bank.ifscCode ? ['IFSC', p.bank.ifscCode] : null,
        p.bank.swiftCode ? ['SWIFT / BIC', p.bank.swiftCode] : null,
        p.bank.iban ? ['IBAN', p.bank.iban] : null,
      ].filter(Boolean)
    : [];

  const bankBlock = p.bank
    ? `<table class="kv">${(bankRows as string[][])
        .map(
          ([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : `<p class="muted">No bank details are recorded against ${esc(
        p.bankLedger ?? 'this ledger',
      )}. Add them on the account, under Account Ledgers.</p>`;

  const billRows = p.bills.length
    ? p.bills
        .map(
          (b) => `<tr>
        <td>${esc(b.billRef)}</td>
        <td>${esc(fmtDate(b.date))}</td>
        <td>${esc(fmtDate(b.dueDate))}</td>
        <td class="r">${money(b.amount)}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="muted">Not settled against particular bills.</td></tr>`;

  const billsTotal = p.bills.reduce((s, b) => s + b.amount, 0);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Payment Advice — ${esc(p.voucherNo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
  h1 { font-size: 17px; margin: 0; letter-spacing: .06em; text-transform: uppercase; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #334155; padding-bottom: 12px; }
  .co b { font-size: 15px; display: block; }
  .co span { color: #64748b; font-size: 11px; display: block; margin-top: 2px; }
  .doc { text-align: right; white-space: nowrap; }
  .doc span { color: #64748b; font-size: 11px; display: block; margin-top: 4px; }
  .draft { display: inline-block; margin-top: 4px; border: 1px solid #b45309; color: #b45309; padding: 1px 6px; border-radius: 3px; font-size: 10px; letter-spacing: .08em; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #475569; margin: 20px 0 6px; }
  .cols { display: flex; gap: 20px; align-items: stretch; }
  .cols > div { flex: 1; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: bold; }
  table.kv th { width: 38%; color: #475569; font-weight: normal; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; background: #f1f5f9; }
  .amount { border: 1px solid #cbd5e1; background: #f8fafc; padding: 10px 12px; border-radius: 6px; }
  .amount b { font-size: 20px; font-variant-numeric: tabular-nums; }
  .amount span { display: block; color: #475569; font-size: 11px; margin-top: 4px; }
  .muted { color: #94a3b8; }
  .note { margin-top: 14px; font-size: 11px; color: #475569; }
  .sign { margin-top: 42px; display: flex; justify-content: flex-end; }
  .sign div { width: 200px; border-top: 1px solid #94a3b8; padding-top: 4px; text-align: center; color: #64748b; font-size: 11px; }
  .foot { margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 10px; color: #94a3b8; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="head">
    <div class="co">
      <b>${esc(p.company.legalName || p.company.name)}</b>
      ${where ? `<span>${esc(where)}</span>` : ''}
      ${contact ? `<span>${esc(contact)}</span>` : ''}
      ${p.company.gstin ? `<span>GSTIN ${esc(p.company.gstin)}</span>` : ''}
    </div>
    <div class="doc">
      <h1>Payment Advice</h1>
      <span>No. ${esc(p.voucherNo)}</span>
      <span>Date ${esc(fmtDate(p.date))}</span>
      ${p.branchName ? `<span>${esc(p.branchName)}</span>` : ''}
      ${p.status !== 'POSTED' ? `<div class="draft">${esc(p.status)}</div>` : ''}
    </div>
  </div>

  <h2>To</h2>
  <div><b>${esc(p.payee)}</b></div>

  <div class="cols" style="margin-top:16px">
    <div>
      <h2>Amount</h2>
      <div class="amount">
        <b>${money(p.amount)}</b>
        <span>${esc(amountInWords(p.amount, currency))}</span>
      </div>
    </div>
    <div>
      <h2>Paid from</h2>
      ${bankBlock}
    </div>
  </div>

  <h2>How it was paid</h2>
  <table class="kv">
    <tr><th>Ledger</th><td>${esc(p.bankLedger ?? '—')}</td></tr>
    <tr><th>Mode</th><td>${esc(p.mode ?? '—')}</td></tr>
    <tr><th>Instrument no</th><td>${esc(p.instrumentNo || '—')}</td></tr>
    <tr><th>Instrument date</th><td>${esc(fmtDate(p.instrumentDate) || '—')}</td></tr>
    ${p.reference ? `<tr><th>Reference</th><td>${esc(p.reference)}</td></tr>` : ''}
  </table>
  ${
    p.postDated
      ? `<p class="note">This is a post-dated cheque. It may be presented on or
         after ${esc(fmtDate(p.instrumentDate))}, and the amount will leave the
         bank on the day it is cleared, not the date of this advice.</p>`
      : ''
  }

  <h2>Bills settled</h2>
  <table>
    <thead><tr><th>Bill</th><th>Date</th><th>Due</th><th class="r">Amount</th></tr></thead>
    <tbody>${billRows}</tbody>
    ${
      p.bills.length
        ? `<tfoot><tr><td colspan="3" class="r">Total</td><td class="r">${money(
            billsTotal,
          )}</td></tr></tfoot>`
        : ''
    }
  </table>

  ${p.narration ? `<p class="note"><b>Narration:</b> ${esc(p.narration)}</p>` : ''}

  <div class="sign"><div>For ${esc(p.company.name)}</div></div>
  <div class="foot">
    This advice is issued for information. It is not a receipt, and it does not
    itself transfer money.
  </div>

  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;
}

// ---- the cheque -------------------------------------------------------------

/**
 * Where each field sits on a CTS-2010 leaf, in millimetres from the top-left.
 *
 * CTS-2010 standardised the SIZE of a cheque (200mm × 92mm) and the broad
 * placement of its fields, which is what makes one layout possible at all; it
 * did not standardise them to the millimetre, and no two banks' leaves agree
 * exactly. So these are a starting position, and every bank account carries its
 * own nudge (BankAccountDetail.chequeOffsetX / Y) to bring them onto its own
 * leaves. Print one on plain paper, hold it against a leaf, and adjust.
 *
 * Only what a person writes is printed. The bank's name, the branch, the
 * account number and the MICR band are already on the paper — printing them
 * again would land them on top of themselves.
 */
export const CHEQUE_LAYOUT = {
  width: 200,
  height: 92,
  /** The eight date boxes across the top right, and the pitch between them. */
  date: { x: 154.5, y: 11, boxWidth: 5.2 },
  payee: { x: 22, y: 25, width: 150 },
  /** Two lines, because a large amount in words does not fit on one. */
  words1: { x: 30, y: 34, width: 145 },
  words2: { x: 12, y: 41, width: 163 },
  figures: { x: 158, y: 41, width: 36 },
} as const;

/**
 * The amount in words across the leaf's two lines.
 *
 * Broken after a scale word — crore, lakh, thousand, hundred — wherever one
 * falls inside the first line's width, because that is where the number itself
 * has a joint. Breaking merely on the last space is legible but reads badly:
 * it leaves "Sixty" at the end of one line and "Seven" at the start of the
 * next, which on the half of a cheque a bank actually pays on is worth the few
 * lines of code to avoid. Falls back to the last space, then to a hard cut.
 */
function splitWords(s: string, max: number): [string, string] {
  if (s.length <= max) return [s, ''];
  const joints = [...s.matchAll(/ (?:Crore|Lakh|Thousand|Hundred) /g)]
    .map((m) => m.index + m[0].length - 1)
    .filter((i) => i > 0 && i <= max);
  const cut = joints.length ? joints[joints.length - 1] : s.lastIndexOf(' ', max);
  return cut < 0
    ? [s.slice(0, max), s.slice(max)]
    : [s.slice(0, cut), s.slice(cut + 1)];
}

export interface ChequeInput {
  payee: string;
  amount: number;
  /** The date written ON the cheque — for a post-dated one, the day it may go. */
  date: string;
  currency?: CurrencyWords;
  /** Which chequebook to load. Not printed — the leaf says it already. */
  bank?: BankAccountDetail | null;
  bankLedger?: string | null;
  chequeNo?: string | null;
  postDated?: boolean;
  /** Draw the leaf's outline and field guides on screen (never printed). */
  guides?: boolean;
}

/**
 * A cheque, positioned for a pre-printed leaf.
 *
 * The window shows the leaf at its true size with guides on, so the operator can
 * see what will land where before committing a leaf to the printer; the guides
 * are screen-only and the print carries nothing but the writing.
 *
 * The amount in words is what the bank pays on where the two disagree, so it is
 * printed in full and closed with "Only" — see amountInWords.
 */
export function buildChequeHtml(c: ChequeInput): string {
  const currency = c.currency ?? RUPEES;
  const L = CHEQUE_LAYOUT;
  const dx = c.bank?.chequeOffsetX ?? 0;
  const dy = c.bank?.chequeOffsetY ?? 0;

  // DDMMYYYY, one digit per pre-printed box.
  const [y, m, d] = c.date.slice(0, 10).split('-');
  const digits = `${d ?? ''}${m ?? ''}${y ?? ''}`.slice(0, 8).split('');

  const [w1, w2] = splitWords(amountInWords(c.amount, currency), 58);

  const at = (
    pos: { x: number; y: number; width?: number },
    cls: string,
    text: string,
  ) =>
    `<div class="f ${cls}" style="left:${pos.x + dx}mm; top:${pos.y + dy}mm;${
      pos.width ? ` width:${pos.width}mm;` : ''
    }">${esc(text)}</div>`;

  const dateBoxes = digits
    .map(
      (ch, i) =>
        `<div class="f date" style="left:${
          L.date.x + dx + i * L.date.boxWidth
        }mm; top:${L.date.y + dy}mm;">${esc(ch)}</div>`,
    )
    .join('');

  const guideBoxes = [
    ['payee', L.payee],
    ['words1', L.words1],
    ['words2', L.words2],
    ['figures', L.figures],
  ]
    .map(
      ([name, pos]) =>
        `<div class="guide" title="${name as string}" style="left:${
          (pos as { x: number }).x + dx
        }mm; top:${(pos as { y: number }).y + dy - 4}mm; width:${
          (pos as { width: number }).width
        }mm;"></div>`,
    )
    .join('');

  const which = c.bank
    ? `${c.bank.bankName}${c.bank.branchName ? `, ${c.bank.branchName}` : ''} · A/c ${maskAccountNo(
        c.bank.accountNumber,
      )}`
    : (c.bankLedger ?? 'No bank recorded against this ledger');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cheque — ${esc(c.chequeNo || c.payee)}</title>
<style>
  @page { size: ${L.width}mm ${L.height}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #f1f5f9; }
  .bar { padding: 10px 14px; font-size: 12px; color: #1e293b; background: #fff; border-bottom: 1px solid #cbd5e1; }
  .bar b { display: block; font-size: 13px; }
  .bar span { color: #64748b; }
  .bar button { margin-top: 8px; margin-right: 6px; font: inherit; padding: 4px 12px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
  .bar button.primary { background: #047857; border-color: #047857; color: #fff; }
  .sheet { position: relative; width: ${L.width}mm; height: ${L.height}mm; margin: 16px auto; background: #fff; }
  .sheet.outline { outline: 1px dashed #94a3b8; }
  .f { position: absolute; font-size: 11pt; line-height: 1; white-space: nowrap; overflow: hidden; }
  .f.date { font-size: 11pt; letter-spacing: 0; font-family: "Courier New", monospace; }
  .f.payee { font-size: 12pt; }
  .f.figures { font-weight: bold; }
  .guide { position: absolute; height: 5mm; outline: 1px dotted #cbd5e1; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { margin: 0; outline: none; }
    .guide { display: none; }
  }
</style>
</head>
<body>
  <div class="bar">
    <b>Load the chequebook for ${esc(which)}</b>
    <span>
      Leaf ${L.width} × ${L.height}mm${
        c.chequeNo ? ` · cheque no ${esc(c.chequeNo)}` : ''
      }${c.postDated ? ' · post-dated' : ''}. Print at 100% — any "fit to page"
      shifts every field. The dotted guides are on screen only. If it lands off,
      correct the alignment on the bank account rather than here, and every
      cheque on this book follows.
    </span>
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="document.querySelector('.sheet').classList.toggle('outline')">
      Toggle leaf outline
    </button>
  </div>

  <div class="sheet outline">
    ${c.guides === false ? '' : guideBoxes}
    ${dateBoxes}
    ${at(L.payee, 'payee', c.payee)}
    ${at(L.words1, 'words', w1)}
    ${w2 ? at(L.words2, 'words', w2) : ''}
    ${at(L.figures, 'figures', money(c.amount))}
  </div>
</body>
</html>`;
}

