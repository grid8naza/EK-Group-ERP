import { BadRequestException, Injectable } from '@nestjs/common';
import { PartyKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Money is compared in paise: two decimals held as an integer never drift. */
const paise = (n: number) => Math.round(n * 100);
const fromPaise = (n: number) => n / 100;
const DAY = 86_400_000;

/** The buckets an overdue bill falls into. Upper bound in days, inclusive. */
const BUCKETS: { label: string; upto: number | null }[] = [
  { label: 'Not due', upto: 0 },
  { label: '1-30 days', upto: 30 },
  { label: '31-60 days', upto: 60 },
  { label: '61-90 days', upto: 90 },
  { label: 'Over 90 days', upto: null },
];

/**
 * The read side of the party sub-ledger: what a party's account says, and how
 * old the parts of it are.
 *
 * Both reports are derived from the same two tables the entry screens write —
 * `voucher_lines` for the statement, `bill_allocations` for the ageing — and
 * nothing is cached or carried. A statement that disagreed with the ledger it
 * summarises would be worse than no statement at all.
 *
 * Only POSTED rows are read. A draft has not happened, and a cancelled entry
 * must leave no trace in a balance while remaining in the books.
 */
@Injectable()
export class PartyLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every party that has been posted to, for the picker on both reports. */
  async parties(companyId: number | undefined, kind?: PartyKind) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const [suppliers, customers] = await Promise.all([
      !kind || kind === 'SUPPLIER'
        ? this.prisma.supplier.findMany({
            where: { companyId },
            select: { id: true, code: true, name: true, creditDays: true, creditLimit: true },
            orderBy: { name: 'asc' },
          })
        : [],
      !kind || kind === 'CUSTOMER'
        ? this.prisma.customer.findMany({
            where: { companyId },
            select: { id: true, code: true, name: true, creditDays: true, creditLimit: true },
            orderBy: { name: 'asc' },
          })
        : [],
    ]);
    return [
      ...suppliers.map((s) => ({ ...s, partyKind: 'SUPPLIER' as const })),
      ...customers.map((c) => ({ ...c, partyKind: 'CUSTOMER' as const })),
    ];
  }

  /**
   * Statement of account — every entry that moved one party's balance, in the
   * order it happened, with the balance carried down the page.
   *
   * The opening balance is everything before `from`, collapsed to one figure,
   * so a statement for a period still reconciles to the ledger rather than
   * starting from nothing and understating what is owed.
   */
  async statement(
    companyId: number | undefined,
    partyKind: PartyKind,
    partyId: number,
    from?: string,
    to?: string,
  ) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const party = await this.party(companyId, partyKind, partyId);

    const scope = { companyId, partyKind, partyId, status: 'POSTED' as const };
    const opening = from
      ? await this.prisma.voucherLine.aggregate({
          where: { ...scope, date: { lt: new Date(from) } },
          _sum: { debit: true, credit: true },
        })
      : null;
    const openingBalance = opening
      ? paise(Number(opening._sum.debit ?? 0)) -
        paise(Number(opening._sum.credit ?? 0))
      : 0;

    const lines = await this.prisma.voucherLine.findMany({
      where: {
        ...scope,
        date: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(`${to}T23:59:59.999`) : undefined,
        },
      },
      select: {
        id: true,
        date: true,
        debit: true,
        credit: true,
        narration: true,
        account: { select: { code: true, name: true } },
        voucher: {
          select: { voucherNo: true, narration: true, type: { select: { name: true } } },
        },
        billRefs: {
          select: {
            refType: true,
            billRef: true,
            amount: true,
            against: { select: { billRef: true } },
          },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    let running = openingBalance;
    const rows = lines.map((l) => {
      const debit = paise(Number(l.debit));
      const credit = paise(Number(l.credit));
      running += debit - credit;
      return {
        id: l.id,
        date: l.date,
        voucherNo: l.voucher.voucherNo,
        voucherType: l.voucher.type?.name ?? '',
        accountCode: l.account.code,
        accountName: l.account.name,
        narration: l.narration ?? l.voucher.narration ?? null,
        debit: fromPaise(debit),
        credit: fromPaise(credit),
        balance: fromPaise(running),
        /** Which bills this entry touched, so a line can be traced to them. */
        bills: l.billRefs.map((b) => ({
          refType: b.refType,
          // A settlement holds no ref of its own; it names the bill it settles.
          billRef: b.billRef ?? b.against?.billRef ?? null,
          amount: Number(b.amount),
        })),
      };
    });

    return {
      party,
      from: from ?? null,
      to: to ?? null,
      openingBalance: fromPaise(openingBalance),
      closingBalance: fromPaise(running),
      rows,
    };
  }

  /**
   * Bill ageing — every still-standing bill, bucketed by how long it has been
   * overdue as at a date.
   *
   * Aged by DUE date, not bill date: a bill on 60-day terms raised 45 days ago
   * is not late, and a report that called it late would have people chasing
   * customers who are within their agreed terms. The due date was snapshotted
   * when the bill was raised, so renegotiating terms does not silently re-age
   * the history.
   */
  async ageing(
    companyId: number | undefined,
    partyKind: PartyKind,
    asOn?: string,
    partyId?: number,
  ) {
    if (!companyId) throw new BadRequestException('Select a company first.');
    const on = asOn ? new Date(`${asOn}T23:59:59.999`) : new Date();

    const bills = await this.prisma.billAllocation.findMany({
      where: {
        companyId,
        partyKind,
        refType: 'NEW',
        status: 'POSTED',
        date: { lte: on },
        ...(partyId ? { partyId } : {}),
      },
      select: {
        id: true,
        partyId: true,
        billRef: true,
        amount: true,
        date: true,
        dueDate: true,
        // Only settlements up to the as-on date count — the report is a view of
        // that day, not of today.
        payments: {
          where: { status: 'POSTED', date: { lte: on } },
          select: { amount: true },
        },
      },
      orderBy: [{ partyId: 'asc' }, { date: 'asc' }],
    });

    const names = new Map(
      (await this.parties(companyId, partyKind)).map((p) => [p.id, p]),
    );

    const byParty = new Map<
      number,
      {
        partyId: number;
        partyKind: PartyKind;
        code: string;
        name: string;
        creditDays: number | null;
        creditLimit: number | null;
        total: number;
        buckets: number[];
        bills: {
          id: number;
          billRef: string | null;
          date: Date;
          dueDate: Date | null;
          amount: number;
          pending: number;
          overdueDays: number;
          bucket: string;
        }[];
      }
    >();

    for (const b of bills) {
      const settled = b.payments.reduce((s, p) => s + paise(Number(p.amount)), 0);
      const pending = paise(Number(b.amount)) - settled;
      if (pending <= 0) continue; // settled by the as-on date

      const overdueDays = b.dueDate
        ? Math.floor((on.getTime() - b.dueDate.getTime()) / DAY)
        : 0;
      const bi = this.bucketOf(overdueDays);

      const p = names.get(b.partyId);
      let row = byParty.get(b.partyId);
      if (!row) {
        row = {
          partyId: b.partyId,
          partyKind,
          code: p?.code ?? '',
          name: p?.name ?? `#${b.partyId}`,
          creditDays: p?.creditDays ?? null,
          creditLimit: p?.creditLimit == null ? null : Number(p.creditLimit),
          total: 0,
          buckets: BUCKETS.map(() => 0),
          bills: [],
        };
        byParty.set(b.partyId, row);
      }
      row.total = paise(row.total) + pending;
      row.total = fromPaise(row.total);
      row.buckets[bi] = fromPaise(paise(row.buckets[bi]) + pending);
      row.bills.push({
        id: b.id,
        billRef: b.billRef,
        date: b.date,
        dueDate: b.dueDate,
        amount: Number(b.amount),
        pending: fromPaise(pending),
        overdueDays,
        bucket: BUCKETS[bi].label,
      });
    }

    const parties = [...byParty.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return {
      asOn: on,
      partyKind,
      buckets: BUCKETS.map((b) => b.label),
      parties,
      totals: BUCKETS.map((_, i) =>
        fromPaise(parties.reduce((s, p) => s + paise(p.buckets[i]), 0)),
      ),
      grandTotal: fromPaise(parties.reduce((s, p) => s + paise(p.total), 0)),
    };
  }

  /** Which bucket a number of overdue days falls in. */
  private bucketOf(overdueDays: number): number {
    if (overdueDays <= 0) return 0;
    for (let i = 1; i < BUCKETS.length; i++) {
      const upto = BUCKETS[i].upto;
      if (upto === null || overdueDays <= upto) return i;
    }
    return BUCKETS.length - 1;
  }

  /** The party itself — and a check that it is this company's. */
  private async party(companyId: number, kind: PartyKind, id: number) {
    const found =
      kind === 'SUPPLIER'
        ? await this.prisma.supplier.findFirst({ where: { id, companyId } })
        : kind === 'CUSTOMER'
          ? await this.prisma.customer.findFirst({ where: { id, companyId } })
          : null;
    if (!found) {
      throw new BadRequestException('That party is not this company’s.');
    }
    return {
      id: found.id,
      partyKind: kind,
      code: found.code,
      name: found.name,
      creditDays: found.creditDays,
      creditLimit: found.creditLimit == null ? null : Number(found.creditLimit),
    };
  }
}
