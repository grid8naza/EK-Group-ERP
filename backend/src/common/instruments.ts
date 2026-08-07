/**
 * The vocabulary of a bank payment: how the money moved, and where a cheque
 * waits while it is still only a promise.
 *
 * In `common` rather than in either module because two of them need the same
 * words — the Chart of Accounts seeds them, the voucher engine enforces them —
 * and a module may not import another module. See src/contracts/README.md.
 */

/** The company's list of ways money leaves or reaches a bank. */
export const PAYMENT_MODE_LOOKUP = 'PAYMENT_MODE';

/**
 * What that list ships with. Editable afterwards — a company that stops writing
 * demand drafts retires the value on its Lookups screen, and one that starts
 * taking something new adds it.
 */
export const PAYMENT_MODES = [
  'Cheque',
  'Demand Draft',
  'NEFT',
  'RTGS',
  'IMPS',
  'UPI',
  'Card',
  'Direct Debit',
];

/**
 * The one mode the code knows by name.
 *
 * Every other mode is done the moment it is entered: the money has moved and
 * there is nothing left to watch. A cheque is the exception — it carries a
 * number, a date it may be presented on, and, when that date is in the future,
 * a life of its own until it clears.
 */
export const CHEQUE_MODE = 'Cheque';
