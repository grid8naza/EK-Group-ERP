/**
 * A figure written out in words, the way a cheque and a payment advice write it.
 *
 * On a cheque the words are not a courtesy: where the words and the figures
 * disagree, the words are what the bank pays. So this is the authoritative half
 * of the instrument, and it has to be right on the awkward numbers — the teens,
 * the round hundreds, the lakh with nothing in the thousands — not just on the
 * ones anybody would think to try.
 *
 * The Indian system throughout: thousand, lakh, crore, grouped 2-2-3 rather than
 * in threes. That is what a cheque drawn in India is read in, and every one of
 * the group's banks is here. A foreign-currency account would want the short
 * scale (million, billion) instead; the unit names come in from the currency
 * master, but the grouping does not, so that is a change to make when a foreign
 * account is actually opened rather than a guess left lying in the code.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** 0–99. The teens are their own words, which is why ONES runs to nineteen. */
const under100 = (n: number): string =>
  n < 20
    ? ONES[n]
    : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;

/** 0–999. "One Hundred Five", not "One Hundred and Five" — banks write it plain. */
const under1000 = (n: number): string => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!h) return under100(rest);
  return `${ONES[h]} Hundred${rest ? ` ${under100(rest)}` : ''}`;
};

/**
 * A whole number in the Indian system. Groups after the first are two digits
 * wide — 1,23,45,678 is one crore twenty-three lakh forty-five thousand six
 * hundred seventy-eight — so the usual three-digit chunking would say it wrong.
 */
export function wholeInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  // Beyond a hundred crore the word simply repeats — "One Thousand Crore" —
  // which is how it is said, so the crore group is written as a number itself.
  if (crore)
    parts.push(`${crore > 999 ? wholeInWords(crore) : under1000(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

export interface CurrencyWords {
  /** What a whole unit is called in the plural — Rupees, Dirhams. */
  major: string;
  /** And the hundredth of one — Paise, Fils. */
  minor: string;
}

export const RUPEES: CurrencyWords = { major: 'Rupees', minor: 'Paise' };

/**
 * A money amount as a cheque writes it: the currency, the figure in words, the
 * paise where there are any, and "Only" to close the line off so nothing can be
 * added after it.
 *
 * Rounded to two places first, and rounded ONCE — writing the rupees from the
 * raw figure and the paise from a rounded one is how 99.999 becomes "Ninety
 * Nine Rupees and One Hundred Paise".
 */
export function amountInWords(
  amount: number,
  currency: CurrencyWords = RUPEES,
): string {
  const negative = amount < 0;
  const paise = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  const head = `${currency.major} ${wholeInWords(whole)}`;
  const tail = fraction ? ` and ${under100(fraction)} ${currency.minor}` : '';
  return `${negative ? 'Minus ' : ''}${head}${tail} Only`;
}
