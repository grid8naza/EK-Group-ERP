/**
 * The vocabulary of the company's OWN bank accounts — see BankAccountDetail.
 *
 * Distinct from ISSUER_BANK in common/instruments.ts, which is the list of banks
 * OTHER people draw cheques on. This is about the accounts we hold ourselves.
 */

/** What kind of account it is: current, savings, an overdraft facility… */
export const BANK_ACCOUNT_TYPE_LOOKUP = 'BANK_ACCOUNT_TYPE';

/**
 * What that list ships with. Editable afterwards from the Accounts Lookups
 * screen — a company that opens an EEFC account adds the kind rather than
 * waiting for a release.
 */
export const BANK_ACCOUNT_TYPES = [
  'Current Account',
  'Savings Account',
  'Overdraft',
  'Cash Credit',
  'Term Loan',
  'Fixed Deposit',
  'EEFC',
];

/**
 * The formats a routing code comes in. Enforced rather than merely hinted,
 * because each of these is a fixed, checkable shape and a wrong one is only
 * found out when a payment fails days later.
 *
 * IFSC — four letters, a zero, then six of either (SBIN0001234).
 * MICR — nine digits, the band along the foot of a cheque.
 * SWIFT/BIC — six letters, two of either, and an optional three-character
 * branch code (HDFCINBB / HDFCINBBXXX).
 * IBAN — the country's two letters, two check digits, then up to thirty
 * alphanumerics. Length varies by country, so only the shape is checked.
 */
export const CODE_FORMATS = {
  ifscCode: {
    pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    message: 'An IFSC is eleven characters — four letters, a zero, then six, e.g. SBIN0001234.',
  },
  micrCode: {
    pattern: /^\d{9}$/,
    message: 'An MICR code is the nine digits printed along the foot of a cheque.',
  },
  swiftCode: {
    pattern: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
    message: 'A SWIFT/BIC is eight or eleven characters, e.g. HDFCINBB or HDFCINBBXXX.',
  },
  iban: {
    pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/,
    message: 'An IBAN starts with the country code and two check digits, e.g. AE070331234567890123456.',
  },
} as const;
