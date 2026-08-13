'use client';

import type { StockDocumentRow, StockTransaction } from '@/lib/types';

/** One line as the document says it, already resolved for printing. */
export type PrintLine = {
  name: string;
  /** Quantity as entered — in packs where the line was counted that way. */
  qty: number;
  /** Unit the quantity is in (the pack unit, or the stock unit). */
  unit: string;
  /** What entered stock, always in the stock unit. */
  stockQty: number;
  stockUnit: string;
  /** True when qty/unit are the pack's, so the two columns differ. */
  inPacks: boolean;
  rate: number;
  batchNo2?: string;
  expiry?: string;
};

const money = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const qtyText = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * The printable face of a stock document (receipt, issue, delivery, either
 * return). Hidden on screen and revealed by the `print:` variants — the drawer
 * keeps showing the working form, and only this reaches the paper.
 *
 * Pack and stock quantities are printed side by side: the supplier's note says
 * 1 Bottle, the store holds 200 Gram, and a printout that showed only one of
 * them would be arguing with either the invoice or the stock ledger.
 */
export function StockDocumentPrint({
  title,
  doc,
  row,
  lines,
  supplierName,
  showRate,
  inbound,
  notes,
}: {
  title: string;
  doc: StockTransaction;
  row?: StockDocumentRow | null;
  lines: PrintLine[];
  supplierName?: string;
  showRate: boolean;
  inbound: boolean;
  notes?: string;
}) {
  const anyPacked = lines.some((l) => l.inPacks);
  // Rate is per whatever Qty is counted in — per bottle on a packed line, per
  // gram otherwise — so the amount is the plain product either way, and it is
  // the same figure the stock-unit pair would give.
  const amountOf = (l: PrintLine) => l.qty * l.rate;
  const total = lines.reduce((sum, l) => sum + amountOf(l), 0);
  const fmtDate = (v?: string | null) =>
    v ? new Date(v).toLocaleDateString('en-GB') : '—';

  return (
    <div className="print-root hidden text-black print:block">
      <div className="mb-4 flex items-start justify-between gap-4 border-b-2 border-slate-300 pb-3">
        <div>
          <p className="text-lg font-bold">{row?.companyName ?? ''}</p>
          {row?.branchName && <p className="text-sm">{row.branchName}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase tracking-wide">{title}</p>
          <p className="font-mono text-sm">{doc.docNo}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
        <Field label="Date" value={fmtDate(doc.docDate)} />
        <Field label="Store" value={row?.storeName ?? ''} />
        <Field label="Reference" value={doc.reference || '—'} />
        {supplierName && <Field label="Supplier" value={supplierName} />}
        {doc.purchaseOrderRef && (
          <Field label="Purchase order" value={doc.purchaseOrderRef} />
        )}
        {doc.dispatchNo && <Field label="Dispatch" value={doc.dispatchNo} />}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left text-xs font-semibold uppercase tracking-wide">
            <th className="w-8 py-1.5">#</th>
            <th className="py-1.5 pr-2">Item / Product</th>
            {inbound && <th className="py-1.5 pr-2">Batch</th>}
            {inbound && <th className="py-1.5 pr-2">Expiry</th>}
            <th className="w-20 py-1.5 text-right">Qty</th>
            <th className="w-16 py-1.5 pl-2">Unit</th>
            {anyPacked && <th className="w-28 py-1.5 text-right">Stock Qty</th>}
            {showRate && <th className="w-24 py-1.5 text-right">Rate</th>}
            {showRate && <th className="w-28 py-1.5 text-right">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="py-1.5 tabular-nums">{i + 1}</td>
              <td className="py-1.5 pr-2 font-medium">{l.name}</td>
              {inbound && (
                <td className="py-1.5 pr-2 font-mono text-xs">
                  {l.batchNo2 || '—'}
                </td>
              )}
              {inbound && (
                <td className="py-1.5 pr-2 text-xs">{fmtDate(l.expiry)}</td>
              )}
              <td className="py-1.5 text-right tabular-nums">
                {qtyText(l.qty)}
              </td>
              <td className="py-1.5 pl-2">{l.unit}</td>
              {anyPacked && (
                <td className="py-1.5 text-right tabular-nums">
                  {qtyText(l.stockQty)} {l.stockUnit}
                </td>
              )}
              {showRate && (
                <td className="py-1.5 text-right tabular-nums">
                  {money(l.rate)}
                  {/* Rate is per whatever Qty is in, so the unit is spelled out
                      wherever the two differ. */}
                  {anyPacked && (
                    <span className="block text-[10px]">/ {l.unit}</span>
                  )}
                </td>
              )}
              {showRate && (
                <td className="py-1.5 text-right tabular-nums">
                  {money(amountOf(l))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {showRate && (
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td
                className="py-2"
                colSpan={2 + (inbound ? 2 : 0) + 2 + (anyPacked ? 1 : 0) + 1}
              >
                Total
              </td>
              <td className="py-2 text-right tabular-nums">{money(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {notes && (
        <div className="mt-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide">Notes</p>
          <p className="whitespace-pre-wrap">{notes}</p>
        </div>
      )}

      <div className="mt-16 flex justify-between text-xs uppercase tracking-wide">
        <span className="border-t border-slate-400 pt-1">Prepared by</span>
        <span className="border-t border-slate-400 pt-1">Received by</span>
        <span className="border-t border-slate-400 pt-1">Authorised by</span>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p>{value}</p>
    </div>
  );
}
