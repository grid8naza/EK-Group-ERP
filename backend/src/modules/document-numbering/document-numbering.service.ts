import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NumberingPeriodPosition,
  NumberingRenumber,
  StockTxnType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingDefault, NumberingPort } from '../../contracts/numbering.port';
import { SaveNumberingRuleDto } from './document-numbering.dto';

/** The rule as stored (the shape format()/periodKey() read). */
interface RuleState {
  prefixEnabled: boolean;
  prefixValue: string | null;
  startingNo: number;
  suffixEnabled: boolean;
  suffixValue: string | null;
  paddingLength: number;
  renumber: NumberingRenumber;
  periodPosition: NumberingPeriodPosition;
}

/** A string filter matching one period's numbers ("EKF/GI/…/07-2026"). */
interface NumberFilter {
  startsWith: string;
  endsWith: string;
}

/**
 * Where a document's issued numbers actually live. The next number is read back
 * from these — MAX + 1 — so nothing is stored and nothing drifts.
 *
 * A code may have SEVERAL sources: a delivery note is written both by the
 * Inventory delivery screen and by a CRM dispatch, and both draw on one
 * sequence. Numbers are per COMPANY, matching how every rule is scoped.
 *
 * Adding a numbered document: seed its code in DocumentService.SYSTEM_DOCUMENTS
 * and add its column here, or its numbering silently restarts at 1 every time.
 */
type NumberSource = (
  prisma: PrismaService,
  companyId: number,
  match: NumberFilter,
) => Promise<(string | null)[]>;

/** Newest numbers first; zero-padding makes the string order the numeric one. */
const SCAN_LIMIT = 200;

