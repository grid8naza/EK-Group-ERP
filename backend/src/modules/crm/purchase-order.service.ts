import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKFLOW, WorkflowPort } from '../../contracts/workflow.port';
import { CreatePurchaseOrderDto } from './purchase-order.dto';

const CRM_MODULE_CODE = 'CRM';
// The PO is received in the supplier's CRM; a workflow binds to this screen.
const PO_IC_ROUTE = '/crm/purchase-orders-ic';

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW) private readonly workflow: WorkflowPort,
  ) {}

  /**
   * Raise a Purchase Order - IC: the requester (active company/branch) creates it
   * under the chosen SUPPLIER company, then it is submitted to the supplier's
   * approval workflow (routing it to the supplier's CRM staff). If no workflow is
   * configured, it is simply left PLACED for the CRM staff list.
   */
  async create(
    userId: number,
    orderingCompanyId: number,
    orderingBranchId: number | undefined,
    dto: CreatePurchaseOrderDto,
  ) {
    if (!orderingCompanyId) {
      throw new BadRequestException('No active company for the requester.');
    }
    if (dto.supplierCompanyId === orderingCompanyId) {
      throw new BadRequestException(
        'Choose a supplier company other than your own.',
      );
    }

    const order = await this.withOrderNoRetry(dto.supplierCompanyId, (orderNo) =>
      this.prisma.purchaseOrder.create({
        data: {
          companyId: dto.supplierCompanyId,
          orderNo,
          deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : null,
          orderingCompanyId,
          orderingBranchId: orderingBranchId ?? null,
          placedByUserId: userId,
          notes: dto.notes?.trim() || null,
          lines: {
            create: dto.lines.map((l, i) => ({
              sequence: i,
              productId: l.productId,
              quantity: l.quantity,
              unitId: l.unitId,
            })),
          },
        },
        include: { lines: true },
      }),
    );

    // Submit to the approval workflow (routes to the supplier's CRM staff).
    const [mod, obj] = await Promise.all([
      this.prisma.module.findUnique({
        where: { code: CRM_MODULE_CODE },
        select: { id: true },
      }),
      this.prisma.objectMaster.findFirst({
        where: { route: PO_IC_ROUTE },
        select: { id: true },
      }),
    ]);
    if (mod && obj) {
      const totalQty = order.lines.reduce((s, l) => s + l.quantity, 0);
      const res = await this.workflow.start({
        startedByUserId: userId,
        companyId: dto.supplierCompanyId,
        moduleId: mod.id,
        objectId: obj.id,
        documentId: order.id,
        documentRef: order.orderNo,
        amount: totalQty,
      });
      if (res) {
        await this.prisma.purchaseOrder.update({
          where: { id: order.id },
          data: { workflowInstanceId: res.instanceId },
        });
      }
    }
    return this.findOne(order.id);
  }

  /**
   * List Purchase Orders - IC for the active company: `incoming` = orders this
   * company receives as the supplier (CRM staff view); `placed` = orders this
   * company raised as the requester.
   */
  findAll(companyId: number, scope: 'incoming' | 'placed') {
    const where =
      scope === 'placed' ? { orderingCompanyId: companyId } : { companyId };
    return this.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
  }

  async findOne(id: number) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    return order;
  }

  /** Generate the next per-supplier order number, retrying on a unique clash. */
  private async withOrderNoRetry<T>(
    companyId: number,
    fn: (orderNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const n = await this.prisma.purchaseOrder.count({ where: { companyId } });
      const orderNo = `PO-${String(n + 1 + i).padStart(5, '0')}`;
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
}
