import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateStockTransactionDto,
  StockTransactionLineInput,
  UpdateStockTransactionDto,
} from './stock-transaction.dto';

/** The transaction types the Inventory Transactions menu drives. */
export const TXN_TYPES = [
  'PURCHASE',
  'SALE',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'CONSUMPTION',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

/** Per-type config: numbering document code + built-in fallback prefix. */
const TXN_CONFIG: Record<TxnType, { documentCode: string; prefix: string }> = {
  PURCHASE: { documentCode: 'GOODS_RECEIPT_NOTE', prefix: 'GRN' },
  SALE: { documentCode: 'DELIVERY_NOTE', prefix: 'DN' },
  SALES_RETURN: { documentCode: 'SALES_RETURN', prefix: 'SRN' },
  PURCHASE_RETURN: { documentCode: 'PURCHASE_RETURN', prefix: 'PRN' },
  CONSUMPTION: { documentCode: 'GOODS_ISSUE_NOTE', prefix: 'GIN' },
};

/**
 * IN types add stock (create a batch); OUT types remove it. Sales Return is a
 * customer returning goods back into stock (IN); Purchase Return sends goods
 * back to the supplier (OUT).
 */
const isInbound = (type: TxnType): boolean =>
  type === 'PURCHASE' || type === 'SALES_RETURN';

/** Item/product classification denormalized onto each ledger line. */
interface LineClass {
  categoryId: number | null;
  primaryGroupId: number | null;
  parentGroupId: number | null;
  unitId: number;
}

@Injectable()
export class StockTransactionService {
  constructor(
    private prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  // ---- reads ----

  async findOne(id: number) {
    const header = await this.prisma.stockTransaction.findUnique({
      where: { id },
    });
    if (!header) throw new NotFoundException('Stock transaction not found');
    const lines = await this.prisma.stockLedger.findMany({
      where: { transactionType: header.type, documentId: id },
      orderBy: { id: 'asc' },
    });
    return { ...header, lines };
  }

  /** Flat, enriched ledger lines for one transaction type (the listing grid). */
  async lines(
    companyId: number | undefined,
    branchId: number | undefined,
    type: TxnType,
  ) {
    const filtered = await this.prisma.stockLedger.findMany({
      where: {
        transactionType: type as StockTxnType,
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { id: 'desc' },
    });

    const uniq = <T>(xs: (T | null | undefined)[]) =>
      [...new Set(xs.filter((x): x is T => x != null))];
    const itemIds = uniq(filtered.map((r) => r.itemId));
    const productIds = uniq(filtered.map((r) => r.productId));
    const catIds = uniq(filtered.map((r) => r.categoryId));
    const groupIds = uniq([
      ...filtered.map((r) => r.primaryGroupId),
      ...filtered.map((r) => r.parentGroupId),
    ]);
    const unitIds = uniq(filtered.map((r) => r.unitId));
    const storeIds = uniq(filtered.map((r) => r.storeId));
    const docIds = uniq(filtered.map((r) => r.documentId));

    const [its, prs, cats, grps, uns, sts, docs] = await Promise.all([
      itemIds.length
        ? this.prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } })
        : [],
      productIds.length
        ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
        : [],
      catIds.length
        ? this.prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
        : [],
      groupIds.length
        ? this.prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } })
        : [],
      unitIds.length
        ? this.prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, symbol: true, code: true } })
        : [],
      storeIds.length
        ? this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
        : [],
      docIds.length
        ? this.prisma.stockTransaction.findMany({ where: { id: { in: docIds } }, select: { id: true, isLocked: true } })
        : [],
    ]);

    const itemMap = new Map(its.map((x) => [x.id, x.name] as const));
    const prodMap = new Map(prs.map((x) => [x.id, x.name] as const));
    const catMap = new Map(cats.map((x) => [x.id, x.name] as const));
    const grpMap = new Map(grps.map((x) => [x.id, x.name] as const));
    const unitMap = new Map(uns.map((x) => [x.id, x.symbol ?? x.code] as const));
    const storeMap = new Map(sts.map((x) => [x.id, x.name] as const));
    const lockMap = new Map(docs.map((x) => [x.id, x.isLocked] as const));

    const inbound = isInbound(type);
    return filtered.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      docNo: r.documentNo,
      docDate: r.date,
      storeId: r.storeId,
      storeName: storeMap.get(r.storeId) ?? '',
      itemId: r.itemId,
      productId: r.productId,
      name: r.itemId
        ? itemMap.get(r.itemId) ?? ''
        : r.productId
          ? prodMap.get(r.productId) ?? ''
          : '',
      categoryId: r.categoryId,
      categoryName: r.categoryId ? catMap.get(r.categoryId) ?? null : null,
      primaryGroupId: r.primaryGroupId,
      primaryGroupName: r.primaryGroupId ? grpMap.get(r.primaryGroupId) ?? null : null,
      parentGroupId: r.parentGroupId,
      parentGroupName: r.parentGroupId ? grpMap.get(r.parentGroupId) ?? null : null,
      batchNo1: r.batchNo1,
      batchNo2: r.batchNo2,
      expiryDate: r.expiryDate,
      qtyIn: r.qtyIn,
      qtyOut: r.qtyOut,
      qty: inbound ? r.qtyIn : r.qtyOut,
      unitId: r.unitId,
      unitSymbol: unitMap.get(r.unitId) ?? '',
      unitPrice: r.unitPrice,
      isLocked: lockMap.get(r.documentId) ?? false,
    }));
  }

  // ---- writes ----

  async create(
    companyId: number | undefined,
    branchId: number | undefined,
    type: TxnType,
    dto: CreateStockTransactionDto,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before entering a transaction.');
    }
    const companyCode = await this.companyCode(companyId);
    // Company + branch scoped: with an active branch, the store must belong to
    // it — you can only transact against your own branch's stores.
    const store = await this.prisma.store.findFirst({
      where: { id: dto.storeId, companyId, ...(branchId ? { branchId } : {}) },
    });
    if (!store) {
      throw new BadRequestException('Choose a valid store for this branch.');
    }
    const txnBranchId = store.branchId ?? branchId ?? null;

    const resolved = await this.resolveLines(dto.lines);
    const docDate = new Date(dto.docDate);
    const ymd = this.ymd(dto.docDate);
    const docNo = await this.nextDocNo(companyId, type, docDate);

    return this.prisma.$transaction(async (tx) => {
      const base = await tx.stockBatch.count({
        where: { companyId, batchNo1: { startsWith: `${companyCode}-${ymd}-` } },
      });
      const header = await tx.stockTransaction.create({
        data: {
          companyId,
          branchId: txnBranchId,
          type: type as StockTxnType,
          docNo,
          docDate,
          storeId: dto.storeId,
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || null,
          status: 'POSTED',
        },
      });
      await this.writeLines(tx, {
        type,
        header,
        companyId,
        branchId: txnBranchId,
        storeId: dto.storeId,
        docDate,
        docNo,
        reference: dto.reference?.trim() || null,
        companyCode,
        ymd,
        base,
        lines: dto.lines,
        resolved,
      });
      return header;
    });
  }

  async update(
    id: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: UpdateStockTransactionDto,
  ) {
    const existing = await this.prisma.stockTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Stock transaction not found');
    assertUnlocked(existing, 'stock transaction', 'editing');
    const effCompany = existing.companyId;
    const companyCode = await this.companyCode(effCompany);

    const storeId = dto.storeId ?? existing.storeId;
    // The edited document stays in its own branch — the (new) store must belong
    // to it (companies without branches are unconstrained).
    const store = await this.prisma.store.findFirst({
      where: {
        id: storeId,
        companyId: effCompany,
        ...(existing.branchId ? { branchId: existing.branchId } : {}),
      },
    });
    if (!store) {
      throw new BadRequestException('Choose a valid store for this branch.');
    }
    const txnBranchId = store.branchId ?? existing.branchId ?? null;

    const docDate = dto.docDate ? new Date(dto.docDate) : existing.docDate;
    const ymd = this.ymd(docDate.toISOString());
    const resolved = dto.lines ? await this.resolveLines(dto.lines) : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.stockTransaction.update({
        where: { id },
        data: {
          storeId,
          branchId: txnBranchId,
          docDate,
          reference:
            dto.reference !== undefined ? dto.reference?.trim() || null : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        },
      });

      if (dto.lines && resolved) {
        // Replace lines + their batches (batch numbers are regenerated).
        const old = await tx.stockLedger.findMany({
          where: { transactionType: existing.type, documentId: id },
          select: { batchId: true },
        });
        const batchIds = old
          .map((l) => l.batchId)
          .filter((b): b is number => b != null);
        await tx.stockLedger.deleteMany({
          where: { transactionType: existing.type, documentId: id },
        });
        if (batchIds.length) {
          await tx.stockBatch.deleteMany({ where: { id: { in: batchIds } } });
        }
        const base = await tx.stockBatch.count({
          where: {
            companyId: effCompany,
            batchNo1: { startsWith: `${companyCode}-${ymd}-` },
          },
        });
        await this.writeLines(tx, {
          type: existing.type as TxnType,
          header: existing,
          companyId: effCompany,
          branchId: txnBranchId,
          storeId,
          docDate,
          docNo: existing.docNo,
          reference: dto.reference?.trim() ?? existing.reference ?? null,
          companyCode,
          ymd,
          base,
          lines: dto.lines,
          resolved,
        });
      }
      return this.findOne(id);
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.stockTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Stock transaction not found');
    assertUnlocked(existing, 'stock transaction', 'deleting');
    await this.prisma.$transaction(async (tx) => {
      const old = await tx.stockLedger.findMany({
        where: { transactionType: existing.type, documentId: id },
        select: { batchId: true },
      });
      const batchIds = old
        .map((l) => l.batchId)
        .filter((b): b is number => b != null);
      await tx.stockLedger.deleteMany({
        where: { transactionType: existing.type, documentId: id },
      });
      if (batchIds.length) {
        await tx.stockBatch.deleteMany({ where: { id: { in: batchIds } } });
      }
      await tx.stockTransaction.delete({ where: { id } });
    });
    return { success: true };
  }

  async setLock(id: number, locked: boolean) {
    const existing = await this.prisma.stockTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Stock transaction not found');
    return this.prisma.stockTransaction.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  // ---- helpers ----

  /** Create the batch (IN) or validate availability (OUT) + ledger row per line. */
  private async writeLines(
    tx: Prisma.TransactionClient,
    ctx: {
      type: TxnType;
      header: { id: number };
      companyId: number;
      branchId: number | null;
      storeId: number;
      docDate: Date;
      docNo: string;
      reference: string | null;
      companyCode: string;
      ymd: string;
      base: number;
      lines: StockTransactionLineInput[];
      resolved: LineClass[];
    },
  ) {
    const inbound = isInbound(ctx.type);
    let batchSeq = 0;
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const cls = ctx.resolved[i];
      const expiry = line.expiryDate ? new Date(line.expiryDate) : null;

      let batchId: number | null = null;
      let batchNo1: string | null = null;
      if (inbound) {
        batchSeq += 1;
        batchNo1 = `${ctx.companyCode}-${ctx.ymd}-${String(ctx.base + batchSeq).padStart(4, '0')}`;
        const batch = await tx.stockBatch.create({
          data: {
            companyId: ctx.companyId,
            batchNo1,
            batchNo2: line.batchNo2?.trim() || null,
            itemId: line.itemId ?? null,
            productId: line.productId ?? null,
            expiryDate: expiry,
          },
        });
        batchId = batch.id;
      } else {
        // OUT: never issue more than is on hand at this store (the aggregate
        // already reflects earlier lines written in this same transaction).
        const available = await this.availableStock(
          tx,
          ctx.companyId,
          ctx.storeId,
          line.itemId ?? null,
          line.productId ?? null,
        );
        if (line.quantity > available) {
          throw new BadRequestException(
            `Insufficient stock: ${available} available, ${line.quantity} requested.`,
          );
        }
      }

      await tx.stockLedger.create({
        data: {
          date: ctx.docDate,
          companyId: ctx.companyId,
          branchId: ctx.branchId,
          storeId: ctx.storeId,
          transactionType: ctx.type as StockTxnType,
          transactionSubtype: null,
          documentId: ctx.header.id,
          documentNo: ctx.docNo,
          reference: ctx.reference,
          categoryId: cls.categoryId,
          primaryGroupId: cls.primaryGroupId,
          parentGroupId: cls.parentGroupId,
          itemId: line.itemId ?? null,
          productId: line.productId ?? null,
          batchId,
          batchNo1,
          batchNo2: inbound ? line.batchNo2?.trim() || null : null,
          expiryDate: inbound ? expiry : null,
          qtyIn: inbound ? line.quantity : 0,
          qtyOut: inbound ? 0 : line.quantity,
          unitId: cls.unitId,
          unitPrice: line.unitPrice ?? 0,
        },
      });
    }
  }

  /** On-hand quantity for one stockable at a store (SUM qtyIn - qtyOut). */
  private async availableStock(
    tx: Prisma.TransactionClient,
    companyId: number,
    storeId: number,
    itemId: number | null,
    productId: number | null,
  ): Promise<number> {
    const agg = await tx.stockLedger.aggregate({
      where: {
        companyId,
        storeId,
        ...(itemId ? { itemId } : {}),
        ...(productId ? { productId } : {}),
      },
      _sum: { qtyIn: true, qtyOut: true },
    });
    return (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
  }

  private async resolveLines(
    lines: StockTransactionLineInput[],
  ): Promise<LineClass[]> {
    const out: LineClass[] = [];
    for (const l of lines) {
      if (!l.itemId && !l.productId) {
        throw new BadRequestException('Each line must have an item or a product.');
      }
      if (l.itemId && l.productId) {
        throw new BadRequestException('A line cannot be both an item and a product.');
      }
      out.push(await this.classify(l.itemId ?? null, l.productId ?? null));
    }
    return out;
  }

  private async classify(
    itemId: number | null,
    productId: number | null,
  ): Promise<LineClass> {
    if (itemId) {
      const it = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: { categoryId: true, groupId: true, unitId: true },
      });
      if (!it) throw new BadRequestException('Item not found.');
      return {
        categoryId: it.categoryId,
        parentGroupId: it.groupId,
        primaryGroupId: await this.primaryGroup(it.groupId),
        unitId: it.unitId,
      };
    }
    const pr = await this.prisma.product.findUnique({
      where: { id: productId ?? -1 },
      select: { categoryId: true, groupId: true, unitId: true },
    });
    if (!pr) throw new BadRequestException('Product not found.');
    return {
      categoryId: pr.categoryId,
      parentGroupId: pr.groupId,
      primaryGroupId: await this.primaryGroup(pr.groupId),
      unitId: pr.unitId,
    };
  }

  /** Walk up the group chain to the level-1 (primary) group. */
  private async primaryGroup(groupId: number | null): Promise<number | null> {
    if (!groupId) return null;
    let g = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, parentGroupId: true },
    });
    while (g?.parentGroupId) {
      const p = await this.prisma.group.findUnique({
        where: { id: g.parentGroupId },
        select: { id: true, parentGroupId: true },
      });
      if (!p) break;
      g = p;
    }
    return g?.id ?? null;
  }

  private async companyCode(companyId: number): Promise<string> {
    const c = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true },
    });
    return (c?.code || 'CO').toUpperCase();
  }

  /** YYMMDD from an ISO date string (tz-safe: reads the date part directly). */
  private ymd(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${y.slice(2)}${m}${d}`;
  }

  /** Next document number: the company's numbering rule, else a built-in prefix. */
  private async nextDocNo(
    companyId: number,
    type: TxnType,
    date: Date,
  ): Promise<string> {
    const cfg = TXN_CONFIG[type];
    const configured = await this.numbering.next(companyId, cfg.documentCode, date);
    if (configured) return configured;
    const n = await this.prisma.stockTransaction.count({
      where: { companyId, type: type as StockTxnType },
    });
    return `${cfg.prefix}-${String(n + 1).padStart(5, '0')}`;
  }
}
