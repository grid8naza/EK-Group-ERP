import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillRefType, PartyKind, Prisma, VoucherStatus } from '@prisma/client';
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
  CancelVoucherDto,
  CreateVoucherDto,
  UpdateVoucherDto,
  VoucherLineInput,
  BillAllocationInput,
} from './voucher.dto';
import { VOUCHER_NUMBER_PREFIX } from './voucher-types';

/** Money is compared in paise: two decimals held as an integer never drift. */
const paise = (n: number) => Math.round(n * 100);
const fromPaise = (n: number) => n / 100;

const withLines = {
  type: true,
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
    billRef: string | null;
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
    billRef: b.billRef ?? undefined,
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
  billRef: string | null;
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
        date: true,
        dueDate: true,
        accountId: true,
        payments: {
          where: { status: 'POSTED' },
          select: { amount: true },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    const today = new Date();
    return raised
      .map((b) => {
        const settled = b.payments.reduce((s, p) => s + paise(Number(p.amount)), 0);
        const pending = paise(Number(b.amount)) - settled;
        return {
          id: b.id,
          billRef: b.billRef,
          accountId: b.accountId,
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
                        billRef: b.billRef,
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
    );
    if (dto.post) this.assertBalanced(lines);

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
                        billRef: b.billRef,
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
        line.bills,
        date,
        at,
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
    account: { isControl: boolean; controlParty: PartyKind | null },
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

    const exists = await this.partyExists(companyId, kind, partyId);
    if (!exists) {
      throw new BadRequestException(
        `That ${kind.toLowerCase()} is not this company’s (${at}).`,
      );
    }
    return { partyKind: kind, partyId };
  }

  /**
   * Which of the party's bills this line's amount belongs to.
   *
   * The one rule everything else follows from: the allocations must add up to
   * the line. A line that moves 1,000 of a party's balance has moved it against
   * some combination of that party's bills, and if the parts do not sum to the
   * whole then the account and the sub-ledger have begun to disagree — quietly,
   * and in a way no later report can repair.
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
    inputs: BillAllocationInput[] | undefined,
    date: Date,
    at: string,
  ): Promise<ResolvedBill[]> {
    // No party, no bills — an ordinary account has no stack to allocate against.
    if (!party.partyKind || !party.partyId) return [];

    if (!inputs?.length) {
      throw new BadRequestException(
        `Say which bill ${at} belongs to — this account is kept bill by bill.`,
      );
    }

    const total = inputs.reduce((s, b) => s + paise(b.amount), 0);
    if (total !== paise(amount)) {
      throw new BadRequestException(
        `The bills on ${at} come to ${fromPaise(total).toFixed(2)}, but the line is ${amount.toFixed(2)}.`,
      );
    }

    // Everything an AGAINST row points at, read once.
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

    for (const b of inputs) {
      if (b.refType === 'NEW') {
        const ref = b.billRef?.trim();
        if (!ref) {
          throw new BadRequestException(
            `A new bill on ${at} needs its bill number.`,
          );
        }
        // Due date: the party's agreed terms, snapshotted now, unless the entry
        // overrides them. A bill is aged by the terms it was raised under.
        const due = b.dueDate
          ? new Date(b.dueDate)
          : creditDays != null
            ? new Date(date.getTime() + creditDays * 86_400_000)
            : date;
        resolved.push({
          refType: 'NEW',
          billRef: ref,
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
        const left = await this.outstanding(target.id, Number(target.amount));
        if (paise(b.amount) > paise(left)) {
          throw new BadRequestException(
            `Only ${left.toFixed(2)} is outstanding on bill ${target.billRef} — ${b.amount.toFixed(2)} would over-settle it (${at}).`,
          );
        }
        resolved.push({
          refType: 'AGAINST',
          // NOT the target's ref. `billRef` is the bill's NAME, and only the
          // NEW row that raised it holds one — which is exactly what makes
          // [company, party, billRef] unique mean "a bill number is a party's
          // own". A settlement identifies its bill by `againstId`; copying the
          // ref here would make two receipts against one invoice collide.
          billRef: null,
          againstId: target.id,
          amount: b.amount,
          dueDate: null,
        });
        continue;
      }

      // ADVANCE / ON_ACCOUNT — attached to no bill by definition.
      resolved.push({
        refType: b.refType as BillRefType,
        billRef: null,
        againstId: null,
        amount: b.amount,
        dueDate: null,
      });
    }
    return resolved;
  }

  /**
   * What is still standing on a bill: what it was raised for, less everything
   * posted against it. Derived rather than stored, so a cancelled settlement
   * puts the bill back where it was without anything having to remember to.
   */
  private async outstanding(billId: number, raised: number): Promise<number> {
    // Only POSTED settlements reduce a bill. A draft has not happened yet, so
    // it holds nothing back — and re-checking a draft therefore never counts
    // its own allocation against it. Two drafts may each claim the whole
    // amount; whichever posts second is refused, which is the right moment to
    // find out.
    const settled = await this.prisma.billAllocation.aggregate({
      where: { againstId: billId, status: 'POSTED' },
      _sum: { amount: true },
    });
    return fromPaise(paise(raised) - paise(Number(settled._sum.amount ?? 0)));
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

  /** Is this party one of the company's, and still live? */
  private async partyExists(
    companyId: number,
    kind: PartyKind,
    partyId: number,
  ): Promise<boolean> {
    const where = { id: partyId, companyId, isActive: true };
    switch (kind) {
      case 'SUPPLIER':
        return !!(await this.prisma.supplier.count({ where }));
      case 'CUSTOMER':
        return !!(await this.prisma.customer.count({ where }));
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
