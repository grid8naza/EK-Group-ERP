import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  ProducedBatch,
  STOCK_POSTING,
  StockPostingPort,
} from '../../contracts/stock-posting.port';
import { RecordProductionDto } from './production-receipt.dto';

const PRODUCTION_RECEIPT_DOCUMENT_CODE = 'PRODUCTION_RECEIPT';

const withLines = {
  lines: { orderBy: { productName: 'asc' as const } },
};

/**
 * Production Receipts — finished goods banked into stock. Recording production
 * against a Work Order posts each of its products as a new stock batch
 * (PRODUCTION stock-in, through the STOCK_POSTING port) and completes the order.
 */
@Injectable()
export class ProductionReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    @Inject(STOCK_POSTING) private readonly posting: StockPostingPort,
  ) {}

  findAll(companyId: number | undefined, search?: string) {
    if (!companyId) return [];
    return this.prisma.productionReceipt.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { receiptNo: { contains: search, mode: 'insensitive' } },
                { workOrderNo: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  async findOne(id: number) {
    const receipt = await this.prisma.productionReceipt.findUnique({
      where: { id },
      include: withLines,
    });
    if (!receipt) throw new NotFoundException('Production receipt not found.');
    return receipt;
  }

  /**
   * Record production for a Work Order: bank each product as a new stock batch
   * and mark the order completed. One receipt per work order.
   */
  async recordFromWorkOrder(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    workOrderId: number,
    dto: RecordProductionDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { lines: true },
    });
    if (!wo) throw new NotFoundException('Work order not found.');
    if (wo.companyId !== companyId) {
      throw new BadRequestException('That work order belongs to another company.');
    }
    if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
      throw new BadRequestException(
        `A ${wo.status.toLowerCase()} work order cannot be produced.`,
      );
    }
    const existing = await this.prisma.productionReceipt.findUnique({
      where: { workOrderId },
      select: { id: true, receiptNo: true },
    });
    if (existing) {
      throw new ConflictException(
        `This work order has already been produced (${existing.receiptNo}).`,
      );
    }
    const produce = wo.lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({ productId: l.productId, quantity: l.quantity }));
    if (!produce.length) {
      throw new BadRequestException('This work order has nothing to produce.');
    }

    const store = await this.resolveStore(companyId, branchId, dto.storeId);
    if (!store) {
      throw new BadRequestException(
        'Set a default store (or choose one) before recording production.',
      );
    }

    // Create the receipt header first — it is the document the stock movements
    // belong to — then post stock, fill the lines with their batches, and
    // complete the work order.
    const header = await this.withReceiptNoRetry(companyId, (receiptNo) =>
      this.prisma.productionReceipt.create({
        data: {
          companyId,
          branchId: branchId ?? null,
          receiptNo,
          workOrderId: wo.id,
          workOrderNo: wo.orderNo,
          storeId: store.id,
          storeName: store.name,
          notes: dto.notes?.trim() || null,
          createdByUserId: userId,
        },
      }),
    );

    let batches: ProducedBatch[];
    try {
      batches = await this.posting.postProductionReceipt({
        companyId,
        branchId: branchId ?? null,
        storeId: store.id,
        documentId: header.id,
        documentNo: header.receiptNo,
        date: new Date().toISOString(),
        lines: produce,
      });
    } catch (e) {
      // Don't leave an empty receipt behind if the stock posting fails.
      await this.prisma.productionReceipt.delete({ where: { id: header.id } });
      throw e;
    }
    const batchOf = new Map(batches.map((b) => [b.productId, b]));

    const nameById = new Map(
      (
        await this.prisma.product.findMany({
          where: { id: { in: produce.map((p) => p.productId) } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.id, p.name]),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.productionReceiptLine.createMany({
        data: wo.lines
          .filter((l) => l.quantity > 0)
          .map((l) => {
            const b = batchOf.get(l.productId);
            return {
              receiptId: header.id,
              productId: l.productId,
              productName: nameById.get(l.productId) ?? `#${l.productId}`,
              quantity: l.quantity,
              unitId: l.unitId,
              batchId: b?.batchId ?? null,
              batchNo: b?.batchNo ?? null,
              expiryDate: b?.expiryDate ? new Date(b.expiryDate) : null,
            };
          }),
      });
      await tx.workOrder.update({
        where: { id: wo.id },
        data: { status: 'COMPLETED' },
      });
    });

    return this.findOne(header.id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.productionReceipt.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  // --- helpers ---

  private async resolveStore(
    companyId: number,
    branchId: number | undefined,
    storeId: number | undefined,
  ): Promise<{ id: number; name: string } | null> {
    if (storeId) {
      const s = await this.prisma.store.findFirst({
        where: { id: storeId, companyId },
        select: { id: true, name: true },
      });
      if (!s) throw new BadRequestException('That store is not in this company.');
      return s;
    }
    return (
      (await this.prisma.store.findFirst({
        where: {
          companyId,
          isDefault: true,
          ...(branchId ? { branchId } : {}),
        },
        select: { id: true, name: true },
      })) ??
      (await this.prisma.store.findFirst({
        where: { companyId, isDefault: true },
        select: { id: true, name: true },
      })) ??
      null
    );
  }

  private async withReceiptNoRetry<T>(
    companyId: number,
    fn: (receiptNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const receiptNo = await this.nextReceiptNo(companyId, i);
      try {
        return await fn(receiptNo);
      } catch (e) {
        if (
          i < attempts &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  private async nextReceiptNo(
    companyId: number,
    attempt: number,
  ): Promise<string> {
    const configured = await this.numbering.next(
      companyId,
      PRODUCTION_RECEIPT_DOCUMENT_CODE,
    );
    if (configured) return configured;
    const n = await this.prisma.productionReceipt.count({ where: { companyId } });
    return `PR-${String(n + 1 + attempt).padStart(4, '0')}`;
  }
}
