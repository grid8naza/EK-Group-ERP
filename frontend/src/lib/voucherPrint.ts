/**
 * The voucher itself, printed — the entry as the books hold it.
 *
 * One document for all ten kinds. A journal, a sale and a bank payment are all
 * debits and credits that must agree, which is why one entry screen writes them
 * all; printed they differ only in what the paper is called at the top and in
 * whether there is an instrument to name. Ten layouts would be ten places for
 * the same total to be laid out differently.
 *
 * This is the INTERNAL document: what was posted, who to, against which bills,
 * and who signed for it — the sheet that goes in the file behind the cheque
 * counterfoil. It is not the payment advice, which is written for the payee and
 * carries this company's bank details; see paymentDocs.ts.
 */

import { amountInWords, type CurrencyWords, RUPEES } from './amountWords';
import { esc, fmtDate, money } from './docFormat';
import type { DocCompany } from './paymentDocs';

/** One allocation printed under its line. */
export interface VoucherDocBill {
  label: string;
  amount: number;
}

/** One line of the entry, as the document shows it. */
export interface VoucherDocLine {
  side: 'DR' | 'CR';
  /** The ledger — code and name, as the chart names it. */
  accountCode: string;
  accountName: string;
  amount: number;
  /** Whose balance this moves, on a control account. */
  party?: string | null;
  costCentre?: string | null;
  costObject?: string | null;
  narration?: string | null;
  bills?: VoucherDocBill[];
}

export interface VoucherDocInput {
  company: DocCompany;
  branchName?: string | null;
  /** What this kind of voucher is called — "Bank Payment", "Journal". */
  kind: string;
  voucherNo: string;
  date: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED' | string;
  cancelReason?: string | null;
  postedAt?: string | null;
  reference?: string | null;
  narration?: string | null;
  /** What the transaction WAS, where the kind carries a classification. */
  transactionType?: string | null;
  transactionSubtype?: string | null;
  /** How the money moved. Bank kinds only. */
  mode?: string | null;
  instrumentNo?: string | null;
  instrumentDate?: string | null;
  postDated?: boolean;
  bankLedger?: string | null;
  lines: VoucherDocLine[];
  currency?: CurrencyWords;
  /**
   * Who signed, in the order they did — the workflow's answer to the three
   * names at the foot of a voucher.
   *
   * Empty where no workflow governs the kind, and the sheet then prints the
   * blank ruled blocks it always did, for people to sign by hand. The two are
   * the same document; only one of them already knows the answer.
   */
  signatories?: VoucherSignatory[];
}

/** One name at the foot of the voucher, and what they did. */
export interface VoucherSignatory {
  /** Prepared / Checked / Approved — or whatever the step was called. */
  role: string;
  name: string;
  on?: string | null;
}

/**
 * Both money columns and their totals.
 *
 * Printed even on a voucher that does not balance — a draft need not yet — so
 * that the sheet shows the disagreement rather than hiding it behind a single
 * figure. A posted voucher always agrees; the check is on the way in.
 */
const totals = (lines: VoucherDocLine[]) => ({
  debit: lines.filter((l) => l.side === 'DR').reduce((s, l) => s + l.amount, 0),
  credit: lines.filter((l) => l.side === 'CR').reduce((s, l) => s + l.amount, 0),
});

