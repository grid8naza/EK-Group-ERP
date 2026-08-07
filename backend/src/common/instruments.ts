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

/**
 * Where a post-dated cheque sits between being written and being presented.
 *
 * Issuing one pays the party — their balance falls that day, because the debt
 * is discharged the moment they have the cheque — but it does NOT touch the
 * bank, which knows nothing about it until the leaf is presented. The
 * difference has to live somewhere, and this is it: a liability that says "the
 * bank owes this out, on a date that has not come yet".
 *
 * It is what makes the bank balance in the books agree with the bank's own
 * statement on any day you care to ask, which is the whole point of keeping
 * PDCs out of the bank account.
 */
export const PDC_HOLDING_ACCOUNT_CODE = '29010';