const SOURCES: Record<string, NumberSource[]> = {
  OPENING_STOCK: [
    (p, companyId, docNo) =>
      p.openingStock
        .findMany({
          where: { companyId, docNo },
          select: { docNo: true },
          orderBy: { docNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.docNo)),
  ],
  PURCHASE_ORDER_IC: [
    (p, companyId, orderNo) =>
      p.purchaseOrder
        .findMany({
          where: { companyId, orderNo },
          select: { orderNo: true },
          orderBy: { orderNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.orderNo)),
  ],
  PURCHASE_ORDER_LOCAL: [
    (p, companyId, orderNo) =>
      p.localPurchaseOrder
        .findMany({
          where: { companyId, orderNo },
          select: { orderNo: true },
          orderBy: { orderNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.orderNo)),
  ],
  SALES_ORDER_IC: [
    (p, companyId, orderNo) =>
      p.salesOrder
        .findMany({
          where: { companyId, orderNo },
          select: { orderNo: true },
          orderBy: { orderNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.orderNo)),
  ],
  WORK_ORDER: [
    (p, companyId, orderNo) =>
      p.workOrder
        .findMany({
          where: { companyId, orderNo },
          select: { orderNo: true },
          orderBy: { orderNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.orderNo)),
  ],
  PRODUCTION_PLAN: [
    (p, companyId, planNo) =>
      p.productionPlan
        .findMany({
          where: { companyId, planNo },
          select: { planNo: true },
          orderBy: { planNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.planNo)),
  ],
  MATERIAL_REQUEST: [
    (p, companyId, requestNo) =>
      p.materialRequest
        .findMany({
          where: { companyId, requestNo },
          select: { requestNo: true },
          orderBy: { requestNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.requestNo)),
  ],
  PRODUCTION_RECEIPT: [
    (p, companyId, receiptNo) =>
      p.productionReceipt
        .findMany({
          where: { companyId, receiptNo },
          select: { receiptNo: true },
          orderBy: { receiptNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.receiptNo)),
  ],
  PACKING: [
    (p, companyId, packingNo) =>
      p.packing
        .findMany({
          where: { companyId, packingNo },
          select: { packingNo: true },
          orderBy: { packingNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.packingNo)),
  ],
  DISPATCH: [
    (p, companyId, dispatchNo) =>
      p.dispatch
        .findMany({
          where: { companyId, dispatchNo },
          select: { dispatchNo: true },
          orderBy: { dispatchNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.dispatchNo)),
  ],
  SALES_INVOICE: [
    (p, companyId, invoiceNo) =>
      p.dispatch
        .findMany({
          where: { companyId, invoiceNo },
          select: { invoiceNo: true },
          orderBy: { invoiceNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.invoiceNo)),
  ],
  EWAY_BILL: [
    (p, companyId, ewayBillNo) =>
      p.dispatch
        .findMany({
          where: { companyId, ewayBillNo },
          select: { ewayBillNo: true },
          orderBy: { ewayBillNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.ewayBillNo)),
  ],
  // Written by the Inventory delivery screen AND by a CRM dispatch.
  DELIVERY_NOTE: [
    stockTransactionSource(StockTxnType.SALE),
    (p, companyId, deliveryNoteNo) =>
      p.dispatch
        .findMany({
          where: { companyId, deliveryNoteNo },
          select: { deliveryNoteNo: true },
          orderBy: { deliveryNoteNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.deliveryNoteNo)),
  ],
  GOODS_RECEIPT_NOTE: [stockTransactionSource(StockTxnType.PURCHASE)],
  SALES_RETURN: [stockTransactionSource(StockTxnType.SALES_RETURN)],
  PURCHASE_RETURN: [stockTransactionSource(StockTxnType.PURCHASE_RETURN)],
  // Written by the Inventory goods-issue screen AND by a material request issue.
  GOODS_ISSUE_NOTE: [
    stockTransactionSource(StockTxnType.CONSUMPTION),
    (p, companyId, issueNo) =>
      p.materialRequest
        .findMany({
          where: { companyId, issueNo },
          select: { issueNo: true },
          orderBy: { issueNo: 'desc' },
          take: SCAN_LIMIT,
        })
        .then((r) => r.map((x) => x.issueNo)),
  ],
};

/** Stock-transaction documents of one type — they all number off `docNo`. */
function stockTransactionSource(type: StockTxnType): NumberSource {
  return (p, companyId, docNo) =>
    p.stockTransaction
      .findMany({
        where: { companyId, type, docNo },
        select: { docNo: true },
        orderBy: { docNo: 'desc' },
        take: SCAN_LIMIT,
      })
      .then((r) => r.map((x) => x.docNo));
}

@Injectable()
export class DocumentNumberingService implements NumberingPort {
  constructor(private prisma: PrismaService) {}

  /** Every active document plus this company's rule (or defaults if unset). */
  async overview(companyId: number | undefined) {
    const docs = await this.prisma.document.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const rules = companyId
      ? await this.prisma.documentNumberingRule.findMany({ where: { companyId } })
      : [];
    const byDoc = new Map(rules.map((r) => [r.documentId, r]));
    const now = new Date();
    return Promise.all(
      docs.map(async (d) => {
      const r = byDoc.get(d.id);
      const shape: RuleState = {
        prefixEnabled: r?.prefixEnabled ?? true,
        prefixValue: r?.prefixValue ?? null,
        startingNo: r?.startingNo ?? 1,
        suffixEnabled: r?.suffixEnabled ?? false,
        suffixValue: r?.suffixValue ?? null,
        paddingLength: r?.paddingLength ?? 5,
        renumber: (r?.renumber ?? 'NEVER') as NumberingRenumber,
        periodPosition: (r?.periodPosition ??
          'BEFORE_SUFFIX') as NumberingPeriodPosition,
      };
      // Read back what has actually been issued rather than a stored counter,
      // and show the number this rule would hand out next.
      const issued =
        companyId != null
          ? await this.maxIssued(companyId, d.code, shape, now)
          : null;
      const nextNo = Math.max(issued == null ? shape.startingNo : issued + 1, shape.startingNo);
      return {
        documentId: d.id,
        documentName: d.name,
        documentCode: d.code,
        isSystem: d.isSystem,
        configured: !!r,
        prefixEnabled: r?.prefixEnabled ?? true,
        prefixValue: r?.prefixValue ?? null,
        startingNo: r?.startingNo ?? 1,
        suffixEnabled: r?.suffixEnabled ?? false,
        suffixValue: r?.suffixValue ?? null,
        paddingLength: r?.paddingLength ?? 5,
        renumber: r?.renumber ?? 'NEVER',
        periodPosition: r?.periodPosition ?? 'BEFORE_SUFFIX',
        isLocked: r?.isLocked ?? false,
        /** Highest number issued in the current period (0 when none yet). */
        lastNumber: issued ?? 0,
        // The number this document would actually take next.
        preview: this.format(shape, nextNo, now),
      };
      }),
    );
  }

  async save(companyId: number | undefined, dto: SaveNumberingRuleDto) {
    if (!companyId) {
      throw new BadRequestException('Select a company before setting numbering.');
    }
    const doc = await this.prisma.document.findUnique({
      where: { id: dto.documentId },
    });
    if (!doc) throw new BadRequestException('Choose a valid document.');

    const current = await this.prisma.documentNumberingRule.findUnique({
      where: { companyId_documentId: { companyId, documentId: dto.documentId } },
    });
    if (current?.isLocked) {
      throw new BadRequestException(
        'This numbering rule is locked. Unlock it first to edit.',
      );
    }

    const prefixEnabled = dto.prefixEnabled ?? true;
    const suffixEnabled = dto.suffixEnabled ?? false;
    const data = {
      prefixEnabled,
      prefixValue: prefixEnabled ? dto.prefixValue?.trim() || null : null,
      startingNo: dto.startingNo ?? 1,
      suffixEnabled,
      suffixValue: suffixEnabled ? dto.suffixValue?.trim() || null : null,
      paddingLength: dto.paddingLength ?? 5,
      renumber: (dto.renumber ?? 'NEVER') as NumberingRenumber,
      periodPosition: (dto.periodPosition ??
        'BEFORE_SUFFIX') as NumberingPeriodPosition,
    };
    return this.prisma.documentNumberingRule.upsert({
      where: { companyId_documentId: { companyId, documentId: dto.documentId } },
      create: { companyId, documentId: dto.documentId, ...data },
      update: data,
    });
  }

  async remove(companyId: number | undefined, documentId: number) {
    if (companyId) {
      const existing = await this.prisma.documentNumberingRule.findUnique({
        where: { companyId_documentId: { companyId, documentId } },
      });
      if (existing?.isLocked) {
        throw new BadRequestException(
          'This numbering rule is locked. Unlock it first to remove.',
        );
      }
      await this.prisma.documentNumberingRule.deleteMany({
        where: { companyId, documentId },
      });
    }
    return { success: true };
  }

  /** Lock/unlock the (company, document) rule, creating a default one if needed. */
  async setLock(
    companyId: number | undefined,
    documentId: number,
    locked: boolean,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before locking.');
    }
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new BadRequestException('Choose a valid document.');
    await this.prisma.documentNumberingRule.upsert({
      where: { companyId_documentId: { companyId, documentId } },
      create: { companyId, documentId, isLocked: locked },
      update: { isLocked: locked },
    });
    return { success: true };
  }

  // ---- NumberingPort ----

  async next(
    companyId: number,
    documentCode: string,
    date: Date = new Date(),
  ): Promise<string | null> {
    const rule = await this.ruleFor(companyId, documentCode);
    if (!rule) return null;
    const n = await this.nextSeq(companyId, documentCode, rule, date, 0);
    return this.format(rule, n, date);
  }

  async nextOrDefault(
    companyId: number,
    documentCode: string,
    fallback: NumberingDefault,
    date: Date = new Date(),
    attempt = 0,
  ): Promise<string> {
    const rule = await this.ruleFor(companyId, documentCode);
    // No rule configured: the caller's own scheme, numbered the same way.
    const effective: RuleState = rule ?? {
      prefixEnabled: true,
      prefixValue: fallback.prefix,
      startingNo: 1,
      suffixEnabled: false,
      suffixValue: null,
      paddingLength: fallback.padding,
      renumber: 'NEVER',
      periodPosition: 'BEFORE_SUFFIX',
    };
    const n = await this.nextSeq(
      companyId,
      documentCode,
      effective,
      date,
      attempt,
    );
    return this.format(effective, n, date);
  }

  // ---- deriving the next sequence ----

  /** This company's rule for a document code, or null when none is configured. */
  private async ruleFor(
    companyId: number,
    documentCode: string,
  ): Promise<RuleState | null> {
    const doc = await this.prisma.document.findUnique({
      where: { code: documentCode },
      select: { id: true },
    });
    if (!doc) return null;
    return this.prisma.documentNumberingRule.findUnique({
      where: { companyId_documentId: { companyId, documentId: doc.id } },
    });
  }

  /**
   * MAX(issued) + 1 for this rule's current period — `Nz(DMax(...),0)+1`. No
   * counter is stored anywhere: the documents themselves are the counter, so
   * deleting them all takes numbering back to the start, and a rule edited
   * mid-life picks up from whatever its new shape has actually issued.
   */
  private async nextSeq(
    companyId: number,
    documentCode: string,
    rule: RuleState,
    date: Date,
    attempt: number,
  ): Promise<number> {
    const max = await this.maxIssued(companyId, documentCode, rule, date);
    // Nothing issued yet — the rule's "Starting no" decides where to begin, so
    // a company that sets 100 gets 00100 first, not 00001. It is also a FLOOR:
    // raising the starting number later moves the sequence up to it.
    const start = rule.startingNo || 1;
    return Math.max(max == null ? start : max + 1, start) + attempt;
  }

  /** The highest sequence issued in this period, or null when there is none. */
  private async maxIssued(
    companyId: number,
    documentCode: string,
    rule: RuleState,
    date: Date,
  ): Promise<number | null> {
    const sources = SOURCES[documentCode];
    if (!sources?.length) return null;
    // The number's fixed parts around the sequence, for this period.
    const { left, right } = this.affixes(rule, date);
    const match: NumberFilter = { startsWith: left, endsWith: right };

    const found = await Promise.all(
      sources.map((read) => read(this.prisma, companyId, match)),
    );
    let max: number | null = null;
    for (const no of found.flat()) {
      if (!no) continue;
      const seq = Number(no.slice(left.length, no.length - right.length));
      // A number that doesn't parse belongs to some older shape — ignore it
      // rather than let one stray row freeze the sequence.
      if (Number.isSafeInteger(seq) && (max == null || seq > max)) max = seq;
    }
    return max;
  }

  /** What sits either side of the sequence in a number of this period. */
  private affixes(
    rule: RuleState,
    date: Date,
  ): { left: string; right: string } {
    // Formatting a known sequence and splitting on it keeps this in step with
    // format() by construction — one place decides the shape.
    // The marker must be alphanumeric like a real sequence, or the period
    // separator joins differently and the affixes come out wrong.
    const marker = 'SEQMARKER';
    const shaped = this.format({ ...rule, paddingLength: 0 }, marker, date);
    const [left, right] = shaped.split(marker);
    return { left, right: right ?? '' };
  }

  // ---- formatting ----

  /** `num` is a sequence, or the placeholder affixes() splits the shape on. */
  private format(rule: RuleState, num: number | string, date: Date): string {
    const body =
      typeof num === 'number'
        ? String(num).padStart(rule.paddingLength || 5, '0')
        : num;
    const prefix = rule.prefixEnabled ? rule.prefixValue ?? '' : '';
    const suffix = rule.suffixEnabled ? rule.suffixValue ?? '' : '';
    const period = this.periodToken(rule.renumber, date);
    if (!period) return `${prefix}${body}${suffix}`;
    // The month/year token sits before or after the configured suffix, joined
    // with a "/" separator — but only when what precedes it doesn't already end
    // in a separator (e.g. a suffix like "/EKG/" already supplies the slash).
    if (rule.periodPosition === 'AFTER_SUFFIX') {
      const base = `${prefix}${body}${suffix}`;
      return base + this.joinPeriod(base, period);
    }
    const base = `${prefix}${body}`;
    return base + this.joinPeriod(base, period) + suffix;
  }

  /** Prefix the period token with a "/" separator unless `base` already ends in one. */
  private joinPeriod(base: string, period: string): string {
    const last = base.slice(-1);
    const needsSep = !!last && /[A-Za-z0-9]/.test(last);
    return (needsSep ? '/' : '') + period;
  }

  /** Bucket the counter resets by: month, year, or a single all-time bucket. */
  private periodKey(renumber: NumberingRenumber, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    if (renumber === 'MONTHLY') return `${y}${m}`;
    if (renumber === 'YEARLY') return `${y}`;
    return 'ALL';
  }

  /** The month/year token appended to the number (empty for NEVER). */
  private periodToken(renumber: NumberingRenumber, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    if (renumber === 'MONTHLY') return `${m}-${y}`; // e.g. 07-2026
    if (renumber === 'YEARLY') return `${y}`; // e.g. 2026
    return '';
  }
}
