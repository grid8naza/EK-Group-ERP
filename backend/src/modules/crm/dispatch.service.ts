import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { withNumberRetry } from '../../common/with-number-retry';
import {
  NUMBERING,
  NumberingPort,
  NumberingScope,
} from '../../contracts/numbering.port';
import {
  STOCK_POSTING,
  StockPostingPort,
} from '../../contracts/stock-posting.port';
import { CreateDispatchDto } from './dispatch.dto';

// Document codes the central numbering rules key on.
const DISPATCH_CODE = 'DISPATCH';
const INVOICE_CODE = 'SALES_INVOICE';
const DELIVERY_NOTE_CODE = 'DELIVERY_NOTE';
const EWAY_BILL_CODE = 'EWAY_BILL';

const withLines = {
  lines: { orderBy: { productName: 'asc' as const } },
};

/**
 * Dispatch — the seller ships an approved sales order (ICSO). Stock goes OUT of
 * the source store and the documents that travel with the goods (tax invoice,
 * delivery note, e-way bill) are generated. Receiving on the buyer side (GRN +
 * stock-in) and credit notes come next; for an external customer it is
 * stock-out only.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    @Inject(STOCK_POSTING) private readonly posting: StockPostingPort,
  ) {}

  findAll(companyId: number | undefined, search?: string) {
    if (!companyId) return [];
    return this.prisma.dispatch.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { dispatchNo: { contains: search, mode: 'insensitive' } },
                { soNumber: { contains: search, mode: 'insensitive' } },
                { invoiceNo: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  async findOne(id: number) {
    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id },
      include: withLines,
    });
    if (!dispatch) throw new NotFoundException('Dispatch not found.');
    return dispatch;
  }

  /** The dispatch raised for a sales order, or null. */
  getForSalesOrder(salesOrderId: number) {
    return this.prisma.dispatch.findUnique({
      where: { salesOrderId },
      select: { id: true, dispatchNo: true },
    });
  }

  /**
   * Dispatch an approved sales order: stock-out the ordered goods from the
   * source store and generate the invoice / delivery note / e-way bill.
   */
  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    salesOrderId: number,
    dto: CreateDispatchDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Sales order not found.');
    if (order.companyId !== companyId) {
      throw new ForbiddenException(
        'Only the selling company can dispatch this order.',
      );
    }
    if (order.status !== 'APPROVED') {
      throw new BadRequestException(
        'Only an approved sales order can be dispatched.',
      );
    }
    const existing = await this.prisma.dispatch.findUnique({
      where: { salesOrderId },
      select: { dispatchNo: true },
    });
    if (existing) {
      throw new ConflictException(
        `This order has already been dispatched (${existing.dispatchNo}).`,
      );
    }
    const shipLines = order.lines.filter((l) => l.quantity > 0);
    if (!shipLines.length) {
      throw new BadRequestException('This order has nothing to dispatch.');
    }

    const store = await this.resolveStore(companyId, branchId, dto.storeId);
    if (!store) {
      throw new BadRequestException(
        'Set a default store (or choose one) before dispatching.',
      );
    }

    // Product names for the documents.
    const nameById = new Map(
      (
        await this.prisma.product.findMany({
          where: { id: { in: shipLines.map((l) => l.productId) } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.id, p.name]),
    );

    const subtotal = shipLines.reduce((s, l) => s + l.quantity * l.rate, 0);

    // Header first — the document the stock movements belong to. Its numbers are
    // derived, so a dispatch raised at the same instant can take the ones we
    // computed; retry with the next rather than failing the shipment.
    const header = await withNumberRetry(
      (attempt) => this.docNumbers({ companyId, branchId }, attempt),
      ([dispatchNo, invoiceNo, deliveryNoteNo, ewayBillNo]) =>
        this.prisma.dispatch.create({
          data: {
            companyId,
            branchId: branchId ?? null,
            dispatchNo,
            salesOrderId: order.id,
            soNumber: order.orderNo,
            buyerCompanyId: order.buyerCompanyId,
            buyerBranchId: order.buyerBranchId,
            storeId: store.id,
            storeName: store.name,
            invoiceNo,
            deliveryNoteNo,
            ewayBillNo,
            driverName: dto.driverName?.trim() || null,
            vehicleNo: dto.vehicleNo?.trim() || null,
            subtotal,
            status: 'DISPATCHED',
            notes: dto.notes?.trim() || null,
            createdByUserId: userId,
            lines: {
              create: shipLines.map((l) => ({
                productId: l.productId,
                productName: nameById.get(l.productId) ?? `#${l.productId}`,
                quantity: l.quantity,
                unitId: l.unitId,
                rate: l.rate,
                amount: l.quantity * l.rate,
                batchId: l.batchId,
                batchNo: l.batchNo,
              })),
            },
          },
        }),
    );

    // Ship the goods out of the source store. Roll back the header on failure.
    try {
      await this.posting.postDispatch({
        companyId,
        branchId: branchId ?? null,
        storeId: store.id,
        documentId: header.id,
        documentNo: header.dispatchNo,
        date: new Date().toISOString(),
        lines: shipLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
        })),
      });
    } catch (e) {
      await this.prisma.dispatch.delete({ where: { id: header.id } });
      throw e;
    }

    return this.findOne(header.id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.dispatch.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  // --- helpers ---

  /** dispatch / invoice / delivery-note / e-way-bill numbers for the branch. */
  private docNumbers(
    scope: NumberingScope,
    attempt = 0,
  ): Promise<[string, string, string, string]> {
    const next = (code: string, prefix: string) =>
      this.numbering.nextOrDefault(
        scope,
        code,
        { prefix, padding: 4 },
        undefined,
        attempt,
      );
    return Promise.all([
      next(DISPATCH_CODE, 'DSP-'),
      next(INVOICE_CODE, 'INV-'),
      next(DELIVERY_NOTE_CODE, 'DN-'),
      next(EWAY_BILL_CODE, 'EWB-'),
    ]);
  }

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
      if (!s)
        throw new BadRequestException('That store is not in this company.');
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
}
