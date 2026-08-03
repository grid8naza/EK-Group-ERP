'use client';

import { Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { costedAgo, money, signed } from '@/lib/costing';
import type { ProductCostVariance } from '@/lib/types';

/**
 * Where a recomputed cost comes from, line by line — shared by Cost Review and
 * Price Review so the two cannot drift apart on what a cost is made of.
 *
 * The rows mirror the Recipe / Packing Master costing panel exactly, which is
 * the point: someone reading a difference here should recognise the same
 * arithmetic they see in the editor.
 */
export function CostBreakdownDrawer({
  row,
  onClose,
}: {
  row: ProductCostVariance | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title={row?.name ?? ''}
      subtitle={
        row
          ? `Costed from ${row.basis === 'PACKING' ? 'Packing' : 'Recipe'} Master · ${row.code}`
          : ''
      }
      icon={<Scale className="h-5 w-5" />}
      width="sm"
    >
      {row && (
        <div className="space-y-5">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {/* Packing starts from what it packs; a recipe starts from raw items. */}
              {row.basis === 'PACKING' && (
                <Row label="Product Cost (from source)">
                  {money(row.breakdown.productCost)}
                </Row>
              )}
              <Row label="Material Cost">{money(row.breakdown.materialCost)}</Row>
              <Row label="Equipment Cost">{money(row.breakdown.equipmentCost)}</Row>
              <Row label="Manpower Cost">{money(row.breakdown.manpowerCost)}</Row>
              <Row label="Fuel Cost">{money(row.breakdown.fuelCost)}</Row>
              <Row label="Overheads">{money(row.breakdown.overheadCost)}</Row>
              <Row label="Cost Price" strong>
                {money(row.breakdown.total)}
              </Row>
              <Row label={`÷ yield of ${money(row.breakdown.yieldQty)}`} strong>
                {money(row.breakdown.perUnit)}
              </Row>
            </tbody>
          </table>

          <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900">
            <div className="flex justify-between">
              <span className="text-slate-500">Product Master holds</span>
              <span className="tabular-nums">{money(row.storedCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Recomputed</span>
              <span className="tabular-nums">{money(row.computedCost)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold dark:border-slate-700">
              <span>Difference</span>
              <span className="tabular-nums">{signed(row.costDelta)}</span>
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-400">
              <span>Last costed</span>
              <span>{costedAgo(row.lastCostedAt)}</span>
            </div>
          </div>

          {row.sourceNames.length > 0 && (
            <p className="text-xs text-slate-500">
              Packed from {row.sourceNames.join(', ')} — a change in a source
              product&apos;s cost moves this one too.
            </p>
          )}

          {/* Only Price Review passes priced rows; a not-for-sale product has
              nothing to show here. */}
          {row.prices.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Margin at the recomputed cost
              </h3>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-1 text-left font-medium">Channel</th>
                    <th className="py-1 text-right font-medium">Price</th>
                    <th className="py-1 text-right font-medium">Target</th>
                    <th className="py-1 text-right font-medium">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {row.prices.map((p) => (
                    <tr
                      key={p.key}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="py-1.5 text-slate-600 dark:text-slate-300">
                        {p.label}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {money(p.price)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">
                        {p.targetProfitPct == null
                          ? '—'
                          : `${money(p.targetProfitPct)}%`}
                      </td>
                      <td
                        className={cn(
                          'py-1.5 text-right font-semibold tabular-nums',
                          p.alert && 'text-rose-600 dark:text-rose-400',
                        )}
                      >
                        {money(p.actualProfitPct)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Row({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td
        className={cn(
          'py-1.5 text-slate-600 dark:text-slate-300',
          strong && 'font-semibold text-slate-800 dark:text-slate-100',
        )}
      >
        {label}
      </td>
      <td className={cn('py-1.5 text-right tabular-nums', strong && 'font-semibold')}>
        {children}
      </td>
    </tr>
  );
}
