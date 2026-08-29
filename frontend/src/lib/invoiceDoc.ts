import { amountInWords, RUPEES } from './amountWords';

/**
 * The GST tax invoice, as a printable document.
 *
 * These are DOCUMENTS, not reports, which is why they do not go through
 * reportDoc.ts. A report is a table with a heading; a tax invoice has a
 * prescribed shape — both parties named with their GSTINs, the place of supply,
 * an HSN-wise summary, the tax split by head, the total in words, and the signed
 * QR where one has been registered. Rule 46 of the CGST Rules lists what has to
 * be on it, and a column layout cannot carry half of them.
 *
 * The delivery note has its own printer (StockDocumentPrint), which already
 * prints the pack and stock quantities side by side; this is only the bill.
 *
 * The HTML is built as a string and opened in a window to print, matching how
 * every other document in this app is printed (see voucherPrint, paymentDocs).
 * The same string is what the PDF and the email attachment are made from, so
 * there is one layout to keep right rather than three.
 */

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );

const money = (n: number) =>
  (n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const qty = (n: number) =>
  (n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });

const fmtDate = (v?: string | Date | null): string => {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return String(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export interface DocParty {
  name: string;
  gstin?: string | null;
  address?: string | null;
  state?: string | null;
  stateCode?: string | null;
}

export interface InvoiceDocLine {
  description: string;
  hsnCode?: string | null;
  quantity: number;
  unitSymbol?: string | null;
  rate: number;
  discount?: number;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate?: number;
  cessAmount?: number;
  lineTotal: number;
}

export interface InvoiceDocInput {
  company: DocParty & { legalName?: string | null };
  branchName?: string | null;
  invoiceNo: string;
  invoiceDate: string | Date;
  customer: DocParty;
  placeOfSupply?: string | null;
  placeOfSupplyCode: string;
  isInterState: boolean;
  reverseCharge?: boolean;
  supplyType?: string | null;
  deliveryNoteNo?: string | null;
  contractNo?: string | null;
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  lines: InvoiceDocLine[];
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  roundOff: number;
  grandTotal: number;
  // e-invoice / e-way bill, printed only where they exist.
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
  signedQrCode?: string | null;
  ewbNo?: string | null;
  ewbDate?: string | null;
  vehicleNo?: string | null;
  transporterName?: string | null;
  notes?: string | null;
}

/** The page furniture. */
const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         color: #0f172a; margin: 14mm; font-size: 12px; }
  .head { display: flex; justify-content: space-between; gap: 24px;
          border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
  .co b { font-size: 16px; display: block; }
  .co span { display: block; color: #475569; font-size: 11px; margin-top: 2px; }
  .doc { text-align: right; }
  .doc h1 { font-size: 15px; margin: 0 0 4px; text-transform: uppercase;
            letter-spacing: .06em; }
  .doc span { display: block; color: #475569; font-size: 11px; }
  .stamp { margin-top: 6px; display: inline-block; padding: 2px 8px;
           border-radius: 4px; font-size: 11px; font-weight: 700; }
  .stamp.draft { background: #fef3c7; color: #92400e; }
  .stamp.cancelled { background: #fee2e2; color: #991b1b; }
  .parties { display: flex; gap: 16px; margin: 12px 0; }
  .party { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .party h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
              color: #64748b; margin: 0 0 4px; }
  .party b { display: block; font-size: 13px; }
  .party span { display: block; color: #475569; font-size: 11px; margin-top: 2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-bottom: 10px;
          font-size: 11px; color: #475569; }
  .meta span { color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 11px;
           vertical-align: top; }
  th { background: #f1f5f9; text-align: left; font-size: 10px;
       text-transform: uppercase; letter-spacing: .04em; color: #334155; }
  td.r, th.r { text-align: right; }
  td.c, th.c { text-align: center; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .totals { display: flex; justify-content: space-between; gap: 20px; margin-top: 12px; }
  .words { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .words span { display: block; color: #64748b; font-size: 10px;
                text-transform: uppercase; letter-spacing: .04em; }
  .sums { width: 42%; }
  .sums table { margin: 0; }
  .sums td { border: none; padding: 2px 0; }
  .sums td.r { text-align: right; }
  .sums tr.grand td { border-top: 2px solid #0f172a; font-size: 14px;
                      font-weight: 700; padding-top: 5px; }
  .qr { margin-top: 12px; display: flex; gap: 14px; align-items: flex-start; }
  .qr img { width: 110px; height: 110px; border: 1px solid #cbd5e1; }
  .qr .irn { font-size: 10px; color: #475569; word-break: break-all; max-width: 60%; }
  .qr .irn b { display: block; color: #0f172a; font-size: 11px;
               text-transform: uppercase; letter-spacing: .04em; }
  .note { margin-top: 10px; font-size: 11px; color: #475569; }
  .sign { margin-top: 40px; display: flex; gap: 32px; }
  .sign div { flex: 1; border-top: 1px solid #94a3b8; padding-top: 4px;
              text-align: center; color: #64748b; font-size: 11px; }
  .no-print { margin-bottom: 10px; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px;
           border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
  button.primary { background: #0f172a; color: #fff; border-color: #0f172a; }
  @media print { body { margin: 12mm; } .no-print { display: none; } }
`;

const partyBlock = (heading: string, p: DocParty) => `
  <div class="party">
    <h2>${esc(heading)}</h2>
    <b>${esc(p.name)}</b>
    ${p.address ? `<span>${esc(p.address)}</span>` : ''}
    ${p.state ? `<span>${esc(p.state)}${p.stateCode ? ` (${esc(p.stateCode)})` : ''}</span>` : ''}
    ${p.gstin ? `<span>GSTIN: <b style="display:inline;font-size:11px">${esc(p.gstin)}</b></span>` : '<span>Unregistered</span>'}
  </div>`;

/**
 * The tax invoice.
 *
 * Which tax columns appear follows the invoice's OWN inter-state decision, not
 * each line's: a bill carries either CGST + SGST or IGST, never a mixture, and
 * printing all three columns with half of them zero is how a reader loses track
 * of which one the bill actually charged.
 */
export function buildInvoiceHtml(v: InvoiceDocInput): string {
  const showCess = v.lines.some((l) => (l.cessAmount ?? 0) > 0);
  const taxCols = v.isInterState
    ? '<th class="r" colspan="2">IGST</th>'
    : '<th class="r" colspan="2">CGST</th><th class="r" colspan="2">SGST</th>';
  const taxSubCols = v.isInterState
    ? '<th class="r">%</th><th class="r">Amount</th>'
    : '<th class="r">%</th><th class="r">Amount</th><th class="r">%</th><th class="r">Amount</th>';
  const taxCellCount = (v.isInterState ? 2 : 4) + (showCess ? 1 : 0);

  const rows = v.lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.description)}</td>
        <td class="c">${esc(l.hsnCode ?? '')}</td>
        <td class="r">${qty(l.quantity)}${l.unitSymbol ? ` ${esc(l.unitSymbol)}` : ''}</td>
        <td class="r">${money(l.rate)}</td>
        <td class="r">${money(l.taxableValue)}</td>
        ${
          v.isInterState
            ? `<td class="r">${l.igstRate}</td><td class="r">${money(l.igstAmount)}</td>`
            : `<td class="r">${l.cgstRate}</td><td class="r">${money(l.cgstAmount)}</td>
               <td class="r">${l.sgstRate}</td><td class="r">${money(l.sgstAmount)}</td>`
        }
        ${showCess ? `<td class="r">${money(l.cessAmount ?? 0)}</td>` : ''}
        <td class="r">${money(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  // An HSN-wise summary is what a return is filed from, so it is on the bill
  // rather than left to be worked out from the lines.
  const byHsn = new Map<
    string,
    { taxable: number; cgst: number; sgst: number; igst: number; cess: number }
  >();
  for (const l of v.lines) {
    const key = l.hsnCode ?? '—';
    const held = byHsn.get(key) ?? {
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
    };
    held.taxable += l.taxableValue;
    held.cgst += l.cgstAmount;
    held.sgst += l.sgstAmount;
    held.igst += l.igstAmount;
    held.cess += l.cessAmount ?? 0;
    byHsn.set(key, held);
  }
  const hsnRows = [...byHsn]
    .map(
      ([code, t]) => `
      <tr>
        <td class="c">${esc(code)}</td>
        <td class="r">${money(t.taxable)}</td>
        ${
          v.isInterState
            ? `<td class="r">${money(t.igst)}</td>`
            : `<td class="r">${money(t.cgst)}</td><td class="r">${money(t.sgst)}</td>`
        }
        ${showCess ? `<td class="r">${money(t.cess)}</td>` : ''}
        <td class="r">${money(t.taxable + t.cgst + t.sgst + t.igst + t.cess)}</td>
      </tr>`,
    )
    .join('');

  const meta: [string, string][] = [];
  if (v.deliveryNoteNo) meta.push(['Delivery Note', v.deliveryNoteNo]);
  if (v.contractNo) meta.push(['Contract', v.contractNo]);
  if (v.supplyType) meta.push(['Supply', v.supplyType]);
  meta.push(['Place of Supply', `${v.placeOfSupply ?? ''} (${v.placeOfSupplyCode})`]);
  if (v.reverseCharge) meta.push(['Reverse Charge', 'Yes']);
  if (v.ewbNo) meta.push(['E-Way Bill', v.ewbNo]);
  if (v.vehicleNo) meta.push(['Vehicle', v.vehicleNo]);
  if (v.transporterName) meta.push(['Transporter', v.transporterName]);

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(v.invoiceNo)}</title>
<style>${BASE_CSS}</style></head>
<body>
  <div class="no-print">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>

  <div class="head">
    <div class="co">
      <b>${esc(v.company.legalName || v.company.name)}</b>
      ${v.company.address ? `<span>${esc(v.company.address)}</span>` : ''}
      ${v.branchName ? `<span>${esc(v.branchName)}</span>` : ''}
      ${v.company.gstin ? `<span>GSTIN: ${esc(v.company.gstin)}</span>` : ''}
      ${v.company.state ? `<span>${esc(v.company.state)}${v.company.stateCode ? ` (${esc(v.company.stateCode)})` : ''}</span>` : ''}
    </div>
    <div class="doc">
      <h1>Tax Invoice</h1>
      <span>No. <b>${esc(v.invoiceNo)}</b></span>
      <span>Date ${esc(fmtDate(v.invoiceDate))}</span>
      ${v.status === 'DRAFT' ? '<div class="stamp draft">DRAFT — NOT ISSUED</div>' : ''}
      ${v.status === 'CANCELLED' ? '<div class="stamp cancelled">CANCELLED</div>' : ''}
    </div>
  </div>

  <div class="parties">
    ${partyBlock('Billed to', v.customer)}
    ${partyBlock('Supplied by', { ...v.company, name: v.company.legalName || v.company.name })}
  </div>

  <div class="meta">
    ${meta.map(([k, val]) => `<div><span>${esc(k)}:</span> ${esc(val)}</div>`).join('')}
  </div>

  <table>
    <thead>
      <tr>
        <th class="c" rowspan="2">#</th>
        <th rowspan="2">Description</th>
        <th class="c" rowspan="2">HSN</th>
        <th class="r" rowspan="2">Qty</th>
        <th class="r" rowspan="2">Rate</th>
        <th class="r" rowspan="2">Taxable</th>
        ${taxCols}
        ${showCess ? '<th class="r" rowspan="2">Cess</th>' : ''}
        <th class="r" rowspan="2">Total</th>
      </tr>
      <tr>${taxSubCols}</tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" class="r">Total</td>
        <td class="r">${money(v.taxableValue)}</td>
        ${
          v.isInterState
            ? `<td></td><td class="r">${money(v.igstAmount)}</td>`
            : `<td></td><td class="r">${money(v.cgstAmount)}</td>
               <td></td><td class="r">${money(v.sgstAmount)}</td>`
        }
        ${showCess ? `<td class="r">${money(v.cessAmount)}</td>` : ''}
        <td class="r">${money(v.grandTotal - v.roundOff)}</td>
      </tr>
    </tfoot>
  </table>

  <h2 style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:14px 0 0">
    HSN summary
  </h2>
  <table>
    <thead>
      <tr>
        <th class="c">HSN</th>
        <th class="r">Taxable</th>
        ${v.isInterState ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}
        ${showCess ? '<th class="r">Cess</th>' : ''}
        <th class="r">Total</th>
      </tr>
    </thead>
    <tbody>${hsnRows}</tbody>
  </table>

  <div class="totals">
    <div class="words">
      <span>Amount in words</span>
      ${esc(amountInWords(v.grandTotal, RUPEES))}
    </div>
    <div class="sums">
      <table>
        <tr><td>Taxable value</td><td class="r">${money(v.taxableValue)}</td></tr>
        ${
          v.isInterState
            ? `<tr><td>IGST</td><td class="r">${money(v.igstAmount)}</td></tr>`
            : `<tr><td>CGST</td><td class="r">${money(v.cgstAmount)}</td></tr>
               <tr><td>SGST</td><td class="r">${money(v.sgstAmount)}</td></tr>`
        }
        ${v.cessAmount ? `<tr><td>Cess</td><td class="r">${money(v.cessAmount)}</td></tr>` : ''}
        ${v.roundOff ? `<tr><td>Rounding</td><td class="r">${money(v.roundOff)}</td></tr>` : ''}
        <tr class="grand"><td>Grand total</td><td class="r">${money(v.grandTotal)}</td></tr>
      </table>
    </div>
  </div>

  ${
    v.irn
      ? `<div class="qr">
           ${v.signedQrCode ? `<img alt="Signed QR" src="${esc(qrSrc(v.signedQrCode))}">` : ''}
           <div class="irn">
             <b>IRN</b>${esc(v.irn)}
             ${v.ackNo ? `<b style="margin-top:6px">Ack No</b>${esc(v.ackNo)}` : ''}
             ${v.ackDate ? `<b style="margin-top:6px">Ack Date</b>${esc(fmtDate(v.ackDate))}` : ''}
           </div>
         </div>`
      : ''
  }

  ${v.notes ? `<div class="note">${esc(v.notes)}</div>` : ''}

  <div class="sign">
    <div>Received the goods in good order</div>
    <div><b>${esc(v.company.legalName || v.company.name)}</b>Authorised signatory</div>
  </div>
</body></html>`;
}

/**
 * The signed QR as an image source.
 *
 * The IRP returns a signed JWT, and what has to be printed is that string as a
 * QR. Rendering one needs a library the app does not carry, so this uses a
 * data-URI where the caller has already produced one and otherwise falls back to
 * a public renderer. Swap this for a local generator before going live: a signed
 * invoice payload should not be handed to somebody else's server.
 */
function qrSrc(signed: string): string {
  if (signed.startsWith('data:')) return signed;
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(signed)}`;
}

/** Open a built document in a window, ready to print. */
export function openDocument(html: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
