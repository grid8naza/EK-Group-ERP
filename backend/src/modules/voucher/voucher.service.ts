import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BalanceSide,
  BillRefType,
  PartyKind,
  PdcStatus,
  Prisma,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NUMBERING,
  NumberingPort,
  NumberingScope,
} from '../../contracts/numbering.port';
import {
  applyEntryRules,
  resolveEntryRules,
  type CompanyEntrySetup,
} from '../../common/entry-rules';
import {
  CancelPdcDto,
  CancelVoucherDto,
  ClearPdcDto,
  CreateVoucherDto,
  InstrumentInput,
  UpdateVoucherDto,
  VoucherLineInput,
  BillAllocationInput,
} from './voucher.dto';
import {
  CHEQUE_MODE,
  ISSUER_BANK_LOOKUP,
  PAYMENT_MODE_LOOKUP,
} from '../../common/instruments';
import { VOUCHER_NUMBER_PREFIX } from './voucher-types';
import { sideOf } from './bill-side';

/** Money is compared in paise: two decimals held as an integer never drift. */
const paise = (n: number) => Math.round(n * 100);
const fromPaise = (n: number) => n / 100;

const withLines = {
  type: true,
  instrument: true,
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: {
      account: {
        select: { id: true, code: true, name: true, nature: true },
      },
      billRefs: { orderBy: { id: 'asc' as const } },
    },
  },
};

/**
 * A stored line read back as an input, so a re-check runs the same code as a
 * first save rather than a second copy of the rules that can drift from it.
 */
const asInput = (l: {
  accountId: number;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  costCenterId: number | null;
  costObjectId: number | null;
  narration: string | null;
  transactionTypeId: number | null;
  transactionSubtypeId: number | null;
  partyId: number | null;
  billRefs?: {
    refType: BillRefType;
    side: BalanceSide | null;
    billRef: string | null;
    refNote: string | null;
    againstId: number | null;
    amount: Prisma.Decimal;
    dueDate: Date | null;
  }[];
}): VoucherLineInput => ({
  accountId: l.accountId,
  debit: Number(l.debit),
  credit: Number(l.credit),
  costCenterId: l.costCenterId ?? undefined,
  costObjectId: l.costObjectId ?? undefined,
  narration: l.narration ?? undefined,
  partyId: l.partyId ?? undefined,
  // The stack as stored, so re-checking a draft runs the same rules over the
  // same facts rather than finding no bills and refusing the line.
  bills: l.billRefs?.map((b) => ({
    refType: b.refType,
    side: b.side ?? undefined,
    billRef: b.billRef ?? undefined,
    refNote: b.refNote ?? undefined,
    againstId: b.againstId ?? undefined,
    amount: Number(b.amount),
    dueDate: b.dueDate?.toISOString(),
  })),
  // Carried back so a re-resolve keeps a line's own classification. Without
  // this an override would quietly collapse to the header's on the next save.
  transactionTypeId: l.transactionTypeId ?? undefined,
  transactionSubtypeId: l.transactionSubtypeId ?? undefined,
});

/** A voucher's classification, once checked against the taxonomy. */
interface ResolvedTransaction {
  transactionTypeId: number | null;
  transactionSubtypeId: number | null;
}

/** One bill-wise allocation, checked and ready to be written. */
interface ResolvedBill {
  refType: BillRefType;
  side: BalanceSide;
  billRef: string | null;
  refNote: string | null;
  againstId: number | null;
  amount: number;
  dueDate: Date | null;
}

/** A line once the rules have had their say, ready to be written. */
interface ResolvedLine extends ResolvedTransaction {
  bills: ResolvedBill[];
  accountId: number;
  debit: number;
  credit: number;
  costCenterId: number | null;
  costObjectId: number | null;
  narration: string | null;
  partyKind: PartyKind | null;
  partyId: number | null;
}

/**
 * The kinds that move money through a bank, and so must say how.
 *
 * Cash needs no instrument — notes are notes — and a journal moves no money at
 * all. These two are where a cheque number, an advice or a UPI reference is a
 * fact worth keeping, and where a post-dated cheque can arise.
 */
const BANK_VOUCHER_TYPES = ['BANK_PAYMENT', 'BANK_RECEIPT'];

/** A stored instrument read back as an input, so a re-save re-runs the rules. */
const instrumentAsInput = (
  i: {
    modeValueId: number;
    bankAccountId: number;
    instrumentNo: string | null;
    instrumentDate: Date | null;
    issuerBankValueId: number | null;
    chequeKind: 'CDC' | 'PDC' | null;
  } | null,
): InstrumentInput | undefined =>
  i
    ? {
        modeValueId: i.modeValueId,
        bankAccountId: i.bankAccountId,
        instrumentNo: i.instrumentNo,
        instrumentDate: i.instrumentDate?.toISOString() ?? null,
        issuerBankValueId: i.issuerBankValueId,
        chequeKind: i.chequeKind,
      }
    : undefined;

/** Codes of the two global lookups the classification is drawn from. */
const TXN_TYPE_LOOKUP_CODE = 'TRANSACTION_TYPE';
const TXN_SUBTYPE_LOOKUP_CODE = 'TRANSACTION_SUBTYPE';

/**
 * Vouchers — the general ledger's write side.
 *
 * A voucher is written, then posted, and thereafter only cancelled. Everything
 * this service refuses, it refuses for the same reason: the books have to be
 * able to say what they said. A draft is scratch paper and may be rewritten or
 * thrown away; the moment it is posted it is a record, and a correction is a
 * new voucher rather than an edit to an old one (Annexure D.12).
 */
