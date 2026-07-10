import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateOpeningStockDto,
  OpeningStockLineInput,
  UpdateOpeningStockDto,
} from './opening-stock.dto';

/** Item/product classification denormalized onto each ledger line. */
interface LineClass {
  categoryId: number | null;
  primaryGroupId: number | null;
  parentGroupId: number | null;
  unitId: number;
}

@Injectable()
export class OpeningStockService {
  constructor(
    private prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  // ---- reads ----

  async findAll(companyId: number | undefined) {
    const headers = await this.prisma.openingStock.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { id: 'desc' },
    });
    const ids = headers.map((h) => h.id);
    const agg = await this.prisma.stockLedger.groupBy({
      by: ['documentId'],
      where: {
        transactionType: 'OPENING_STOCK',
        documentId: { in: ids.length ? ids : [-1] },
      },
      _count: { _all: true },
      _sum: { qtyIn: true },
    });
    const byDoc = new Map(
      agg.map((a) => [
        a.documentId,
        { count: a._count._all, qty: a._sum.qtyIn ?? 0 },
      ]),
    );
    return headers.map((h) => ({
      ...h,
      lineCount: byDoc.get(h.id)?.count ?? 0,
      totalQty: byDoc.get(h.id)?.qty ?? 0,
    }));
  }

  async findOne(id: number) {
    const header = await this.prisma.openingStock.findUnique({ where: { id } });
    if (!header) throw new NotFoundException('Opening stock document not found');
    const lines = await this.prisma.stockLedger.findMany({
      where: { transactionType: 'OPENING_STOCK', documentId: id },
      orderBy: { id: 'asc' },
    });
    return { ...header, lines };
  }

  /**
   * Flat, enriched opening-stock LINES for a stockable type, for the line-grid
   * listing. type: ITEM_RAW | ITEM_PACKING | PRODUCT_PACKED | PRODUCT_UNPACKED.
   * The two ITEM variants split items by their category's `forPacking` flag
   * (packing-material categories vs everything else = raw material).
   */
  async lines(
    companyId: number | undefined,
    branchId: number | undefined,
    type: 'ITEM_RAW' | 'ITEM_PACKING' | 'PRODUCT_PACKED' | 'PRODUCT_UNPACKED',
  ) {
    const rows = await this.prisma.stockLedger.findMany({
      where: {
        transactionType: 'OPENING_STOCK',
        ...(companyId ? { companyId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { id: 'desc' },
    });

    let filtered = rows;
    if (type === 'ITEM_RAW' || type === 'ITEM_PACKING') {
      const iids = [
        ...new Set(rows.filter((r) => r.itemId != null).map((r) => r.itemId!)),
      ];
      const its = iids.length
        ? await this.prisma.item.findMany({
            where: { id: { in: iids } },
            select: { id: true, category: { select: { forPacking: true } } },
          })
        : [];
      const wantPacking = type === 'ITEM_PACKING';
      const ok = new Set(
        its
          .filter((i) => (i.category?.forPacking ?? false) === wantPacking)
          .map((i) => i.id),
      );
      filtered = rows.filter((r) => r.itemId != null && ok.has(r.itemId));
    } else {
      const pids = [
        ...new Set(rows.filter((r) => r.productId != null).map((r) => r.productId!)),
      ];
      const prods = pids.length
        ? await this.prisma.product.findMany({
            where: { id: { in: pids } },
            select: { id: true, packed: true, unpacked: true },
          })
        : [];
      const wantPacked = type === 'PRODUCT_PACKED';
      const ok = new Set(
        prods.filter((p) => (wantPacked ? p.packed : p.unpacked)).map((p) => p.id),
      );
      filtered = rows.filter((r) => r.productId != null && ok.has(r.productId));
    }

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
        ? this.prisma.openingStock.findMany({ where: { id: { in: docIds } }, select: { id: true, isLocked: true } })
        : [],
    ]);

    const itemMap = new Map(its.map((x) => [x.id, x.name] as const));
    const prodMap = new Map(prs.map((x) => [x.id, x.name] as const));
    const catMap = new Map(cats.map((x) => [x.id, x.name] as const));
    const grpMap = new Map(grps.map((x) => [x.id, x.name] as const));
    const unitMap = new Map(uns.map((x) => [x.id, x.symbol ?? x.code] as const));
    const storeMap = new Map(sts.map((x) => [x.id, x.name] as const));
    const lockMap = new Map(docs.map((x) => [x.id, x.isLocked] as const));

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
    dto: CreateOpeningStockDto,
  ) {
    if (!companyId) {
      throw new BadRequestException('Select a company before entering opening stock.');
    }
    const companyCode = await this.companyCode(companyId);
    const store = await this.prisma.store.findFirst({
      where: { id: dto.storeId, companyId },
    });
    if (!store) throw new BadRequestException('Choose a valid store.');

    const resolved = await this.resolveLines(dto.lines);
    const docDate = new Date(dto.docDate);
    const ymd = this.ymd(dto.docDate);
    const docNo = await this.nextDocNo(companyId, docDate);

    return this.prisma.$transaction(async (tx) => {
      const base = await tx.stockBatch.count({
        where: { companyId, batchNo1: { startsWith: `${companyCode}-${ymd}-` } },
      });
      const header = await tx.openingStock.create({
        data: {
          companyId,
          docNo,
          docDate,
          storeId: dto.storeId,
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || null,
          status: 'POSTED',
        },
      });
      await this.writeLines(tx, {
        header,
        companyId,
        branchId: store.branchId ?? branchId ?? null,
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
    dto: UpdateOpeningStockDto,
  ) {
    const existing = await this.prisma.openingStock.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Opening stock document not found');
    assertUnlocked(existing, 'opening stock', 'editing');
    const effCompany = existing.companyId;
    const companyCode = await this.companyCode(effCompany);

    const storeId = dto.storeId ?? existing.storeId;
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, companyId: effCompany },
    });
    if (!store) throw new BadRequestException('Choose a valid store.');

    const docDate = dto.docDate ? new Date(dto.docDate) : existing.docDate;
    const ymd = this.ymd(docDate.toISOString());
    const resolved = dto.lines ? await this.resolveLines(dto.lines) : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.openingStock.update({
        where: { id },
        data: {
          storeId,
          docDate,
          reference:
            dto.reference !== undefined ? dto.reference?.trim() || null : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        },
      });

      if (dto.lines && resolved) {
        // Replace lines + their batches (batch numbers are regenerated).
        const old = await tx.stockLedger.findMany({
          where: { transactionType: 'OPENING_STOCK', documentId: id },
          select: { batchId: true },
        });
        const batchIds = old
          .map((l) => l.batchId)
          .filter((b): b is number => b != null);
        await tx.stockLedger.deleteMany({
          where: { transactionType: 'OPENING_STOCK', documentId: id },
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
          header: existing,
          companyId: effCompany,
          branchId: store.branchId ?? branchId ?? null,
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
    const existing = await this.prisma.openingStock.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Opening stock document not found');
    assertUnlocked(existing, 'opening stock', 'deleting');
    await this.prisma.$transaction(async (tx) => {
      const old = await tx.stockLedger.findMany({
        where: { transactionType: 'OPENING_STOCK', documentId: id },
        select: { batchId: true },
      });
      const batchIds = old
        .map((l) => l.batchId)
        .filter((b): b is number => b != null);
      await tx.stockLedger.deleteMany({
        where: { transactionType: 'OPENING_STOCK', documentId: id },
      });
      if (batchIds.length) {
        await tx.stockBatch.deleteMany({ where: { id: { in: batchIds } } });
      }
      await tx.openingStock.delete({ where: { id } });
    });
    return { success: true };
  }

  async setLock(id: number, locked: boolean) {
    const existing = await this.prisma.openingStock.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Opening stock document not found');
    return this.prisma.openingStock.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  // ---- helpers ----

  /** Create the batch + ledger row for each line (shared by create/update). */
  private async writeLines(
    tx: Prisma.TransactionClient,
    ctx: {
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
      lines: OpeningStockLineInput[];
      resolved: LineClass[];
    },
  ) {
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const cls = ctx.resolved[i];
      const batchNo1 = `${ctx.companyCode}-${ctx.ymd}-${String(ctx.base + i + 1).padStart(4, '0')}`;
      const expiry = line.expiryDate ? new Date(line.expiryDate) : null;
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
      await tx.stockLedger.create({
        data: {
          date: ctx.docDate,
          companyId: ctx.companyId,
          branchId: ctx.branchId,
          storeId: ctx.storeId,
          transactionType: 'OPENING_STOCK',
          transactionSubtype: null,
          documentId: ctx.header.id,
          documentNo: ctx.docNo,
          reference: ctx.reference,
          categoryId: cls.categoryId,
          primaryGroupId: cls.primaryGroupId,
          parentGroupId: cls.parentGroupId,
          itemId: line.itemId ?? null,
          productId: line.productId ?? null,
          batchId: batch.id,
          batchNo1,
          batchNo2: line.batchNo2?.trim() || null,
          expiryDate: expiry,
          qtyIn: line.quantity,
          qtyOut: 0,
          unitId: cls.unitId,
          unitPrice: line.unitPrice ?? 0,
        },
      });
    }
  }

  private async resolveLines(
    lines: OpeningStockLineInput[],
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

  private async nextDocNo(companyId: number, date: Date): Promise<string> {
    // Use the company's configured numbering rule when present; otherwise fall
    // back to the built-in OS-##### scheme.
    const configured = await this.numbering.next(companyId, 'OPENING_STOCK', date);
    if (configured) return configured;
    const n = await this.prisma.openingStock.count({ where: { companyId } });
    return `OS-${String(n + 1).padStart(5, '0')}`;
  }
}