export function buildVoucherHtml(v: VoucherDocInput): string {
  const currency = v.currency ?? RUPEES;
  const { debit, credit } = totals(v.lines);
  const balanced = Math.round(debit * 100) === Math.round(credit * 100);
  const where = [v.company.address, v.company.city, v.company.state]
    .filter(Boolean)
    .join(', ');

  // Tally's shape, because it is the one every accountant who will read this
  // already has in their hands: the side, then the ledger, then the figure in
  // its own column, with everything the line carries indented beneath it.
  const rows = v.lines
    .map((l) => {
      const detail = [
        l.party ? `<div class="sub">${esc(l.party)}</div>` : '',
        [l.costCentre, l.costObject].filter(Boolean).length
          ? `<div class="sub">${esc(
              [l.costCentre, l.costObject].filter(Boolean).join(' · '),
            )}</div>`
          : '',
        (l.bills ?? []).length
          ? `<div class="sub">${(l.bills ?? [])
              .map((b) => `${esc(b.label)} — ${money(b.amount)}`)
              .join('<br />')}</div>`
          : '',
        l.narration ? `<div class="sub it">${esc(l.narration)}</div>` : '',
      ].join('');
      return `<tr>
        <td class="side">${l.side === 'DR' ? 'Dr' : 'Cr'}</td>
        <td>
          <span class="ledger">${esc(l.accountCode)} ${esc(l.accountName)}</span>
          ${detail}
        </td>
        <td class="r">${l.side === 'DR' ? money(l.amount) : ''}</td>
        <td class="r">${l.side === 'CR' ? money(l.amount) : ''}</td>
      </tr>`;
    })
    .join('');

  // Only the fields this kind actually carries: an empty "Mode —" row on a
  // journal is a question nobody asked.
  const meta = [
    v.reference ? ['Reference', v.reference] : null,
    v.transactionType
      ? [
          'Transaction',
          [v.transactionType, v.transactionSubtype].filter(Boolean).join(' · '),
        ]
      : null,
    v.mode ? ['Mode', v.mode] : null,
    v.bankLedger ? ['Bank', v.bankLedger] : null,
    v.instrumentNo ? ['Instrument no', v.instrumentNo] : null,
    v.instrumentDate
      ? [
          v.postDated ? 'Due on' : 'Instrument date',
          fmtDate(v.instrumentDate),
        ]
      : null,
    v.postedAt ? ['Posted', fmtDate(v.postedAt)] : null,
  ].filter(Boolean) as string[][];

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(v.kind)} — ${esc(v.voucherNo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #334155; padding-bottom: 12px; }
  .co b { font-size: 15px; display: block; }
  .co span { color: #64748b; font-size: 11px; display: block; margin-top: 2px; }
  .doc { text-align: right; white-space: nowrap; }
  .doc h1 { font-size: 17px; margin: 0; letter-spacing: .06em; text-transform: uppercase; }
  .doc span { color: #64748b; font-size: 11px; display: block; margin-top: 4px; }
  .stamp { display: inline-block; margin-top: 6px; border: 1px solid currentColor; padding: 1px 6px; border-radius: 3px; font-size: 10px; letter-spacing: .08em; }
  .stamp.draft { color: #b45309; }
  .stamp.cancelled { color: #be123c; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 28px; margin: 14px 0 4px; font-size: 11px; }
  .meta div span { color: #64748b; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; }
  td.side, th.side { width: 2.4rem; text-align: center; color: #475569; }
  td.r, th.r { text-align: right; width: 7.5rem; font-variant-numeric: tabular-nums; }
  .ledger { font-weight: bold; }
  .sub { color: #64748b; padding-left: 10px; margin-top: 2px; }
  .sub.it { font-style: italic; }
  tfoot td { font-weight: bold; background: #f1f5f9; }
  .words { margin-top: 10px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 8px 10px; border-radius: 5px; }
  .words span { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; display: block; }
  .warn { margin-top: 8px; color: #be123c; font-size: 11px; }
  .note { margin-top: 12px; font-size: 11px; color: #475569; }
  .sign { margin-top: 48px; display: flex; gap: 32px; }
  .sign div { flex: 1; border-top: 1px solid #94a3b8; padding-top: 4px; text-align: center; color: #64748b; font-size: 11px; }
  /* A signed voucher names people, so the name is the line that reads first and
     the role explains it — the reverse of a blank block waiting for a pen. */
  .sign div b { display: block; color: #1e293b; font-size: 12px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="head">
    <div class="co">
      <b>${esc(v.company.legalName || v.company.name)}</b>
      ${where ? `<span>${esc(where)}</span>` : ''}
      ${v.company.gstin ? `<span>GSTIN ${esc(v.company.gstin)}</span>` : ''}
      ${v.branchName ? `<span>${esc(v.branchName)}</span>` : ''}
    </div>
    <div class="doc">
      <h1>${esc(v.kind)}</h1>
      <span>No. ${esc(v.voucherNo)}</span>
      <span>Date ${esc(fmtDate(v.date))}</span>
      ${
        v.status === 'DRAFT'
          ? '<div class="stamp draft">DRAFT — NOT POSTED</div>'
          : v.status === 'CANCELLED'
            ? '<div class="stamp cancelled">CANCELLED</div>'
            : ''
      }
    </div>
  </div>

  ${
    meta.length
      ? `<div class="meta">${meta
          .map(([k, val]) => `<div><span>${esc(k)}:</span> ${esc(val)}</div>`)
          .join('')}</div>`
      : ''
  }

  <table>
    <thead>
      <tr>
        <th class="side"></th>
        <th>Particulars</th>
        <th class="r">Debit</th>
        <th class="r">Credit</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td class="side"></td>
        <td class="r">Total</td>
        <td class="r">${money(debit)}</td>
        <td class="r">${money(credit)}</td>
      </tr>
    </tfoot>
  </table>

  ${
    balanced
      ? `<div class="words">
           <span>Amount in words</span>
           ${esc(amountInWords(debit, currency))}
         </div>`
      : `<p class="warn">
           The two columns do not agree — this voucher has not been posted, and
           what is shown is the entry as it stands.
         </p>`
  }

  ${
    v.status === 'CANCELLED'
      ? `<p class="warn">Cancelled${
          v.cancelReason ? `: ${esc(v.cancelReason)}` : ''
        }. It stays in the books — a posted voucher is never removed.</p>`
      : ''
  }
  ${v.narration ? `<p class="note"><b>Narration:</b> ${esc(v.narration)}</p>` : ''}

  ${
    (v.signatories ?? []).length
      ? `<div class="sign">${(v.signatories ?? [])
          .map(
            (s) => `<div>
              <b>${esc(s.name)}</b>
              ${esc(s.role)}${s.on ? ` · ${esc(fmtDate(s.on))}` : ''}
            </div>`,
          )
          .join('')}</div>`
      : `<div class="sign">
           <div>Prepared by</div>
           <div>Checked by</div>
           <div>Authorised signatory</div>
         </div>`
  }

  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;
}
