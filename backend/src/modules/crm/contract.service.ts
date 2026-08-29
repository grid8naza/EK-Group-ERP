import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import { calendarParts, dateMarker } from '../../common/zoned-time';
import {
  ContractDueLine,
  ContractLineDto,
  CreateContractDto,
  UpdateContractDto,
} from './contract.dto';

const CONTRACT_DOCUMENT_CODE = 'CONTRACT';

/** The supply-day flags, in weekday order — index 0 = Sunday, as JS counts. */
const SUPPLY_DAY_FIELDS = [
  'supSun',
  'supMon',
  'supTue',
  'supWed',
  'supThu',
  'supFri',
  'supSat',
] as const;

const withLines = {
  lines: { orderBy: { sequence: 'asc' } },
} satisfies Prisma.ContractInclude;

/**
 * Supply contracts with institutional customers — a school, a hospital
 * canteen, a caterer.
 *
 * A contract is not an order and is deliberately not modelled as one. Nobody
 * rings up on Tuesday to ask for Wednesday's bread: the agreement already says
 * what goes out, on which days, at what price, until when. So this service owns
 * the AGREEMENT, and each day's obligation is DERIVED from it (see `dueOn`)
 * rather than stored as a schedule somebody has to keep filling in — a schedule
 * that would be wrong the moment a term was extended and nobody regenerated it.
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: CreateContractDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const { start, end } = this.assertPeriod(dto.startDate, dto.endDate);
    await this.assertCustomer(companyId, dto.customerId);
    const lines = await this.assertLines(companyId, dto.lines);

    // Numbered per company, MAX + 1 off the contracts themselves. `attempt`
    // offsets it: the number is derived, so two people saving at once are handed
    // the same one and the loser must ask for the next rather than retry.
    for (let attempt = 0; ; attempt++) {
      const contractNo = await this.numbering.nextOrDefault(
        { companyId, branchId: dto.branchId ?? branchId ?? null },
        CONTRACT_DOCUMENT_CODE,
        { prefix: 'CON-', padding: 5 },
        start,
        attempt,
      );
      try {
        const row = await this.prisma.contract.create({
          data: {
            companyId,
            branchId: dto.branchId !== undefined ? dto.branchId : (branchId ?? null),
            contractNo,
            customerId: dto.customerId,
            title: dto.title?.trim() || null,
            startDate: start,
            endDate: end,
            status: dto.status ?? 'DRAFT',
            notes: dto.notes?.trim() || null,
            createdByUserId: userId,
            lines: { create: lines },
          },
          include: withLines,
        });
        return this.view(row);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          attempt < 25
        ) {
          continue; // somebody took that number between our read and our write
        }
        throw e;
      }
    }
  }

  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateContractDto,
  ) {
    const existing = await this.ensure(companyId, id);
    assertUnlocked(existing, 'contract');

    const start = dto.startDate ? dateMarker(dto.startDate) : existing.startDate;
    const end = dto.endDate ? dateMarker(dto.endDate) : existing.endDate;
    if (end < start) {
      throw new BadRequestException(
        'The contract cannot end before it starts.',
      );
    }
    if (dto.customerId != null) {
      await this.assertCustomer(existing.companyId, dto.customerId);
    }
    const lines = dto.lines
      ? await this.assertLines(existing.companyId, dto.lines)
      : undefined;

    const row = await this.prisma.$transaction(async (tx) => {
      if (lines) {
        // Replaced wholesale: a contract's lines are one agreed schedule, and a
        // half-applied edit is a schedule nobody agreed to.
        await tx.contractLine.deleteMany({ where: { contractId: id } });
        await tx.contractLine.createMany({
          data: lines.map((l) => ({ contractId: id, ...l })),
        });
      }
      return tx.contract.update({
        where: { id },
        data: {
          ...(dto.customerId != null ? { customerId: dto.customerId } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.title !== undefined
            ? { title: dto.title?.trim() || null }
            : {}),
          ...(dto.startDate ? { startDate: start } : {}),
          ...(dto.endDate ? { endDate: end } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes?.trim() || null }
            : {}),
        },
        include: withLines,
      });
    });
    return this.view(row);
  }

  async findAll(companyId: number | undefined, branchId?: number) {
    if (!companyId) return [];
    const rows = await this.prisma.contract.findMany({
      where: { companyId, ...(branchId ? { branchId } : {}) },
      include: withLines,
      orderBy: [{ startDate: 'desc' }, { contractNo: 'desc' }],
    });
    return this.viewMany(rows);
  }

  async findOne(companyId: number | undefined, id: number) {
    const row = await this.ensure(companyId, id);
    return this.view(row);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.ensure(companyId, id);
    assertUnlocked(existing, 'contract', 'deleting');
    // Only a draft is deleted. Once a contract has been in force, what it
    // obliged is part of the record of what was supplied and why.
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only a draft contract can be deleted. Cancel it instead — a contract that has been in force is part of the record.',
      );
    }
    await this.prisma.contract.delete({ where: { id } });
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.ensure(companyId, id);
    const row = await this.prisma.contract.update({
      where: { id },
      data: { isLocked: locked },
      include: withLines,
    });
    return this.view(row);
  }

  // -------------------------------------------------------------------------
  // What the contracts oblige, on a day
  // -------------------------------------------------------------------------

  /**
   * What this branch must hand over on `date`, per product, summed across every
   * contract that covers the day.
   *
   * Three tests, and each rules out a different thing:
   *  - the contract is ACTIVE — a draft agreed with nobody, or one suspended by
   *    agreement, obliges nothing;
   *  - `date` falls inside its period, INCLUSIVE at both ends — which is what
   *    makes an expired contract stop obliging without anybody closing it;
   *  - the LINE is supplied on that weekday — a school taking bread on Monday,
   *    Wednesday and Friday owes nothing on a Tuesday.
   *
   * `date` is a local calendar date (YYYY-MM-DD). Which weekday it falls on is a
   * fact about the calendar rather than about anybody's clock, so it is read
   * without a timezone (see calendarParts).
   */
  async dueOn(
    companyId: number,
    branchId: number | null,
    date: string,
  ): Promise<ContractDueLine[]> {
    if (!companyId) return [];
    const on = dateMarker(date);
    const weekday = calendarParts(date).weekday;
    const dayField = SUPPLY_DAY_FIELDS[weekday];

    const contracts = await this.prisma.contract.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        startDate: { lte: on },
        endDate: { gte: on },
        // A branch's contracts, plus any served centrally (no branch named).
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      select: {
        id: true,
        contractNo: true,
        customerId: true,
        lines: {
          where: { [dayField]: true, quantity: { gt: 0 } },
          select: {
            productId: true,
            quantity: true,
            unitId: true,
            rate: true,
          },
        },
      },
    });
    if (!contracts.length) return [];

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: [...new Set(contracts.map((c) => c.customerId))] } },
      select: { id: true, name: true },
    });
    const customerName = new Map(customers.map((c) => [c.id, c.name]));

    const byProduct = new Map<number, ContractDueLine>();
    for (const contract of contracts) {
      for (const line of contract.lines) {
        let row = byProduct.get(line.productId);
        if (!row) {
          row = {
            productId: line.productId,
            quantity: 0,
            unitId: line.unitId,
            sources: [],
          };
          byProduct.set(line.productId, row);
        }
        row.quantity += line.quantity;
        row.sources.push({
          contractId: contract.id,
          contractNo: contract.contractNo,
          customerName: customerName.get(contract.customerId) ?? '—',
          quantity: line.quantity,
          rate: line.rate,
        });
      }
    }
    return [...byProduct.values()];
  }

  /**
   * The price a CUSTOMER is owed for each product on `date`, under whatever
   * contract covers them.
   *
   * Deliberately NOT filtered by supply day, unlike `dueOn`. The two answer
   * different questions: the days say what goes out on a standing schedule, the
   * PRICE is agreed for the term. A school that takes bread on Mondays and rings
   * up on a Tuesday for an extra fifty loaves is still a school with a contract,
   * and charging it the counter price because Tuesday is not one of its days
   * would be reading the schedule as if it were the agreement.
   *
   * A product on two live contracts for the same customer takes the LOWEST
   * price. Both were agreed, so both stand; the customer is entitled to the
   * better of them, and the alternative — picking by contract id — would make
   * the charge depend on which was typed in first.
   */
  async priceFor(
    companyId: number,
    customerId: number,
    date: string,
  ): Promise<Map<number, { rate: number; contractId: number; contractNo: string }>> {
    const out = new Map<
      number,
      { rate: number; contractId: number; contractNo: string }
    >();
    if (!companyId || !customerId) return out;
    const on = dateMarker(date);

    const contracts = await this.prisma.contract.findMany({
      where: {
        companyId,
        customerId,
        status: 'ACTIVE',
        startDate: { lte: on },
        endDate: { gte: on },
      },
      select: {
        id: true,
        contractNo: true,
        lines: {
          where: { rate: { gt: 0 } },
          select: { productId: true, rate: true },
        },
      },
    });

    for (const contract of contracts) {
      for (const line of contract.lines) {
        const held = out.get(line.productId);
        if (!held || line.rate < held.rate) {
          out.set(line.productId, {
            rate: line.rate,
            contractId: contract.id,
            contractNo: contract.contractNo,
          });
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async ensure(companyId: number | undefined, id: number) {
    if (!companyId) throw new BadRequestException('No active company.');
    const row = await this.prisma.contract.findFirst({
      where: { id, companyId },
      include: withLines,
    });
    if (!row) throw new NotFoundException('Contract not found.');
    return row;
  }

  private assertPeriod(startDate: string, endDate: string) {
    const start = dateMarker(startDate);
    const end = dateMarker(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Give the contract a start and end date.');
    }
    if (end < start) {
      throw new BadRequestException('The contract cannot end before it starts.');
    }
    return { start, end };
  }

  private async assertCustomer(companyId: number, customerId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, isActive: true, name: true },
    });
    if (!customer) {
      throw new BadRequestException(
        'That customer does not belong to this company.',
      );
    }
    if (!customer.isActive) {
      throw new BadRequestException(`${customer.name} is no longer active.`);
    }
  }

  /**
   * The lines, checked as a set: each product sold by this company, named once,
   * and supplied on at least one day.
   *
   * The last one is the rule worth stating — a line ticked for no day is
   * supplied on none, which reads as an oversight rather than an intention. It
   * is allowed only when the quantity is 0, which is how a product is parked
   * without losing the price agreed for it.
   */
  private async assertLines(companyId: number, lines: ContractLineDto[]) {
    if (!lines.length) {
      throw new BadRequestException('Add at least one product.');
    }
    const productIds = lines.map((l) => l.productId);
    const duplicate = productIds.find(
      (id, i) => productIds.indexOf(id) !== i,
    );
    if (duplicate != null) {
      throw new BadRequestException(
        'A product appears twice. Put its days on one line.',
      );
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        isActive: true,
        canSell: true,
        companies: { some: { companyId, canSell: true } },
      },
      select: { id: true, name: true },
    });
    const known = new Set(products.map((p) => p.id));
    const missing = productIds.find((id) => !known.has(id));
    if (missing != null) {
      throw new BadRequestException(
        'A product on this contract is not one this company sells.',
      );
    }

    return lines.map((l, sequence) => {
      const days = SUPPLY_DAY_FIELDS.map((f) => l[f] ?? false);
      if (l.quantity > 0 && !days.some(Boolean)) {
        throw new BadRequestException(
          'Tick at least one supply day, or set the quantity to 0 to park the line.',
        );
      }
      return {
        sequence,
        productId: l.productId,
        quantity: l.quantity,
        unitId: l.unitId,
        rate: l.rate ?? 0,
        supSun: l.supSun ?? false,
        supMon: l.supMon ?? false,
        supTue: l.supTue ?? false,
        supWed: l.supWed ?? false,
        supThu: l.supThu ?? false,
        supFri: l.supFri ?? false,
        supSat: l.supSat ?? false,
      };
    });
  }

  /** Rows with the names a screen needs, resolved in one pass for the list. */
  private async viewMany(
    rows: (Prisma.ContractGetPayload<{ include: typeof withLines }>)[],
  ) {
    if (!rows.length) return [];
    const [customers, products, units] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.product.findMany({
        where: {
          id: {
            in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.productId)))],
          },
        },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.unit.findMany({ select: { id: true, symbol: true, code: true } }),
    ]);
    const customer = new Map(customers.map((c) => [c.id, c]));
    const product = new Map(products.map((p) => [p.id, p]));
    const unit = new Map(units.map((u) => [u.id, u.symbol ?? u.code]));

    return rows.map((r) => ({
      ...this.shape(r),
      customerCode: customer.get(r.customerId)?.code ?? null,
      customerName: customer.get(r.customerId)?.name ?? null,
      lines: r.lines.map((l) => ({
        ...l,
        productCode: product.get(l.productId)?.code ?? null,
        productName: product.get(l.productId)?.name ?? null,
        unitSymbol: unit.get(l.unitId) ?? '',
      })),
    }));
  }

  private async view(
    row: Prisma.ContractGetPayload<{ include: typeof withLines }>,
  ) {
    const [one] = await this.viewMany([row]);
    return one;
  }

  private shape(
    row: Prisma.ContractGetPayload<{ include: typeof withLines }>,
  ) {
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      contractNo: row.contractNo,
      customerId: row.customerId,
      title: row.title,
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate.toISOString().slice(0, 10),
      status: row.status as ContractStatus,
      notes: row.notes,
      isLocked: row.isLocked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
