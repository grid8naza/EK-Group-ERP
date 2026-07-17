'use client';

import { Package, Undo2, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { PurchaseOrder } from '@/lib/types';

const num = (n: number) => n.toLocaleString();

export type ReviewLine = { lineId: number; acceptedQty: string; cancelled: boolean };

export interface PurchaseOrderReviewProps {
  order: PurchaseOrder;
  lines: ReviewLine[];
  productName: (id: number) => string;
  unitLabel: (id: number) => string;
  onAccepted: (lineId: number, qty: string) => void;
  onToggleCancel: (lineId: number) => void;
  /**
   * Show the numbers without the means to change them — for everyone but the
   * reviewer currently holding the order. The next approver is approving these
   * figures, so they must see them; they just don't get to set them.
   */
  readOnly?: boolean;
  /** Momentarily inert while a save / reserve is in flight. */
  disabled?: boolean;
}

/**
 * Customer Relations' answer to an incoming order: how much of each line we'll
 * supply, what's actually held for it, and what's left to make.
 *
 * The buyer's quantity is read-only here — the demand has to stay legible beside
 * the commitment. Accepted may deliberately EXCEED available stock: reserving
 * takes what exists and the balance goes to production, which is the whole point
 * of the step.
 */
export function PurchaseOrderReview({
  order,
  lines,
  productName,
  unitLabel,
  onAccepted,
  onToggleCancel,
  readOnly,
  disabled,
}: PurchaseOrderReviewProps) {
  const draftOf = (lineId: number) => lines.find((l) => l.lineId === lineId);

  return (
    <div className="mx-auto w-full max-w-5xl rounded-xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <Package className="h-5 w-5 text-slate-400" /> Stock &amp; acceptance
        </h2>
        <Badge color="amber">{order.workflowStatus ?? order.status}</Badge>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        {readOnly
          ? 'What Customer Relations committed to, and what is held against it. Balance is still to be produced.'
          : 'Available is company-wide and already nets off stock held by other orders. Accepting more than is available is fine — reserve takes what exists and the balance is produced.'}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
              <th className="py-2 pr-2">Product</th>
              <th className="w-20 py-2 text-right">Ordered</th>
              <th className="w-20 py-2 text-right">In stock</th>
              <th className="w-20 py-2 text-right">Available</th>
              <th className="w-24 py-2 text-right">Accepted</th>
              <th className="w-20 py-2 text-right">Reserved</th>
              <th className="w-20 py-2 text-right">Balance</th>
              <th className="w-12 py-2" />
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const d = draftOf(l.id);
              const cancelled = d?.cancelled ?? false;
              const accepted = cancelled ? 0 : Number(d?.acceptedQty ?? 0) || 0;
              const reserved = l.reservedQty ?? 0;
              // What's left to make. Mirrors the backend so the screen doesn't
              // lie between a save and a reserve.
              const balance = Math.max(0, accepted - reserved);
              const short = accepted > (l.stockAvailable ?? 0);
              return (
                <tr
                  key={l.id}
                  className={`border-b border-slate-100 dark:border-slate-800/60 ${
                    cancelled ? 'opacity-50' : ''
                  }`}
                >
                  <td className="whitespace-nowrap py-2 pr-2 font-medium text-slate-800 dark:text-slate-100">
                    <span className={cancelled ? 'line-through' : ''}>
                      {productName(l.productId)}
                    </span>
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {unitLabel(l.unitId)}
                    </span>
                    {cancelled && (
                      <span className="ml-2 text-xs font-semibold uppercase text-red-500">
                        Cancelled
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {num(l.quantity)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {num(l.stockOnHand ?? 0)}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      (l.stockAvailable ?? 0) <= 0
                        ? 'text-red-500'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {num(l.stockAvailable ?? 0)}
                  </td>
                  <td className="py-2 pl-1">
                    {readOnly ? (
                      <span className="block pr-1 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                        {num(accepted)}
                      </span>
                    ) : (
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={cancelled ? '0' : (d?.acceptedQty ?? '')}
                        onChange={(e) => onAccepted(l.id, e.target.value)}
                        disabled={disabled || cancelled}
                        className={`text-right tabular-nums ${
                          short ? 'text-amber-600 dark:text-amber-500' : ''
                        }`}
                        title={
                          short
                            ? 'More than is available — the shortfall becomes the balance to produce'
                            : undefined
                        }
                      />
                    )}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                    {num(reserved)}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      balance > 0
                        ? 'font-semibold text-amber-600 dark:text-amber-500'
                        : 'text-slate-400'
                    }`}
                    title={balance > 0 ? 'To be produced' : undefined}
                  >
                    {num(balance)}
                  </td>
                  <td className="py-2 text-center">
                    {!readOnly && (
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-slate-800"
                        onClick={() => onToggleCancel(l.id)}
                        disabled={disabled}
                        title={cancelled ? 'Restore this line' : 'Cancel this line'}
                        aria-label={cancelled ? 'Restore line' : 'Cancel line'}
                      >
                        {cancelled ? (
                          <Undo2 className="h-4 w-4" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