@Injectable()
export class VoucherService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  /** The kinds a person may raise by hand. */
  types() {
    return this.prisma.voucherType.findMany({
      where: { isActive: true, isSystemOnly: false },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async list(
    companyId: number | undefined,
    filter: {
      typeId?: number;
      /** The kind by code — what a per-kind screen asks for, since it knows
          which voucher it writes but not that kind's id in this database. */
      typeCode?: string;
      status?: VoucherStatus;
      from?: string;
      to?: string;
    },
  ) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    return this.prisma.voucher.findMany({
      where: {
        companyId,
        voucherTypeId: filter.typeId,
        type: filter.typeCode ? { code: filter.typeCode } : undefined,
        status: filter.status,
        date: {
          gte: filter.from ? new Date(filter.from) : undefined,
          lte: filter.to ? new Date(`${filter.to}T23:59:59.999`) : undefined,
        },
      },
      include: withLines,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 500,
    });
  }

  /**
   * A party's bills that are still standing — what a settlement may be posted
   * against, and the raw material of both the statement of account and the
   * ageing.
   *
   * Outstanding is derived here as it is everywhere: raised, less what has been
   * posted against it. Only POSTED bills appear, because a bill that is not in
   * the books is not yet a bill; and a bill settled to the penny drops out
   * rather than lingering at zero.
   */
  async outstandingBills(
    companyId: number | undefined,
    partyKind: PartyKind,
    partyId: number,
  ) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const raised = await this.prisma.billAllocation.findMany({
      where: {
        companyId,
        partyKind,
        partyId,
        refType: 'NEW',
        status: 'POSTED',
      },
      select: {
        id: true,
        billRef: true,
        amount: true,
        side: true,
        line: { select: { debit: true } },
        date: true,
        dueDate: true,
        accountId: true,
        payments: {
          where: { status: 'POSTED' },
          select: { amount: true, side: true, line: { select: { debit: true } } },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    const today = new Date();
    return raised
      .map((b) => {
        // A bill stands one way — an invoice one way, a credit note the other —
        // and what has been posted against it counts for or against that.
        const billSide = sideOf(b);
        const settled = b.payments.reduce(
          (s, p) =>
            s + (sideOf(p) === billSide ? -paise(Number(p.amount)) : paise(Number(p.amount))),
          0,
        );
        const pending = paise(Number(b.amount)) - settled;
        return {
          id: b.id,
          billRef: b.billRef,
          accountId: b.accountId,
          /** Which way it stands, so a settlement knows which way to go. */
          side: billSide,
          date: b.date,
          dueDate: b.dueDate,
          amount: Number(b.amount),
          settled: fromPaise(settled),
          pending: fromPaise(pending),
          /** Days past due — negative while still within the credit period. */
          overdueDays: b.dueDate
            ? Math.floor((today.getTime() - b.dueDate.getTime()) / 86_400_000)
            : 0,
        };
      })
      .filter((b) => paise(b.pending) > 0);
  }

  /**
   * The number the next voucher of this kind would take, so an entry screen can
   * show it before anything is saved.
   *
   * A PREVIEW, not a reservation. Numbers are derived (MAX + 1), so nothing is
   * held back and two people who open the form together are shown the same one;
   * whoever saves first takes it and the other is renumbered on save. That is
   * the honest behaviour for a derived series — the alternative would be a
   * counter, and a counter that hands out numbers to forms nobody submits
   * leaves gaps the books cannot explain.
   */
  async nextNumber(
    companyId: number | undefined,
    branchId: number | undefined,
    typeCode: string,
  ) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const type = await this.prisma.voucherType.findUnique({
      where: { code: typeCode },
    });
    if (!type) throw new NotFoundException('Voucher type not found');
    // No branch assertion: this only shows a number. A missing branch is caught
    // on save, where it can still be acted on.
    const voucherNo = await this.numbering.nextOrDefault(
      { companyId, branchId: branchId ?? null },
      type.documentCode,
      { prefix: VOUCHER_NUMBER_PREFIX[type.code] ?? 'VCH-', padding: 5 },
    );
    return { voucherNo };
  }

  async findOne(companyId: number | undefined, id: number) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id },
      include: withLines,
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    // A voucher belongs to one company's books; another company must not read
    // it even by guessing an id.
    if (companyId && voucher.companyId !== companyId) {
      throw new NotFoundException('Voucher not found');
    }
    return voucher;
  }

  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: CreateVoucherDto,
  ) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const type = await this.assertManualType(dto.voucherTypeId);
    const date = this.assertDate(dto.date);
    const setup = await this.companySetup(companyId);
    const branch = await this.assertBranch(companyId, branchId, setup);
    const txn = await this.resolveTransaction(dto);
    const lines = await this.resolveLines(
      companyId,
      setup,
      dto.lines,
      branch,
      txn,
      date,
    );
    if (dto.post) this.assertBalanced(lines);
    const instrument = await this.resolveInstrument(
      companyId,
      type.code,
      dto.instrument,
      lines,
    );

    const totals = this.totals(lines);
    const status: VoucherStatus = dto.post ? 'POSTED' : 'DRAFT';

    return this.withNumberRetry({ companyId, branchId: branch }, type.documentCode, type.code, date, (voucherNo) =>
      this.prisma.voucher.create({
        data: {
          companyId,
          branchId: branch,
          voucherTypeId: type.id,
          voucherNo,
          date,
          narration: dto.narration?.trim() || null,
          reference: dto.reference?.trim() || null,
          ...txn,
          status,
          totalDebit: totals.debit,
          totalCredit: totals.credit,
          createdByUserId: userId,
          postedByUserId: dto.post ? userId : null,
          postedAt: dto.post ? new Date() : null,
          lines: {
            create: lines.map(({ bills, ...l }, i) => ({
              sequence: i,
              companyId: companyId,
              branchId: branch,
              date,
              status,
              ...l,
              // The bill stack this line moves. Party/account/date/status are
              // copied down so an ageing report reads that table alone.
              ...(bills.length
                ? {
                    billRefs: {
                      create: bills.map((b) => ({
                        companyId: companyId,
                        branchId: branch,
                        accountId: l.accountId,
                        partyKind: l.partyKind!,
                        partyId: l.partyId!,
                        refType: b.refType,
                        side: b.side,
                        billRef: b.billRef,
                        refNote: b.refNote,
                        againstId: b.againstId,
                        amount: b.amount,
                        dueDate: b.dueDate,
                        date,
                        status,
                      })),
                    },
                  }
                : {}),
            })),
          },
          ...(instrument
            ? { instrument: { create: { companyId, ...instrument } } }
            : {}),
        },
        include: withLines,
      }),
    );
  }

  /**
   * Rewrite a draft. The lines are replaced wholesale rather than patched —
   * a voucher is one balanced statement, not a bag of rows to amend
   * individually, and half an edit is never valid.
   */
  async update(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    id: number,
    dto: UpdateVoucherDto,
  ) {
    const existing = await this.findOne(companyId, id);
    this.assertDraft(existing.status, 'edited');

    const setup = await this.companySetup(existing.companyId);
    const date = dto.date ? this.assertDate(dto.date) : existing.date;
    const branch =
      branchId === undefined
        ? existing.branchId
        : await this.assertBranch(existing.companyId, branchId, setup);

    // A classification left out of the patch keeps what the draft already said.
    const txn = await this.resolveTransaction({
      transactionTypeId:
        dto.transactionTypeId !== undefined
          ? dto.transactionTypeId
          : existing.transactionTypeId,
      transactionSubtypeId:
        dto.transactionSubtypeId !== undefined
          ? dto.transactionSubtypeId
          : existing.transactionSubtypeId,
    });

    // Lines left alone still go through the rules: the date may have moved and
    // the company's setup may have changed since the draft was written.
    const lines = await this.resolveLines(
      existing.companyId,
      setup,
      dto.lines ?? existing.lines.map(asInput),
      branch,
      txn,
      date,
      existing.id,
    );
    if (dto.post) this.assertBalanced(lines);
    // Re-checked whether or not the patch mentions it: the lines may have moved
    // under a cheque that was already there, and a post-dated one that now
    // names the bank has to be caught here as surely as on the first save.
    const instrument = await this.resolveInstrument(
      existing.companyId,
      existing.type.code,
      dto.instrument ?? instrumentAsInput(existing.instrument),
      lines,
    );

    const totals = this.totals(lines);
    const status: VoucherStatus = dto.post ? 'POSTED' : 'DRAFT';

    return this.prisma.$transaction(async (tx) => {
      await tx.voucherLine.deleteMany({ where: { voucherId: id } });
      return tx.voucher.update({
        where: { id },
        data: {
          date,
          branchId: branch,
          narration:
            dto.narration !== undefined ? dto.narration?.trim() || null : undefined,
          reference:
            dto.reference !== undefined ? dto.reference?.trim() || null : undefined,
          ...txn,
          status,
          totalDebit: totals.debit,
          totalCredit: totals.credit,
          postedByUserId: dto.post ? userId : null,
          postedAt: dto.post ? new Date() : null,
          lines: {
            create: lines.map(({ bills, ...l }, i) => ({
              sequence: i,
              companyId: existing.companyId,
              branchId: branch,
              date,
              status,
              ...l,
              // The bill stack this line moves. Party/account/date/status are
              // copied down so an ageing report reads that table alone.
              ...(bills.length
                ? {
                    billRefs: {
                      create: bills.map((b) => ({
                        companyId: existing.companyId,
                        branchId: branch,
                        accountId: l.accountId,
                        partyKind: l.partyKind!,
                        partyId: l.partyId!,
                        refType: b.refType,
                        side: b.side,
                        billRef: b.billRef,
                        refNote: b.refNote,
                        againstId: b.againstId,
                        amount: b.amount,
                        dueDate: b.dueDate,
                        date,
                        status,
                      })),
                    },
                  }
                : {}),
            })),
          },
          ...(instrument
            ? {
                instrument: {
                  upsert: {
                    create: { companyId: existing.companyId, ...instrument },
                    update: instrument,
                  },
                },
              }
            : {}),
        },
        include: withLines,
      });
    });
  }

  /** Write a draft to the books. */
  async post(userId: number, companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    this.assertDraft(existing.status, 'posted');

    // Re-checked at the moment of posting, not merely when the draft was
    // written: an account may have been deactivated since, and the rules are
    // about what the books accept NOW.
    const setup = await this.companySetup(existing.companyId);
    const checked = await this.resolveLines(
      existing.companyId,
      setup,
      existing.lines.map(asInput),
      existing.branchId,
      // The header's own classification is re-checked too — the taxonomy may
      // have been edited since the draft was written.
      await this.resolveTransaction(existing),
      existing.date,
      existing.id,
    );
    this.assertBalanced(checked);

    return this.prisma.$transaction(async (tx) => {
      await tx.voucherLine.updateMany({
        where: { voucherId: id },
        data: { status: 'POSTED' },
      });
      // The bill stack moves with its lines: a bill only exists, and a
      // settlement only counts, once the voucher is in the books.
      await tx.billAllocation.updateMany({
        where: { line: { voucherId: id } },
        data: { status: 'POSTED' },
      });
      return tx.voucher.update({
        where: { id },
        data: { status: 'POSTED', postedByUserId: userId, postedAt: new Date() },
        include: withLines,
      });
    });
  }

  /**
   * Cancel a posted voucher. The rows remain, marked, with a reason — a posted
   * voucher is never deleted, so the gap in the numbering that a deletion would
   * leave never appears (D.12).
   */
  async cancel(companyId: number | undefined, id: number, dto: CancelVoucherDto) {
    const existing = await this.findOne(companyId, id);
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('This voucher is already cancelled.');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Say why it is being cancelled.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.voucherLine.updateMany({
        where: { voucherId: id },
        data: { status: 'CANCELLED' },
      });
      // Cancelling a receipt puts the bill it settled back where it was —
      // nothing has to remember to, because outstanding is derived.
      await tx.billAllocation.updateMany({
        where: { line: { voucherId: id } },
        data: { status: 'CANCELLED' },
      });
      return tx.voucher.update({
        where: { id },
        data: { status: 'CANCELLED', cancelReason: dto.reason.trim() },
        include: withLines,
      });
    });
  }

  // ---- post-dated cheques ------------------------------------------------------

  /**
   * The cheques written and not yet gone.
   *
   * Read off the instruments rather than off the vouchers: a PDC's life happens
   * after its voucher is finished, and this is the table that has a life.
   */
  async listPdc(companyId: number | undefined, status?: PdcStatus) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    return this.prisma.voucherInstrument.findMany({
      where: {
        companyId,
        chequeKind: 'PDC',
        ...(status ? { status } : {}),
      },
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            date: true,
            status: true,
            narration: true,
            totalCredit: true,
            lines: {
              orderBy: { sequence: 'asc' as const },
              select: {
                partyKind: true,
                partyId: true,
                account: { select: { id: true, name: true } },
              },
            },
          },
        },
        bankAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ instrumentDate: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * The cheque was presented and the money went.
   *
   * This is the entry the register exists to raise: on the day it actually
   * cleared — which is rarely the day written on the leaf — the liability that
   * has been standing since it was issued is discharged against the bank it was
   * always drawn on. Its own voucher, on its own date, because that is when it
   * happened; back-dating it into the issuing voucher would put money out of
   * the bank on a day the bank says it was still there.
   */
  async clearPdc(
    userId: number,
    companyId: number | undefined,
    id: number,
    dto: ClearPdcDto,
  ) {
    const pdc = await this.livePdc(companyId, id);
    const date = this.assertDate(dto.date);
    if (date < pdc.voucher.date) {
      throw new BadRequestException(
        'A cheque cannot clear before the day it was written.',
      );
    }
    if (!pdc.holdingAccountId) {
      throw new BadRequestException(
        'That cheque was not parked in a post-dated cheque ledger, so there is ' +
          'nothing to clear it out of.',
      );
    }
    const holdingAccountId = pdc.holdingAccountId;
    const amount = pdc.voucher.totalCredit;
    /** A cheque taken IN, rather than one written out. */
    const taken = pdc.voucher.type.code === 'BANK_RECEIPT';

    const type = await this.prisma.voucherType.findFirst({
      where: { code: 'JOURNAL' },
    });
    if (!type) {
      throw new BadRequestException('The journal voucher type is not set up.');
    }

    const settlement = await this.withNumberRetry(
      { companyId: pdc.companyId, branchId: pdc.voucher.branchId ?? undefined },
      type.documentCode,
      type.code,
      date,
      (voucherNo) =>
        this.prisma.voucher.create({
          data: {
            companyId: pdc.companyId,
            branchId: pdc.voucher.branchId,
            voucherTypeId: type.id,
            voucherNo,
            date,
            narration:
              `Cheque ${pdc.instrumentNo ?? ''} cleared — ${pdc.voucher.voucherNo}`.trim(),
            reference: pdc.instrumentNo,
            status: 'POSTED',
            totalDebit: amount,
            totalCredit: amount,
            createdByUserId: userId,
            postedByUserId: userId,
            postedAt: new Date(),
            sourceModule: 'accounts',
            sourceDocType: 'PDC_CLEARANCE',
            sourceDocId: pdc.id,
            lines: {
              create: [
                // Which way round follows from whose cheque it was. Ours going
                // out: the promise is discharged and the bank parts with the
                // money — Dr holding, Cr bank. Theirs coming in: the bank has
                // it now and the asset we were holding is gone — Dr bank, Cr
                // holding.
                {
                  sequence: 0,
                  companyId: pdc.companyId,
                  branchId: pdc.voucher.branchId,
                  date,
                  status: 'POSTED',
                  accountId: taken ? pdc.bankAccountId : holdingAccountId,
                  debit: amount,
                  credit: 0,
                },
                {
                  sequence: 1,
                  companyId: pdc.companyId,
                  branchId: pdc.voucher.branchId,
                  date,
                  status: 'POSTED',
                  accountId: taken ? holdingAccountId : pdc.bankAccountId,
                  debit: 0,
                  credit: amount,
                },
              ],
            },
          },
          include: withLines,
        }),
    );

    await this.prisma.voucherInstrument.update({
      where: { id: pdc.id },
      data: {
        status: 'CLEARED',
        settledOn: date,
        settlementVoucherId: settlement.id,
      },
    });
    return settlement;
  }

  /**
   * The cheque was torn up, or another was written in its place.
   *
   * Nothing is posted: cancelling the voucher that issued it is the whole of
   * it. Its lines and its bill allocations go CANCELLED, and because what a
   * party still owes is DERIVED from the live allocations rather than stored,
   * the bill it was paying stands open again by itself — see cancel().
   *
   * REPLACED rather than CANCELLED where a fresh cheque follows, so the
   * register can say which of the two happened; the replacement names this one
   * when it is written.
   */
  async cancelPdc(
    companyId: number | undefined,
    id: number,
    dto: CancelPdcDto,
    replaced = false,
  ) {
    const pdc = await this.livePdc(companyId, id);
    const date = this.assertDate(dto.date);
    await this.cancel(companyId, pdc.voucherId, {
      reason: dto.reason.trim(),
    });
    return this.prisma.voucherInstrument.update({
      where: { id: pdc.id },
      data: {
        status: replaced ? 'REPLACED' : 'CANCELLED',
        settledOn: date,
      },
    });
  }

  /** The cheque this company issued, still live, or a reason it is not. */
  private async livePdc(companyId: number | undefined, id: number) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const pdc = await this.prisma.voucherInstrument.findUnique({
      where: { id },
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            date: true,
            branchId: true,
            totalCredit: true,
            status: true,
            type: { select: { code: true } },
          },
        },
      },
    });
    if (!pdc || pdc.companyId !== companyId) {
      throw new NotFoundException('That cheque is not on the register.');
    }
    if (pdc.chequeKind !== 'PDC') {
      throw new BadRequestException(
        'Only a post-dated cheque has anything left to do.',
      );
    }
    if (pdc.status !== 'ISSUED') {
      throw new BadRequestException(
        `That cheque is already ${pdc.status?.toLowerCase()}.`,
      );
    }
    return pdc;
  }

  /**
   * Whose bank a cheque taken in was drawn on.
   *
   * Refused on a payment: the issuer there is this company, and the bank is the
   * one already named. A list rather than free text, so the same bank is spelt
   * the same way on every receipt and a report can group by it.
   */
  private async resolveIssuerBank(
    valueId: number | null | undefined,
    received: boolean,
  ): Promise<number | null> {
    if (valueId == null) return null;
    if (!received) {
      throw new BadRequestException(
        'A cheque written by this company is drawn on its own bank — there is ' +
          'no other issuer to name.',
      );
    }
    const value = await this.prisma.lookupValue.findUnique({
      where: { id: valueId },
      select: {
        isActive: true,
        lookup: { select: { code: true } },
      },
    });
    if (!value || value.lookup.code !== ISSUER_BANK_LOOKUP || !value.isActive) {
      throw new BadRequestException('Choose the bank the cheque is drawn on.');
    }
    return valueId;
  }

  /**
   * The post-dated cheque ledger this voucher parks the promise in.
   *
   * Found by the FLAG on the account rather than by a code: which ledger holds
   * post-dated cheques is the company's own decision, made on Account Ledgers,
   * and a code written into the software would be wrong for the first company
   * that keeps two of them.
   */
  private async pdcLedgerOnLines(
    companyId: number,
    lines: { accountId: number }[],
    received: boolean,
  ) {
    const ledgers = await this.prisma.account.findMany({
      where: {
        id: { in: lines.map((l) => l.accountId) },
        ...(received ? { isPdcReceived: true } : { isPdcIssued: true }),
        isActive: true,
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true, code: true, name: true },
    });
    if (!ledgers.length) {
      throw new BadRequestException(
        `A post-dated cheque waits in a ledger of its own until it clears — name ` +
          `an account ticked "PDC ${received ? 'received' : 'issued'}" on the ` +
          `line instead of the bank.`,
      );
    }
    if (ledgers.length > 1) {
      throw new BadRequestException(
        'Two post-dated cheque ledgers on one voucher — the register would not ' +
          'know which one to clear.',
      );
    }
    return ledgers[0];
  }

  /** Only a draft can be thrown away; a posted voucher is cancelled instead. */
  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    this.assertDraft(existing.status, 'deleted');
    await this.prisma.voucher.delete({ where: { id } });
    return { deleted: true };
  }

  // ---- rules -----------------------------------------------------------------

  private assertDraft(status: VoucherStatus, verb: string) {
    if (status !== 'DRAFT') {
      throw new ForbiddenException(
        status === 'CANCELLED'
          ? `A cancelled voucher cannot be ${verb}.`
          : `A posted voucher cannot be ${verb} — reverse it with a fresh voucher instead.`,
      );
    }
  }

  /**
   * How the money moved — checked, and refused where it makes no sense.
   *
   * Asked for by the bank kinds and by nothing else. A cheque must say which
   * one and when, and whether it is due now or later; every other mode is done
   * the moment it is entered and has nothing more to say.
   *
   * A post-dated cheque must NOT touch the bank: the bank knows nothing about
   * a leaf that has not been presented, and a books balance that runs ahead of
   * the statement is the thing this whole arrangement exists to prevent. It
   * credits the holding account instead, and the bank named here is the record
   * of which chequebook it came from.
   */
  private async resolveInstrument(
    companyId: number,
    typeCode: string,
    input: InstrumentInput | undefined,
    lines: { accountId: number }[],
  ) {
    const wanted = BANK_VOUCHER_TYPES.includes(typeCode);
    if (!wanted) {
      if (input) {
        throw new BadRequestException(
          'Only a bank receipt or payment carries an instrument.',
        );
      }
      return null;
    }
    if (!input) {
      throw new BadRequestException('Say how the money moved.');
    }

    const mode = await this.prisma.lookupValue.findUnique({
      where: { id: input.modeValueId },
      select: {
        value: true,
        label: true,
        isActive: true,
        lookup: { select: { code: true } },
      },
    });
    if (
      !mode ||
      mode.lookup.code !== PAYMENT_MODE_LOOKUP ||
      !mode.isActive
    ) {
      throw new BadRequestException('Choose how the money moved.');
    }

    const bank = await this.prisma.account.findUnique({
      where: { id: input.bankAccountId },
      select: {
        id: true,
        code: true,
        name: true,
        isBank: true,
        isActive: true,
        companies: { where: { companyId }, select: { isActive: true } },
      },
    });
    if (!bank || !bank.isBank || !bank.isActive) {
      throw new BadRequestException('Choose the bank account it goes through.');
    }
    if (!bank.companies.length || bank.companies[0].isActive === false) {
      throw new BadRequestException(
        `${bank.code} ${bank.name} is not in use by this company.`,
      );
    }

    const received = typeCode === 'BANK_RECEIPT';
    const issuerBankValueId = await this.resolveIssuerBank(
      input.issuerBankValueId,
      received,
    );

    const isCheque = mode.value === CHEQUE_MODE || mode.label === CHEQUE_MODE;
    if (!isCheque) {
      if (input.chequeKind) {
        throw new BadRequestException(
          `${mode.label} is not a cheque, so it is neither post-dated nor current-dated.`,
        );
      }
      return {
        modeValueId: input.modeValueId,
        bankAccountId: bank.id,
        instrumentNo: input.instrumentNo?.trim() || null,
        instrumentDate: input.instrumentDate
          ? this.assertDate(input.instrumentDate)
          : null,
        issuerBankValueId,
        chequeKind: null,
        holdingAccountId: null,
        status: null,
      };
    }

    // A cheque taken in was written by somebody, on somebody's bank, and that
    // is the thread a returned cheque is followed back along.
    if (received && !issuerBankValueId) {
      throw new BadRequestException('Say which bank the cheque is drawn on.');
    }

    if (!input.instrumentNo?.trim()) {
      throw new BadRequestException('Give the cheque number.');
    }
    if (!input.instrumentDate) {
      throw new BadRequestException('Give the date written on the cheque.');
    }
    if (!input.chequeKind) {
      throw new BadRequestException(
        'Say whether the cheque is current-dated or post-dated.',
      );
    }
    const instrumentDate = this.assertDate(input.instrumentDate);

    let holdingAccountId: number | null = null;
    if (input.chequeKind === 'PDC') {
      if (lines.some((l) => l.accountId === bank.id)) {
        throw new BadRequestException(
          `A post-dated cheque does not touch ${bank.name} until it is presented — ` +
            `post it to a post-dated cheque ledger and clear it from the PDC register.`,
        );
      }
      // Which side of the promise this is, and so which ledger holds it: a
      // payment writes a cheque out, a receipt takes one in.
      const holding = await this.pdcLedgerOnLines(companyId, lines, received);
      holdingAccountId = holding.id;
    }

    return {
      modeValueId: input.modeValueId,
      bankAccountId: bank.id,
      instrumentNo: input.instrumentNo.trim(),
      instrumentDate,
      issuerBankValueId,
      chequeKind: input.chequeKind,
      holdingAccountId,
      // A current-dated cheque is finished the moment it is written; only a
      // post-dated one has anywhere left to go.
      status: input.chequeKind === 'PDC' ? ('ISSUED' as const) : null,
    };
  }

  private async assertManualType(voucherTypeId: number) {
    const type = await this.prisma.voucherType.findUnique({
      where: { id: voucherTypeId },
    });
    if (!type || !type.isActive) {
      throw new BadRequestException('Choose a voucher type.');
    }
    if (type.isSystemOnly) {
      throw new BadRequestException(
        `A ${type.name} is written by the module that raises it, not by hand.`,
      );
    }
    return type;
  }

  /** A voucher cannot predate the books it is written in. */
  private assertDate(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Give the voucher a date.');
    }
    return date;
  }

  private async companySetup(companyId: number): Promise<
    CompanyEntrySetup & { booksStartDate: Date | null }
  > {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        branchApplicable: true,
        costCenterApplicable: true,
        costObjectApplicable: true,
        booksStartDate: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /**
   * Every entry carries the branch it belongs to, where the company works in
   * branches — the first of the two entry checkpoints, and not one an account
   * may waive.
   */
  private async assertBranch(
    companyId: number,
    branchId: number | undefined,
    setup: CompanyEntrySetup,
  ): Promise<number | null> {
    const rules = resolveEntryRules(setup, null);
    if (rules.branch === 'OFF') return null;
    if (!branchId) {
      throw new BadRequestException(
        'Choose a branch — every entry belongs to one.',
      );
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { companyId: true, isActive: true },
    });
    if (!branch || branch.companyId !== companyId || !branch.isActive) {
      throw new BadRequestException('That branch is not one of this company’s.');
    }
    return branchId;
  }

  /**
   * Check each line against the account it names: that the company posts to it
   * at all, that it takes a hand-written entry, that it carries one side only,
   * and that it names the dimensions its account asks for — dropping the ones
   * it does not, rather than failing, so a screen that stamps a cost centre on
   * every line does not break on the one line whose account takes none.
   */
  private async resolveLines(
    companyId: number,
    setup: CompanyEntrySetup,
    inputs: VoucherLineInput[],
    /** The header's branch — every line belongs to it, so it is not asked for
     *  again per line, only carried into the rules that check all three. */
    branchId: number | null,
    /** The header's classification, which each line takes unless it says
     *  otherwise. Already checked, so an inheriting line costs no query. */
    header: ResolvedTransaction = {
      transactionTypeId: null,
      transactionSubtypeId: null,
    },
    /** The voucher's date — a new bill is dated from it, and falls due the
     *  party's credit period later. */
    date: Date = new Date(),
    /** Set when re-checking a voucher that already exists, so its own bills are
     *  not mistaken for duplicates of themselves. */
    excludeVoucherId?: number,
  ): Promise<ResolvedLine[]> {
    if (!inputs?.length) throw new BadRequestException('A voucher needs lines.');

    const accountIds = [...new Set(inputs.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        allowManualJe: true,
        hasCostCenter: true,
        hasCostObject: true,
        isControl: true,
        controlParty: true,
        companies: {
          where: { companyId },
          select: { isActive: true, allowPosting: true },
        },
      },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const resolved: ResolvedLine[] = [];
    for (const [i, line] of inputs.entries()) {
      const at = `line ${i + 1}`;
      const account = byId.get(line.accountId);
      if (!account) throw new BadRequestException(`Choose an account on ${at}.`);
      const label = `${account.code} ${account.name}`;
      if (!account.isActive) {
        throw new BadRequestException(`${label} is inactive (${at}).`);
      }
      // Only an account this company has adopted, and may still post to.
      const adoption = account.companies[0];
      if (!adoption?.isActive || !adoption.allowPosting) {
        throw new BadRequestException(
          `${label} is not available to this company (${at}).`,
        );
      }
      if (!account.allowManualJe) {
        throw new BadRequestException(
          `${label} does not take a hand-written entry (${at}).`,
        );
      }

      const debit = paise(line.debit ?? 0);
      const credit = paise(line.credit ?? 0);
      if (debit && credit) {
        throw new BadRequestException(
          `${at} carries both a debit and a credit — a line is one or the other.`,
        );
      }
      if (!debit && !credit) {
        throw new BadRequestException(`${at} has no amount.`);
      }

      const dims = applyEntryRules(
        resolveEntryRules(setup, account),
        {
          branchId,
          costCenterId: line.costCenterId,
          costObjectId: line.costObjectId,
        },
        label,
      );
      await this.assertDimensions(companyId, dims);

      // The header's classification unless this line overrides it. A line that
      // names only a subtype is read against the header's type, so overriding
      // "B2C Sale" to "B2B Sale" needs the one field the user actually changed.
      const named =
        line.transactionTypeId != null || line.transactionSubtypeId != null;
      const txn = named
        ? await this.resolveTransaction(
            {
              transactionTypeId:
                line.transactionTypeId ?? header.transactionTypeId,
              transactionSubtypeId: line.transactionSubtypeId,
            },
            at,
          )
        : header;

      const party = await this.resolveParty(companyId, account, line.partyId, at);
      const bills = await this.resolveBills(
        companyId,
        party,
        fromPaise(debit || credit),
        debit ? 'DR' : 'CR',
        line.bills,
        date,
        at,
        excludeVoucherId,
      );

      resolved.push({
        accountId: account.id,
        debit: fromPaise(debit),
        credit: fromPaise(credit),
        costCenterId: dims.costCenterId,
        costObjectId: dims.costObjectId,
        narration: line.narration?.trim() || null,
        ...txn,
        ...party,
        bills,
      });
    }
    return resolved;
  }

  /**
   * Check a classification against the taxonomy: the type must be a live
   * TRANSACTION_TYPE, the subtype a live TRANSACTION_SUBTYPE, and the subtype
   * must sit UNDER that type. A subtype without its type is refused rather than
   * kept alone — "B2C Sale" filed under nothing tells a statement nothing.
   *
   * `at` names where the fault is, so a bad line says which line.
   */
  private async resolveTransaction(
    input: { transactionTypeId?: number | null; transactionSubtypeId?: number | null },
    at = 'this voucher',
  ): Promise<ResolvedTransaction> {
    const typeId = input.transactionTypeId ?? null;
    const subtypeId = input.transactionSubtypeId ?? null;
    if (!typeId && !subtypeId) {
      return { transactionTypeId: null, transactionSubtypeId: null };
    }
    if (!typeId) {
      throw new BadRequestException(
        `Choose a transaction type before its subtype (${at}).`,
      );
    }

    const ids = subtypeId ? [typeId, subtypeId] : [typeId];
    const values = await this.prisma.lookupValue.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        label: true,
        isActive: true,
        parentValueId: true,
        lookup: { select: { code: true } },
      },
    });
    const byId = new Map(values.map((v) => [v.id, v]));

    const type = byId.get(typeId);
    if (
      !type ||
      type.lookup.code !== TXN_TYPE_LOOKUP_CODE ||
      !type.isActive
    ) {
      throw new BadRequestException(`Choose a valid transaction type (${at}).`);
    }
    if (!subtypeId) return { transactionTypeId: typeId, transactionSubtypeId: null };

    const subtype = byId.get(subtypeId);
    if (
      !subtype ||
      subtype.lookup.code !== TXN_SUBTYPE_LOOKUP_CODE ||
      !subtype.isActive
    ) {
      throw new BadRequestException(`Choose a valid transaction subtype (${at}).`);
    }
    if (subtype.parentValueId !== typeId) {
      throw new BadRequestException(
        `“${subtype.label}” is not a kind of “${type.label}” (${at}).`,
      );
    }
    return { transactionTypeId: typeId, transactionSubtypeId: subtypeId };
  }

  /**
   * Whose balance this line moves.
   *
   * A control account's balance is a total and nothing else — the detail is the
   * party. So a line to one WITHOUT a party is refused: it would add to a total
   * that no statement could ever break down, and the sub-ledger would silently
   * stop agreeing with the account. A line to an ordinary account carries no
   * party at all; one offered is dropped rather than stored, the same way an
   * unwanted cost centre is.
   *
   * The KIND comes from the account (`controlParty`), never from the caller —
   * the chart has already decided that creditors are aged by supplier, and
   * letting a request say otherwise would be a second answer to a settled
   * question.
   */
  private async resolveParty(
    companyId: number,
    account: {
      id: number;
      code: string;
      name: string;
      isControl: boolean;
      controlParty: PartyKind | null;
    },
    partyId: number | undefined,
    at: string,
  ): Promise<{ partyKind: PartyKind | null; partyId: number | null }> {
    if (!account.isControl) return { partyKind: null, partyId: null };

    const kind = account.controlParty;
    if (!kind) {
      // Marked as a control account but never told which party ages it. Refuse
      // rather than post a party-less line to it.
      throw new BadRequestException(
        `That account is a control account but has no party kind set (${at}).`,
      );
    }
    if (!partyId) {
      throw new BadRequestException(
        `Name the ${kind.toLowerCase()} on ${at} — this account is kept party by party.`,
      );
    }

    const party = await this.findParty(companyId, kind, partyId);
    if (!party) {
      throw new BadRequestException(
        `That ${kind.toLowerCase()} is not this company’s (${at}).`,
      );
    }
    // A party kept under ANOTHER control account cannot be posted here: its
    // balance is part of that account's total, and putting it under this one
    // would leave two accounts each holding half of one party's history. Every
    // party has a main ledger, so there is no "belongs anywhere" case.
    if (party.controlAccountId !== account.id) {
      throw new BadRequestException(
        `That ${kind.toLowerCase()} is kept under a different main ledger, so it ` +
          `cannot be named on a line to ${account.code} ${account.name} (${at}).`,
      );
    }
    return { partyKind: kind, partyId };
  }

  /**
   * Which of the party's bills this line's amount belongs to.
   *
   * The one rule everything else follows from: the allocations must come to the
   * line. A line that moves 1,000 of a party's balance has moved it against some
   * combination of that party's bills, and if the parts do not make up the whole
   * then the account and the sub-ledger have begun to disagree — quietly, and in
   * a way no later report can repair.
   *
   * They come to it as a NET, not a sum, because an allocation carries its own
   * side. Paying two invoices less a credit note is three allocations on one
   * line: two the line's way and one the other, netting to what actually left
   * the bank. Each bill is still moved by its own true figure, which is the
   * point — the note is adjusted against the invoice in the sub-ledger rather
   * than being buried inside a smaller payment.
   *
   * A control-account line must therefore carry allocations. ON_ACCOUNT is the
   * escape hatch, not an omission: it records that the bill is not yet known,
   * which is a fact worth storing and is what an unallocated-receipts report is
   * built from.
   */
  private async resolveBills(
    companyId: number,
    party: { partyKind: PartyKind | null; partyId: number | null },
    amount: number,
    /** The side of the line. Each allocation takes it unless it says otherwise. */
    lineSide: BalanceSide,
    inputs: BillAllocationInput[] | undefined,
    date: Date,
    at: string,
    excludeVoucherId: number | undefined,
  ): Promise<ResolvedBill[]> {
    // No party, no bills — an ordinary account has no stack to allocate against.
    if (!party.partyKind || !party.partyId) return [];

    if (!inputs?.length) {
      throw new BadRequestException(
        `Say which bill ${at} belongs to — this account is kept bill by bill.`,
      );
    }

    const net = inputs.reduce(
      (s, b) =>
        s + ((b.side ?? lineSide) === lineSide ? paise(b.amount) : -paise(b.amount)),
      0,
    );
    if (net !== paise(amount)) {
      const mixed = inputs.some((b) => (b.side ?? lineSide) !== lineSide);
      throw new BadRequestException(
        mixed
          ? `The bills on ${at} come to a net ${fromPaise(net).toFixed(2)} ${lineSide}, but the line is ${amount.toFixed(2)} ${lineSide}.`
          : `The bills on ${at} come to ${fromPaise(net).toFixed(2)}, but the line is ${amount.toFixed(2)}.`,
      );
    }

    // Everything an AGAINST row points at, read once. The target's own side
    // decides whether a settlement reduces it or adds to it, and a row written
    // before allocations carried a side takes its line's.
    const targetIds = inputs
      .filter((b) => b.refType === 'AGAINST')
      .map((b) => b.againstId)
      .filter((id): id is number => !!id);
    const targets = targetIds.length
      ? await this.prisma.billAllocation.findMany({
          where: { id: { in: targetIds } },
          select: {
            id: true,
            billRef: true,
            amount: true,
            side: true,
            line: { select: { debit: true } },
            companyId: true,
            partyKind: true,
            partyId: true,
            refType: true,
            status: true,
          },
        })
      : [];
    const byId = new Map(targets.map((t) => [t.id, t]));

    const creditDays = await this.creditDays(party.partyKind, party.partyId);
    const resolved: ResolvedBill[] = [];
    // Bill numbers this voucher is raising, so two lines of one entry cannot
    // both raise "INV-001" — the database would catch it, but only after the
    // rest of the voucher had been accepted.
    const raising = new Set<string>();

    for (const b of inputs) {
      // The line's side unless this allocation says otherwise — an adjustment
      // pulling the other way is the only reason it ever differs.
      const side: BalanceSide = b.side ?? lineSide;

      if (b.refType === 'NEW') {
        const ref = b.billRef?.trim();
        if (!ref) {
          throw new BadRequestException(
            `A new bill on ${at} needs its bill number.`,
          );
        }
        await this.assertBillRefFree(
          companyId,
          party.partyKind,
          party.partyId,
          ref,
          raising,
          at,
          excludeVoucherId,
        );
        raising.add(ref.toLowerCase());
        // Due date: the party's agreed terms, snapshotted now, unless the entry
        // overrides them. A bill is aged by the terms it was raised under.
        const due = b.dueDate
          ? new Date(b.dueDate)
          : creditDays != null
            ? new Date(date.getTime() + creditDays * 86_400_000)
            : date;
        resolved.push({
          refType: 'NEW',
          side,
          billRef: ref,
          // A bill already names itself; a note beside its number would be a
          // second name for the same thing.
          refNote: null,
          againstId: null,
          amount: b.amount,
          dueDate: due,
        });
        continue;
      }

      if (b.refType === 'AGAINST') {
        if (!b.againstId) {
          throw new BadRequestException(
            `Choose which bill is being settled on ${at}.`,
          );
        }
        const target = byId.get(b.againstId);
        if (
          !target ||
          target.companyId !== companyId ||
          target.refType !== 'NEW' ||
          target.partyKind !== party.partyKind ||
          target.partyId !== party.partyId
        ) {
          throw new BadRequestException(
            `That bill is not one of this party's (${at}).`,
          );
        }
        if (target.status !== 'POSTED') {
          throw new BadRequestException(
            `Bill ${target.billRef} is not in the books yet — post it before settling it (${at}).`,
          );
        }
        // Which way the bill itself stands, so we know whether this allocation
        // is settling it or adding to it.
        const billSide = sideOf(target);
        if (side !== billSide) {
          // Settling. It cannot clear more than the bill still owes.
          const left = await this.outstanding(target.id, billSide, Number(target.amount));
          if (paise(b.amount) > paise(left)) {
            throw new BadRequestException(
              `Only ${left.toFixed(2)} is outstanding on bill ${target.billRef} — ${b.amount.toFixed(2)} would over-settle it (${at}).`,
            );
          }
        }
        // Same side as the bill: this ADDS to it — a supplementary charge, or a
        // note raised against an invoice already in the books. There is no
        // ceiling on what a party can come to owe, so nothing to check.
        resolved.push({
          refType: 'AGAINST',
          side,
          // NOT the target's ref. `billRef` is the bill's NAME, and only the
          // NEW row that raised it holds one — which is exactly what makes
          // [company, party, billRef] unique mean "a bill number is a party's
          // own". A settlement identifies its bill by `againstId`; copying the
          // ref here would make two receipts against one invoice collide.
          billRef: null,
          refNote: null,
          againstId: target.id,
          amount: b.amount,
          dueDate: null,
        });
        continue;
      }

      // ADVANCE / ON_ACCOUNT — attached to no bill by definition, so the only
      // thing that can identify one later is what the person entering it called
      // it. Kept out of `billRef` deliberately: see BillAllocation.refNote.
      resolved.push({
        refType: b.refType as BillRefType,
        side,
        billRef: null,
        refNote: b.refNote?.trim() || null,
        againstId: null,
        amount: b.amount,
        dueDate: null,
      });
    }
    return resolved;
  }

  /**
   * A bill number is a party's own, and may be raised against them once.
   *
   * PER PARTY, not per company: a purchase bill's number is written by the
   * supplier, so two suppliers may both send "INV-001" and refusing the second
   * would be refusing a real document. Within one party it is an identity — a
   * second "INV-001" would leave two bills that no payment could tell apart.
   *
   * The database enforces this too. This check exists so the entry is refused
   * where the fault is, naming the bill and the party, rather than surfacing a
   * constraint violation after everything else has been accepted.
   */
  private async assertBillRefFree(
    companyId: number,
    partyKind: PartyKind,
    partyId: number,
    ref: string,
    raising: Set<string>,
    at: string,
    /** The voucher being rewritten or posted — its OWN bills are not clashes
     *  with itself. Absent on a first save, where nothing of it exists yet. */
    excludeVoucherId: number | undefined,
  ): Promise<void> {
    if (raising.has(ref.toLowerCase())) {
      throw new BadRequestException(
        `This voucher already raises a bill numbered “${ref}” for that party (${at}).`,
      );
    }
    const clash = await this.prisma.billAllocation.findFirst({
      where: {
        companyId,
        partyKind,
        partyId,
        refType: 'NEW',
        billRef: { equals: ref, mode: 'insensitive' },
        ...(excludeVoucherId
          ? { NOT: { line: { voucherId: excludeVoucherId } } }
          : {}),
      },
      select: { id: true, status: true, date: true },
    });
    if (!clash) return;
    throw new BadRequestException(
      clash.status === 'CANCELLED'
        ? `Bill “${ref}” was already raised for that party and later cancelled — that number cannot be used again (${at}).`
        : `Bill “${ref}” already exists for that party, dated ${clash.date.toISOString().slice(0, 10)} (${at}).`,
    );
  }

  /**
   * What is still standing on a bill: what it was raised for, less everything
   * posted against it. Derived rather than stored, so a cancelled settlement
   * puts the bill back where it was without anything having to remember to.
   */
  private async outstanding(
    billId: number,
    /** Which way the bill itself stands. */
    billSide: BalanceSide,
    raised: number,
  ): Promise<number> {
    // Only POSTED settlements move a bill. A draft has not happened yet, so it
    // holds nothing back — and re-checking a draft therefore never counts its
    // own allocation against it. Two drafts may each claim the whole amount;
    // whichever posts second is refused, which is the right moment to find out.
    const against = await this.prisma.billAllocation.findMany({
      where: { againstId: billId, status: 'POSTED' },
      select: { amount: true, side: true, line: { select: { debit: true } } },
    });
    return fromPaise(
      against.reduce(
        // Against the bill's own direction it settles; with it, it adds — a
        // supplementary charge is as real as a payment.
        (left, a) =>
          left +
          (sideOf(a) === billSide ? paise(Number(a.amount)) : -paise(Number(a.amount))),
        paise(raised),
      ),
    );
  }

  /** The party's agreed credit period, for dating a new bill. */
  private async creditDays(
    kind: PartyKind,
    partyId: number,
  ): Promise<number | null> {
    if (kind === 'SUPPLIER') {
      const s = await this.prisma.supplier.findUnique({
        where: { id: partyId },
        select: { creditDays: true },
      });
      return s?.creditDays ?? null;
    }
    if (kind === 'CUSTOMER') {
      const c = await this.prisma.customer.findUnique({
        where: { id: partyId },
        select: { creditDays: true },
      });
      return c?.creditDays ?? null;
    }
    return null;
  }

  /**
   * Is this party one of the company's, and still live? And if so, which main
   * ledger is it kept under? Every party master carries one, so the answer is
   * always an account id — what the caller checks the line's account against.
   */
  private async findParty(
    companyId: number,
    kind: PartyKind,
    partyId: number,
  ): Promise<{ controlAccountId: number } | null> {
    const where = { id: partyId, companyId, isActive: true };
    const select = { controlAccountId: true };
    switch (kind) {
      case 'SUPPLIER':
        return this.prisma.supplier.findFirst({ where, select });
      case 'CUSTOMER':
        return this.prisma.customer.findFirst({ where, select });
      default:
        // EMPLOYEE / COMPANY / OTHER have no master to check against yet — HR
        // builds the employee one. Refuse instead of accepting an id that
        // points at nothing, which would put a name in the books that no
        // screen can ever resolve.
        throw new BadRequestException(
          `Accounts kept by ${kind.toLowerCase()} are not available yet — that master has not been built.`,
        );
    }
  }

  /** The cost centre and object must be this company's, and belong together. */
  private async assertDimensions(
    companyId: number,
    dims: { costCenterId: number | null; costObjectId: number | null },
  ) {
    if (dims.costCenterId) {
      const centre = await this.prisma.costCenter.findUnique({
        where: { id: dims.costCenterId },
        select: { companyId: true, isActive: true },
      });
      if (!centre || centre.companyId !== companyId || !centre.isActive) {
        throw new BadRequestException('That cost centre is not this company’s.');
      }
    }
    if (dims.costObjectId) {
      const object = await this.prisma.costObject.findUnique({
        where: { id: dims.costObjectId },
        select: { companyId: true, costCenterId: true, isActive: true },
      });
      if (!object || object.companyId !== companyId || !object.isActive) {
        throw new BadRequestException('That cost object is not this company’s.');
      }
      if (object.costCenterId !== dims.costCenterId) {
        throw new BadRequestException(
          'That cost object does not sit under the chosen cost centre.',
        );
      }
    }
  }

  /** A voucher cannot be posted unless it balances, and totals more than nil. */
  private assertBalanced(lines: ResolvedLine[]) {
    const debit = lines.reduce((n, l) => n + paise(l.debit), 0);
    const credit = lines.reduce((n, l) => n + paise(l.credit), 0);
    if (!debit && !credit) {
      throw new BadRequestException('A voucher of nil cannot be posted.');
    }
    if (debit !== credit) {
      const diff = fromPaise(Math.abs(debit - credit)).toFixed(2);
      throw new BadRequestException(
        `Debits ${fromPaise(debit).toFixed(2)} and credits ${fromPaise(
          credit,
        ).toFixed(2)} differ by ${diff}. A voucher must balance before it is posted.`,
      );
    }
  }

  private totals(lines: ResolvedLine[]) {
    return {
      debit: fromPaise(lines.reduce((n, l) => n + paise(l.debit), 0)),
      credit: fromPaise(lines.reduce((n, l) => n + paise(l.credit), 0)),
    };
  }

  /**
   * Numbers are derived (MAX + 1), so two people saving at once can land on the
   * same one. The unique index catches it and the next attempt asks for the one
   * after — the same retry the other numbered documents use.
   */
  private async withNumberRetry<T>(
    scope: NumberingScope,
    documentCode: string,
    typeCode: string,
    date: Date,
    write: (voucherNo: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const voucherNo = await this.numbering.nextOrDefault(
        scope,
        documentCode,
        { prefix: VOUCHER_NUMBER_PREFIX[typeCode] ?? 'VCH-', padding: 5 },
        date,
        attempt,
      );
      try {
        return await write(voucherNo);
      } catch (e) {
        const clash =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!clash || attempt === 4) throw e;
      }
    }
    throw new BadRequestException('Could not allocate a voucher number.');
  }
}
