'use client';

import { Checkbox, Select } from '@/components/ui/Field';
import type { Company, CostCenter, CostObject, Product } from '@/lib/types';

/**
 * One company's row on the product form, held as strings while editing (like
 * every other id field on these forms).
 */
export type ProductCompanyForm = {
  canProduce: boolean;
  canSell: boolean;
  costCenterId: string;
  recipeCostObjectId: string;
  packingCostObjectId: string;
  costObjectId: string;
};

/** Companies the product is in, keyed by companyId. Absent = not handled there. */
export type CompaniesForm = Record<number, ProductCompanyForm>;

export const EMPTY_COMPANY_ROW: ProductCompanyForm = {
  canProduce: false,
  canSell: true,
  costCenterId: '',
  recipeCostObjectId: '',
  packingCostObjectId: '',
  costObjectId: '',
};

const idStr = (v: number | null | undefined) => (v == null ? '' : String(v));

/** Build the form map from a saved product's company rows. */
export function companiesFormFrom(rows: Product['companies']): CompaniesForm {
  const out: CompaniesForm = {};
  for (const r of rows ?? []) {
    out[r.companyId] = {
      canProduce: r.canProduce ?? false,
      canSell: r.canSell ?? true,
      costCenterId: idStr(r.costCenterId),
      recipeCostObjectId: idStr(r.recipeCostObjectId),
      packingCostObjectId: idStr(r.packingCostObjectId),
      costObjectId: idStr(r.costObjectId),
    };
  }
  return out;
}

/**
 * Turn the form map back into the payload. Everything is sent as entered; the
 * server drops the cost objects that don't apply to the chosen role, so the
 * form never has to second-guess which of them to strip.
 */
export function companiesPayload(form: CompaniesForm) {
  const num = (s: string) => (s ? Number(s) : null);
  return Object.entries(form).map(([companyId, r]) => ({
    companyId: Number(companyId),
    canProduce: r.canProduce,
    canSell: r.canSell,
    costCenterId: num(r.costCenterId),
    recipeCostObjectId: num(r.recipeCostObjectId),
    packingCostObjectId: num(r.packingCostObjectId),
    costObjectId: num(r.costObjectId),
  }));
}

/**
 * Which companies handle this product, in what role, and against which costing.
 *
 * This replaced the old "Availability" list: a flat set of companies recorded
 * that a product existed somewhere but not whether that company MAKES it or
 * only sells it, and left nowhere to name a cost centre. There is deliberately
 * no "all companies" shortcut — costing has to be named per company, so a
 * blanket flag would leave nothing to hang it on.
 *
 * ONE cost centre per company covers buying, making and selling there. What
 * varies is the ACTIVITY, so a producer names a cost object per activity
 * (recipe / packing, each shown only when the product has that BOM) while a
 * company that only buys and sells names a single one.
 */
export function ProductCompanies({
  companies,
  costCenters,
  costObjects,
  value,
  onChange,
  hasRecipe,
  hasPacking,
}: {
  companies: Company[];
  costCenters: CostCenter[];
  costObjects: CostObject[];
  value: CompaniesForm;
  onChange: (next: CompaniesForm) => void;
  hasRecipe: boolean;
  hasPacking: boolean;
}) {
  const toggleCompany = (id: number) => {
    const next = { ...value };
    if (next[id]) delete next[id];
    else next[id] = { ...EMPTY_COMPANY_ROW };
    onChange(next);
  };

  const patch = (id: number, changes: Partial<ProductCompanyForm>) =>
    onChange({ ...value, [id]: { ...value[id], ...changes } });

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="label !mb-0">
        Companies <span className="text-rose-500">*</span>
      </span>
      <p className="text-xs text-slate-400">
        Tick every company that makes or sells this product. A company can do
        both. The cost centre is what its production, purchases and sales of
        this product are all traced against.
      </p>
      {companies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-400 dark:border-slate-700">
          No companies found.
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          {companies.map((co) => {
            const row = value[co.id];
            // Cost centres belong to the company; objects to the chosen centre.
            const centres = costCenters.filter(
              (c) => c.companyId === co.id && c.isActive,
            );
            const objects = costObjects.filter(
              (o) =>
                o.companyId === co.id &&
                o.isActive &&
                (!row?.costCenterId ||
                  o.costCenterId === Number(row.costCenterId)),
            );
            const objectOptions = objects.map((o) => ({
              value: String(o.id),
              label: o.name,
            }));
            const centrePlaceholder = centres.length
              ? '— Select —'
              : 'No cost centres in this company';

            return (
              <div key={co.id}>
                <Checkbox
                  label={`${co.name} (${co.code})`}
                  checked={!!row}
                  onChange={() => toggleCompany(co.id)}
                />
                {row && (
                  <div className="ml-6 mt-2 space-y-2 border-l border-slate-200 pl-4 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                      <Checkbox
                        label="Produces"
                        checked={row.canProduce}
                        onChange={(e) =>
                          patch(co.id, { canProduce: e.target.checked })
                        }
                      />
                      <Checkbox
                        label="Sells"
                        checked={row.canSell}
                        onChange={(e) =>
                          patch(co.id, { canSell: e.target.checked })
                        }
                      />
                      <span className="text-xs text-slate-400">
                        {row.canProduce ? 'Makes it in-house' : 'Buys it in'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select
                        label="Cost centre"
                        value={row.costCenterId}
                        onChange={(e) =>
                          // A different centre invalidates every object under it.
                          patch(co.id, {
                            costCenterId: e.target.value,
                            recipeCostObjectId: '',
                            packingCostObjectId: '',
                            costObjectId: '',
                          })
                        }
                        placeholder={centrePlaceholder}
                        options={centres.map((c) => ({
                          value: String(c.id),
                          label: c.name,
                        }))}
                      />
                      {row.canProduce ? (
                        <>
                          {hasRecipe && (
                            <Select
                              label="Recipe cost object"
                              value={row.recipeCostObjectId}
                              onChange={(e) =>
                                patch(co.id, {
                                  recipeCostObjectId: e.target.value,
                                })
                              }
                              placeholder="— Select —"
                              options={objectOptions}
                            />
                          )}
                          {hasPacking && (
                            <Select
                              label="Packing cost object"
                              value={row.packingCostObjectId}
                              onChange={(e) =>
                                patch(co.id, {
                                  packingCostObjectId: e.target.value,
                                })
                              }
                              placeholder="— Select —"
                              options={objectOptions}
                            />
                          )}
                        </>
                      ) : (
                        <Select
                          label="Cost object"
                          value={row.costObjectId}
                          onChange={(e) =>
                            patch(co.id, { costObjectId: e.target.value })
                          }
                          placeholder="— Select —"
                          options={objectOptions}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {Object.keys(value).length} selected — the product is available only in
        these companies.
      </p>
    </div>
  );
}
