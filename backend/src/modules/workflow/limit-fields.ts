/**
 * The numbers a step's value limit may be set on.
 *
 * A workflow governs documents from every module, so this is deliberately the
 * SMALL set of things any document can be said to have — not a voucher's fields
 * or an order's. A module hands its numbers over by these names when it starts
 * an approval (StartWorkflowInput.fields); a step's limit tests the one it
 * names. Anything not on this list is refused when the workflow is saved,
 * because a limit on a field nobody supplies is a limit that never applies.
 *
 * Grows when a second thing is genuinely worth limiting on and some module can
 * supply it — a line count, a discount percentage. Adding a name here without a
 * module filling it in would only recreate what this replaced: a field that
 * reads as a control and is not one.
 */
export const LIMIT_FIELDS = [
  {
    name: 'amount',
    label: 'Document value',
    description:
      'What the document comes to — a voucher’s total, an order’s value.',
  },
] as const;

export type LimitFieldName = (typeof LIMIT_FIELDS)[number]['name'];

export const LIMIT_FIELD_NAMES: string[] = LIMIT_FIELDS.map((f) => f.name);

/**
 * The value a step's limit should be tested against.
 *
 * `fields` is what the module supplied by name. `amount` is the headline value,
 * and the fallback for two cases that both matter: an instance started before
 * fields existed, and a step limiting the document value, which every module
 * supplies as `amount` anyway.
 *
 * Null means the named field has no value here — the limit CANNOT be tested,
 * which is not the same as passing it. See withinLimit.
 */
export function limitValue(
  fields: unknown,
  amount: number | null,
  fieldName: string | null,
): number | null {
  const name = fieldName?.trim() || 'amount';
  if (fields && typeof fields === 'object') {
    const raw = (fields as Record<string, unknown>)[name];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return name === 'amount' ? amount : null;
}
