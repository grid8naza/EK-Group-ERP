import { VoucherNature } from '@prisma/client';

/**
 * The kinds of voucher the books recognise (Annexure D.11), and which of them a
 * person may write by hand.
 *
 * The ten manual kinds each get their own SCREEN rather than a type dropdown on
 * one shared form. An accountant does not sit down to "write a voucher" — they
 * sit down to enter the day's cash receipts, or to pass a journal. The kind is
 * decided before the form is opened, not on it, and each kind is then free to
 * grow the fields it alone needs.
 *
 * Receipts and payments split by WHERE the money moved, because that is the
 * only thing that distinguishes them in practice: a cash receipt hits the cash
 * account and a bank receipt the bank account, and the two are counted,
 * reconciled and questioned separately.
 *
 * Everything else is SYSTEM-ONLY: payroll is posted by the payroll run, an
 * intercompany transfer by the transfer. Letting those be hand-written would
 * mean the same event could reach the ledger twice, by two routes, with nothing
 * to reconcile them.
 *
 * `documentCode` keys the numbering rule, so each kind has its own series and
 * its own prefix — a cash receipt and a bank receipt raised on the same day do
 * not share a number.
 */
export interface VoucherTypeSeed {
  code: string;
  name: string;
  nature: VoucherNature;
  documentCode: string;
  isSystemOnly: boolean;
}

/**
 * The screen a hand-written kind is entered on — and, because a workflow is
 * configured against a FORM, the document type its approvals hang from.
 *
 * One route per kind is what lets a bank payment need three signatures while a
 * journal needs one: they are ten forms in the Workflow setup, not one.
 *
 * Derived from the code by construction, and true of all ten. It has to agree
 * with ACCOUNTS_VOUCHER_MENU, which is where these screens are registered as
 * objects; the two cannot be one list because a module may not import another
 * module (see src/contracts/README.md). Where they disagree the object lookup
 * finds nothing and submitting says so, loudly, rather than approvals quietly
 * never applying.
 */
export const voucherRoute = (code: string) =>
  `/accounts/vouchers/${code.toLowerCase().replace(/_/g, '-')}`;

export const VOUCHER_TYPES: VoucherTypeSeed[] = [
  // ---- written by hand, one screen each ----
  {
    code: 'CASH_RECEIPT',
    name: 'Cash Receipt',
    nature: 'RECEIPT',
    documentCode: 'CASH_RECEIPT_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'CASH_PAYMENT',
    name: 'Cash Payment',
    nature: 'PAYMENT',
    documentCode: 'CASH_PAYMENT_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'BANK_RECEIPT',
    name: 'Bank Receipt',
    nature: 'RECEIPT',
    documentCode: 'BANK_RECEIPT_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'BANK_PAYMENT',
    name: 'Bank Payment',
    nature: 'PAYMENT',
    documentCode: 'BANK_PAYMENT_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'PURCHASE',
    name: 'Purchase Voucher',
    nature: 'PURCHASE',
    documentCode: 'PURCHASE_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'SALES',
    name: 'Sales Voucher',
    nature: 'SALES',
    documentCode: 'SALES_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'JOURNAL',
    name: 'Journal Voucher',
    nature: 'JOURNAL',
    documentCode: 'JOURNAL_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'CONTRA',
    name: 'Contra Voucher',
    nature: 'CONTRA',
    documentCode: 'CONTRA_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'DEBIT_NOTE',
    name: 'Debit Note',
    nature: 'DEBIT_NOTE',
    documentCode: 'DEBIT_NOTE_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'CREDIT_NOTE',
    name: 'Credit Note',
    nature: 'CREDIT_NOTE',
    documentCode: 'CREDIT_NOTE_VOUCHER',
    isSystemOnly: false,
  },
  // ---- written by the module that owns the event ----
  { code: 'PAYROLL', name: 'Payroll Voucher', nature: 'PAYROLL', documentCode: 'PAYROLL_VOUCHER', isSystemOnly: true },
  { code: 'DEPRECIATION', name: 'Depreciation Voucher', nature: 'DEPRECIATION', documentCode: 'DEPRECIATION_VOUCHER', isSystemOnly: true },
  { code: 'INTERCOMPANY', name: 'Intercompany Voucher', nature: 'INTERCOMPANY', documentCode: 'INTERCOMPANY_VOUCHER', isSystemOnly: true },
  { code: 'MESS', name: 'Mess Voucher', nature: 'MESS', documentCode: 'MESS_VOUCHER', isSystemOnly: true },
  { code: 'GST_SETOFF', name: 'GST Set-off Voucher', nature: 'GST_SETOFF', documentCode: 'GST_SETOFF_VOUCHER', isSystemOnly: true },
  { code: 'OPENING', name: 'Opening Voucher', nature: 'OPENING', documentCode: 'OPENING_VOUCHER', isSystemOnly: true },
];

/**
 * Kinds that no longer exist as a screen. PAYMENT and RECEIPT each split into a
 * cash and a bank kind, so the undivided originals are switched OFF rather than
 * deleted — a voucher already raised under one still points at its type row,
 * and the books have to be able to say what they said.
 */
export const RETIRED_VOUCHER_TYPES = ['PAYMENT', 'RECEIPT'];

/** Numbering falls back to this when a company has configured no rule. */
export const VOUCHER_NUMBER_PREFIX: Record<string, string> = {
  CASH_RECEIPT: 'CRV-',
  CASH_PAYMENT: 'CPV-',
  BANK_RECEIPT: 'BRV-',
  BANK_PAYMENT: 'BPV-',
  PURCHASE: 'PUV-',
  SALES: 'SV-',
  JOURNAL: 'JV-',
  CONTRA: 'CV-',
  DEBIT_NOTE: 'DN-',
  CREDIT_NOTE: 'CN-',
  PAYROLL: 'PRV-',
  DEPRECIATION: 'DPV-',
  INTERCOMPANY: 'ICV-',
  MESS: 'MV-',
  GST_SETOFF: 'GSV-',
  OPENING: 'OPV-',
};
