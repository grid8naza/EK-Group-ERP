/**
 * The GST state codes.
 *
 * Statutory and fixed — the same 2-digit codes that open every GSTIN and that a
 * return quotes — so they are a table in the code rather than a master somebody
 * maintains. There is nothing here for a company to configure and nothing that
 * changes without an Act.
 *
 * They matter because ONE comparison decides the tax on every bill: supplier
 * state against place of supply. Equal means CGST + SGST, different means IGST.
 * Getting it from a name typed into two masters ("Kerala" vs "KERALA") would
 * make that comparison a spelling test, which is why everything resolves to a
 * code before it is compared.
 */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/** Name (however it was typed) → code. Built once. */
const BY_NAME = new Map(
  Object.entries(GST_STATE_CODES).map(([code, name]) => [
    name.toLowerCase().replace(/[^a-z]/g, ''),
    code,
  ]),
);

/** The state's name for a code, for printing on the bill. */
export const gstStateName = (code?: string | null): string | null =>
  code ? (GST_STATE_CODES[code] ?? null) : null;

/**
 * The 2-digit GST state code for a party, from whatever they actually hold.
 *
 * In order of how much it can be trusted:
 *  1. the GSTIN — its first two characters ARE the state code, so a registered
 *     party never has to be asked separately, and a code taken from the number
 *     the return quotes cannot disagree with it;
 *  2. a state field already holding a code;
 *  3. a state field holding a NAME, matched case- and punctuation-insensitively,
 *     which is what the company and branch masters hold today.
 *
 * Null when none of them says — and the caller refuses to bill rather than
 * guessing, because guessing here means charging the wrong tax.
 */
export function gstStateCode(
  gstin?: string | null,
  state?: string | null,
): string | null {
  const g = gstin?.trim();
  if (g && g.length >= 2 && /^\d{2}$/.test(g.slice(0, 2))) {
    const code = g.slice(0, 2);
    if (GST_STATE_CODES[code]) return code;
  }
  const s = state?.trim();
  if (!s) return null;
  if (/^\d{2}$/.test(s) && GST_STATE_CODES[s]) return s;
  return BY_NAME.get(s.toLowerCase().replace(/[^a-z]/g, '')) ?? null;
}
