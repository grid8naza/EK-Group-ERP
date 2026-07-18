import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  CreateWorkOrderInput,
  WorkOrderRef,
} from '../../contracts/work-order.port';

// Document code the central numbering rules key on (see Document Master seed).
const WORK_ORDER_DOCUMENT_CODE = 'WORK_ORDER';

const withLines = {
  lines: { orderBy: { sequence: 'asc' as const } },
};

/**
 * Work Orders — the production side of a sales order. A Work Order lists what
 * must be MADE to fulfil an approved ICSO (only the lines with no stock behind
 * them). It is a production-execution document, not an approval one: it is born
 * PENDING and later clubbed into a Production Plan.
 */
@Injectable()
export class WorkOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  /** Port: create the Work Order for a sales order (one per order). */
  async createFromSalesOrder(input: CreateWorkOrderInput): Promise<WorkOrderRef> {
    if (!input.companyId) throw new BadRequestException('No active company.');
    if (!input.lines.length) {
      throw new BadRequestException('There is nothing to produce for this order.');
    }
    const existing = await this.prisma.workOrder.findUnique({
      where: { salesOrderId: input.salesOrderId },
      select: { id: true, orderNo: true },
    });
    if (existing) {
      throw new ConflictException(
        `A work order already exists for this sales order (${existing.orderNo}).`,
      );
    }
    const created = await this.withOrderNoRetry(input.companyId, (orderNo) =>
      this.prisma.workOrder.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          orderNo,
          salesOrderId: input.salesOrderId,
          soNumber: input.soNumber,
          soDeliveryAt: input.soDeliveryAt ?? null,
          status: 'PENDING',
          createdByUserId: input.userId,
          lines: {
            create: input.lines.map((l, i) => ({
              sequence: i,
              productId: l.productId,
              quantity: l.quantity,
              unitId: l.unitId,
            })),
          },
        },
        select: { id: true, orderNo: true },
      }),
    );
    return created;
  }

  /** Port: the work order raised from a sales order, or null. */
  async getForSalesOrder(salesOrderId: number): Promise<WorkOrderRef | null> {
    return this.prisma.workOrder.findUnique({
      where: { salesOrderId },
      select: { id: true, orderNo: true },
    });
  }

  // --- REST (Production → Work Orders screen) ---

  findAll(companyId: number | undefined, search?: string, status?: string) {
    if (!companyId) return [];
    return this.prisma.workOrder.findMany({
      where: {
        companyId,
        ...(status ? { status: status as WorkOrderStatus } : {}),
        ...(search
          ? {
              OR: [
                { orderNo: { contains: search, mode: 'insensitive' } },
                { soNumber: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  async findOne(id: number) {
    const wo = await this.prisma.workOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!wo) throw new NotFoundException('Work order not found.');
    return wo;
  }

  /** Advance the work order's status (planning / production tracking). */
  async setStatus(id: number, status: WorkOrderStatus) {
    const wo = await this.findOne(id);
    assertUnlocked(wo, 'work order', 'editing');
    if (wo.status === 'CANCELLED' || wo.status === 'COMPLETED') {
      throw new BadRequestException(
        `A ${wo.status.toLowerCase()} work order cannot change status.`,
      );
    }
    return this.prisma.workOrder.update({ where: { id }, data: { status } });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.workOrder.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const wo = await this.findOne(id);
    assertUnlocked(wo, 'work order', 'deleting');
    if (wo.status === 'COMPLETED') {
      throw new BadRequestException(
        'A completed work order cannot be deleted.',
      );
    }
    // Deleting frees the sales order to raise a work order again (salesOrderId
    // is unique), so a mistaken conversion isn't a dead end.
    await this.prisma.workOrder.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private async withOrderNoRetry<T>(
    companyId: number,
    fn: (orderNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const orderNo = await this.nextOrderNo(companyId, i);
      try {
        return await fn(orderNo);
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

  /** Next WO number: the company's configured rule, else built-in WO-#####. */
  private async nextOrderNo(companyId: number, attempt: number): Promise<string> {
    const configured = await this.numbering.next(
      companyId,
      WORK_ORDER_DOCUMENT_CODE,
    );
    if (configured) return configured;
    const n = await this.prisma.workOrder.count({ where: { companyId } });
    return `WO-${String(n + 1 + attempt).padStart(5, '0')}`;
  }
}
