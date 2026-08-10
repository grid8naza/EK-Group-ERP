'use client';

import { Badge } from '@/components/ui/Badge';
import { WorkflowStallNotice } from '@/components/workflow/StallNotice';
import type { SalesOrder, SalesOrderStatus } from '@/lib/types';

const statusColor = (s: SalesOrderStatus) =>
  s === 'APPROVED'
    ? 'green'
    : s === 'REJECTED'
      ? 'red'
      : s === 'CANCELLED'
        ? 'slate'
        : s === 'DRAFT'
          ? 'blue'
          : 'amber';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '—';
const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export interface SoDocProps {
  order: SalesOrder;
  companyName: (id?: number | null) => string;
  branchName: (id?: number | null) => string;
  productName: (id: number) => string;
  unitLabel: (id: number) => string;
}

/**
 * Print-style Sales Order document — customer, the origin purchase order it
 * answers, priced lines showing asked-vs-supplying, and the approval trail.
 * Read-only; the screen wraps it with its own action bar.
 */
export function SalesOrderDoc({
  order,
  companyName,
  branchName,
  productName,
  unitLabel,
}: SoDocProps) {
  const total = order.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const short = order.lines.some((l) => l.quantity < l.orderedQty);
  const timeline = order.workflow?.timeline ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Sales Order
          </h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{order.orderNo}</p>
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

      {/* Customer / origin */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Party
          heading="Customer"
          name={companyName(order.buyerCompanyId)}
          sub={branchName(order.buyerBranchId)}
        />
        <Party
          heading="Against their PO"
          name={order.poNumber ?? '—'}
          sub={order.poDate ? fmtDate(order.poDate) : undefined}
        />
        <Field label="They wanted by" value={fmt(order.poDeliveryAt)} />
        <Field label="We deliver by" value={fmt(order.deliveryAt)} />
      </div>

      {order.poNotes && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Their instructions
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {order.poNotes}
          </p>
        </div>
      )}

      {/* Line items */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
              <th className="w-10 py-2 pr-2">#</th>
              <th className="py-2 pr-2">Product</th>
              <th className="w-36 py-2 pl-2">Batch</th>
              <th className="w-20 py-2 text-right">Asked</th>
              <th className="w-24 py-2 text-right">Supplying</th>
              <th className="w-14 py-2 pl-2">Unit</th>
              <th className="w-24 py-2 text-right">Rate</th>
              <th className="w-28 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr
                key={l.id ?? i}
                className="border-b border-slate-100 dark:border-slate-800/60"
              >
                <td className="py-2 pr-2 tabular-nums text-slate-400">{i + 1}</td>
                <td className="whitespace-nowrap py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                  {productName(l.productId)}
                </td>
                <td className="py-2 pl-2 text-xs">
                  {l.batchId ? (
                    <span className="whitespace-nowrap font-mono text-slate-500">{l.batchNo}</span>
                  ) : (
                    <span className="font-medium text-amber-600 dark:text-amber-500">
                      To produce
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-500">
                  {l.orderedQty.toLocaleString()}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${
                    l.quantity < l.orderedQty
                      ? 'font-semibold text-amber-600 dark:text-amber-500'
                      : ''
                  }`}
                >
                  {l.quantity.toLocaleString()}
                </td>
                <td className="py-2 pl-2 text-slate-500">{unitLabel(l.unitId)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.rate)}</td>
                <td className="py-2 text-right tabular-nums">
                  {money(l.quantity * l.rate)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
              <td className="py-2" colSpan={5} />
              <td
                className="py-2 pl-2 text-right text-xs uppercase tracking-wide text-slate-500"
                colSpan={2}
              >
                Order value
              </td>
              <td className="py-2 text-right tabular-nums">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
        {short && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
            Some lines supply less than was asked for.
          </p>
        )}
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

      {/* Stopped, not merely waiting — see WorkflowStallNotice. */}
      {order.workflow?.stalled && (
        <WorkflowStallNotice
          className="mt-6"
          sequence={order.workflow.currentSequence}
        />
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
                  {t.comment && <p className="text-slate-500">“{t.comment}”</p>}
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
