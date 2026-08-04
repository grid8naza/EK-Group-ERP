import { VoucherNature } from '@prisma/client';

/**
 * The kinds of voucher the books recognise (Annexure D.11), and which of them a
 * person may write by hand.
 *
 * The four manual kinds are the ones an accountant raises directly. Everything
 * else is SYSTEM-ONLY: a sale is posted by the invoice that made it, payroll by
 * the payroll run. Letting those be hand-written would mean the same event
 * could reach the ledger twice, by two routes, with nothing to reconcile them.
 *
 * `documentCode` keys the numbering rule, so each kind has its own series and
 * its own prefix — a payment and a receipt raised on the same day do not share
 * a number.
 */
export interface VoucherTypeSeed {
  code: string;
  name: string;
  nature: VoucherNature;
  documentCode: string;
  isSystemOnly: boolean;
}

export const VOUCHER_TYPES: VoucherTypeSeed[] = [
  // ---- written by hand ----
  {
    code: 'JOURNAL',
    name: 'Journal Voucher',
    nature: 'JOURNAL',
    documentCode: 'JOURNAL_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'PAYMENT',
    name: 'Payment Voucher',
    nature: 'PAYMENT',
    documentCode: 'PAYMENT_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'RECEIPT',
    name: 'Receipt Voucher',
    nature: 'RECEIPT',
    documentCode: 'RECEIPT_VOUCHER',
    isSystemOnly: false,
  },
  {
    code: 'CONTRA',
    name: 'Contra Voucher',
    nature: 'CONTRA',
    documentCode: 'CONTRA_VOUCHER',
    isSystemOnly: false,
  },
  // ---- written by the module that owns the event ----
  { code: 'SALES', name: 'Sales Voucher', nature: 'SALES', documentCode: 'SALES_VOUCHER', isSystemOnly: true },
  { code: 'PURCHASE', name: 'Purchase Voucher', nature: 'PURCHASE', documentCode: 'PURCHASE_VOUCHER', isSystemOnly: true },
  { code: 'CREDIT_NOTE', name: 'Credit Note', nature: 'CREDIT_NOTE', documentCode: 'CREDIT_NOTE_VOUCHER', isSystemOnly: true },
  { code: 'DEBIT_NOTE', name: 'Debit Note', nature: 'DEBIT_NOTE', documentCode: 'DEBIT_NOTE_VOUCHER', isSystemOnly: true },
  { code: 'PAYROLL', name: 'Payroll Voucher', nature: 'PAYROLL', documentCode: 'PAYROLL_VOUCHER', isSystemOnly: true },
  { code: 'DEPRECIATION', name: 'Depreciation Voucher', nature: 'DEPRECIATION', documentCode: 'DEPRECIATION_VOUCHER', isSystemOnly: true },
  { code: 'INTERCOMPANY', name: 'Intercompany Voucher', nature: 'INTERCOMPANY', documentCode: 'INTERCOMPANY_VOUCHER', isSystemOnly: true },
  { code: 'MESS', name: 'Mess Voucher', nature: 'MESS', documentCode: 'MESS_VOUCHER', isSystemOnly: true },
  { code: 'GST_SETOFF', name: 'GST Set-off Voucher', nature: 'GST_SETOFF', documentCode: 'GST_SETOFF_VOUCHER', isSystemOnly: true },
  { code: 'OPENING', name: 'Opening Voucher', nature: 'OPENING', documentCode: 'OPENING_VOUCHER', isSystemOnly: true },
];

/** Numbering falls back to this when a company has configured no rule. */
export const VOUCHER_NUMBER_PREFIX: Record<string, string> = {
  JOURNAL: 'JV-',
  PAYMENT: 'PV-',
  RECEIPT: 'RV-',
  CONTRA: 'CV-',
  SALES: 'SV-',
  PURCHASE: 'PUV-',
  CREDIT_NOTE: 'CN-',
  DEBIT_NOTE: 'DN-',
  PAYROLL: 'PRV-',
  DEPRECIATION: 'DPV-',
  INTERCOMPANY: 'ICV-',
  MESS: 'MV-',
  GST_SETOFF: 'GSV-',
  OPENING: 'OPV-',
};
