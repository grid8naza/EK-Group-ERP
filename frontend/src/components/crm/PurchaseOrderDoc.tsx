'use client';

import { Badge } from '@/components/ui/Badge';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types';

const statusColor = (s: PurchaseOrderStatus) =>
  s === 'APPROVED'
    ? 'green'
    : s === 'REJECTED'
      ? 'red'
      : s === 'CANCELLED'
        ? 'slate'
        : s === 'DRAFT'
          ? 'blue'
          : 'amber';

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';
const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export interface PoDocProps {
  order: PurchaseOrder;
  companyName: (id: number) => string;
  branchName: (id?: number | null) => string;
  productName: (id: number) => string;
  unitLabel: (id: number) => string;
}

/**
 * Professional, print-style Purchase Order document — company header, From/To,
 * itemised lines with totals, delivery + notes, and the workflow approval trail.
 * Read-only; each screen wraps it with its own action bar.
 */
export function PurchaseOrderDoc({
  order,
  companyName,
  branchName,
  productName,
  unitLabel,
}: PoDocProps) {
  // No value on this document, by design: an intercompany order is quantities
  // only. Its price is decided later, by the batches that fill it — stock
  // labelled at an old price can't be sold at a new one — so a figure here would
  // be a guess the goods then contradict. The priced document is the sales order.
  const totalQty = order.lines.reduce((s, l) => s + l.quantity, 0);
  const timeline = order.workflow?.timeline ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Purchase Order
          </h1>
          <p className="mt-1 font-mono text-sm text-slate-500">
            {order.orderNo}
          </p>
        </div>
        <div className="text-right">
          <Badge color={statusColor(order.status)}>
            {order.workflowStatus ?? order.status}
          </Badge>
          <p className="mt-2 text-xs text-slate-500">
            Order date: {fmtDate(order.orderDate ?? order.createdAt)}
          </p>
        </div>
      </div>

      {/* From / To */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Party
          heading="From (Requester)"
          name={companyName(order.orderingCompanyId)}
          sub={branchName(order.orderingBranchId)}
        />
        <Party
          heading="To (Supplier)"
          name={companyName(order.companyId)}
        />
        <Field label="Delivery date & time" value={fmt(order.deliveryAt)} />
        <Field
          label="Created"
          value={fmt(order.createdAt)}
        />
      </div>

      {/* Line items */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
              <th className="w-10 py-2 pr-2">#</th>
              <th className="py-2 pr-2">Product</th>
              <th className="w-24 py-2 text-right">Quantity</th>
              <th className="w-14 py-2 pl-2">Unit</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr
                key={l.id ?? i}
                className="border-b border-slate-100 dark:border-slate-800/60"
              >
                <td className="py-2 pr-2 text-slate-400 tabular-nums">
                  {i + 1}
                </td>
                <td className="py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                  {productName(l.productId)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {l.quantity.toLocaleString()}
                </td>
                <td className="py-2 pl-2 text-slate-500">
                  {unitLabel(l.unitId)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
              <td className="py-2" />
              <td className="py-2 text-right text-xs uppercase tracking-wide text-slate-500">
                {order.lines.length} item{order.lines.length === 1 ? '' : 's'} ·
                Total quantity
              </td>
              <td className="py-2 text-right tabular-nums">
                {totalQty.toLocaleString()}
              </td>
              <td className="py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {order.notes && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {order.notes}
          </p>
        </div>
      )}

      {/* Approval trail */}
      {timeline.length > 0 && (
        <div className="mt-8 border-t border-slate-200 pt-5 dark:border-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Approval trail
          </p>
          <ol className="mt-3 space-y-3">
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                <div>
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {t.action}
                  </span>
                  <span className="text-slate-500">
                    {' '}
                    — {t.userName} · {fmt(t.createdAt)}
                  </span>
                  {t.comment && (
                    <p className="text-slate-500">“{t.comment}”</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Party({
  heading,
  name,
  sub,
}: {
  heading: string;
  name: string;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {heading}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
        {name}
      </p>
      {sub && sub !== '—' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{sub}</p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{value}</p>
    </div>
  );
}
