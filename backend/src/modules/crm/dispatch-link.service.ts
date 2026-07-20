import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IncomingDispatch,
  IncomingDispatchLine,
} from '../../contracts/dispatch.port';

/**
 * The buyer's view of a Dispatch — what is coming in, and closing it once the
 * goods are received. CRM owns the dispatch row; the receiving side reaches this
 * through the DISPATCH port.
 *
 * Kept apart from DispatchService on purpose: this one talks to nothing but its
 * own table, so the module that banks the stock can depend on it without closing
 * a cycle back through STOCK_POSTING. See contracts/dispatch.port.ts.
 */
@Injectable()
export class DispatchLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dispatches shipped to this buyer that nobody has received yet. */
  async incomingFor(
    buyerCompanyId: number,
    buyerBranchId: number | null,
  ): Promise<IncomingDispatch[]> {
    const rows = await this.prisma.dispatch.findMany({
      where: {
        buyerCompanyId,
        status: 'DISPATCHED',
        // A branchless company sees everything addressed to it; with an active
        // branch, only what was shipped to that branch (or to no branch).
        ...(buyerBranchId
          ? { OR: [{ buyerBranchId }, { buyerBranchId: null }] }
          : {}),
      },
      orderBy: { dispatchDate: 'desc' },
      include: { lines: { orderBy: { productName: 'asc' } } },
    });
    return rows.map((r) => this.toIncoming(r));
  }

  async findIncoming(dispatchId: number, buyerCompanyId: number) {
    const row = await this.prisma.dispatch.findFirst({
      where: { id: dispatchId, buyerCompanyId },
      include: { lines: { orderBy: { productName: 'asc' } } },
    });
    if (!row) return null;
    return { ...this.toIncoming(row), received: row.status === 'RECEIVED' };
  }

  async markReceived(dispatchId: number): Promise<void> {
    await this.prisma.dispatch.update({
      where: { id: dispatchId },
      data: { status: 'RECEIVED' },
    });
  }

  async markDispatched(dispatchId: number): Promise<void> {
    await this.prisma.dispatch.update({
      where: { id: dispatchId },
      data: { status: 'DISPATCHED' },
    });
  }

  // --- helpers ---

  private toIncoming(row: {
    id: number;
    dispatchNo: string;
    dispatchDate: Date;
    companyId: number;
    soNumber: string | null;
    invoiceNo: string | null;
    deliveryNoteNo: string | null;
    ewayBillNo: string | null;
    driverName: string | null;
    vehicleNo: string | null;
    lines: {
      productId: number;
      productName: string;
      quantity: number;
      unitId: number;
      rate: number;
      batchNo: string | null;
      batchId: number | null;
    }[];
  }): IncomingDispatch {
    const lines: IncomingDispatchLine[] = row.lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitId: l.unitId,
      rate: l.rate,
      batchNo: l.batchNo,
      batchId: l.batchId,
    }));
    return {
      id: row.id,
      dispatchNo: row.dispatchNo,
      dispatchDate: row.dispatchDate.toISOString(),
      sellerCompanyId: row.companyId,
      soNumber: row.soNumber,
      invoiceNo: row.invoiceNo,
      deliveryNoteNo: row.deliveryNoteNo,
      ewayBillNo: row.ewayBillNo,
      driverName: row.driverName,
      vehicleNo: row.vehicleNo,
      lines,
    };
  }
}
