'use client';

import { dec2 } from '@/lib/utils';
import type { LookupValue } from '@/lib/types';

/**
 * The drawer's discount matrix, keyed by DISCOUNT_LEVEL LookupValue id and held
 * as strings while editing (like every other numeric field on the product
 * forms, so a half-typed "1." doesn't collapse to a number mid-keystroke).
 */
export type DiscountForm = Record<number, string>;

/** Build the form map from a saved product's discount rows. */
export function discountFormFrom(
  rows: { lookupValueId: number; percentage: number }[] | undefined,
): DiscountForm {
  const out: DiscountForm = {};
  for (const r of rows ?? []) out[r.lookupValueId] = dec2(String(r.percentage));
  return out;
}

/**
 * Turn the form map back into the payload. Every level is sent, including the
 * blanks as 0 — the server drops zero rows, so "no discount" stays the absence
 * of a row rather than a stored zero, and clearing a percentage genuinely
 * removes it.
 */
export function discountPayload(
  levels: LookupValue[],
  form: DiscountForm,
): { lookupValueId: number; percentage: number }[] {
  return levels.map((l) => ({
    lookupValueId: l.id,
    percentage: Number(form[l.id]) || 0,
  }));
}

/**
 * Maximum discount percentage per authority level, for one product.
 *
 * The rows come from the DISCOUNT_LEVEL lookup rather than being fixed columns,
 * so renaming a level or adding a fifth is done in Inventory > Lookups and
 * shows up here without a code change. The percentages are per product, which
 * is why they live on the product form rather than on the level.
 *
 * Rendered only where the product can be sold — the caller gates it, since a
 * product that isn't sold has nothing to discount.
 */
export function DiscountMatrix({
  levels,
  value,
  onChange,
}: {
  levels: LookupValue[];
  value: DiscountForm;
  onChange: (levelId: number, percentage: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="label !mb-0">Discount Matrix</span>
      <p className="text-xs text-slate-400">
        The maximum discount each level may give on this product at billing.
        Leave blank for no discount. Levels are maintained in Inventory &gt;
        Lookups; who holds which level is set on the user group.
      </p>
      {levels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-400 dark:border-slate-700">
          No discount levels defined. Add them under Inventory &gt; Lookups
          (Discount Level).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-1 pr-2 font-medium">Level</th>
                <th className="pb-1 font-medium">Max discount %</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.id}>
                  <td className="py-1 pr-2 align-middle text-slate-700 dark:text-slate-200">
                    {l.label}
                  </td>
                  <td className="py-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      className="input-base w-28 text-right"
                      placeholder="0"
                      value={value[l.id] ?? ''}
                      onChange={(e) => onChange(l.id, e.target.value)}
                      // Percentages settle to two decimals once the cell is
                      // left; a blank stays blank, which is what "no discount"
                      // means here.
                      onBlur={() => onChange(l.id, dec2(value[l.id] ?? ''))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
