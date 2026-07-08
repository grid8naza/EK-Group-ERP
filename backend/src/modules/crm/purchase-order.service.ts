import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  DocumentRef,
  WORKFLOW,
  WorkflowPort,
  WorkflowStatus,
} from '../../contracts/workflow.port';
import {
  ActPurchaseOrderDto,
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './purchase-order.dto';

const CRM_MODULE_CODE = 'CRM';
// The PO is received in the supplier's CRM; a workflow binds to this screen.
const PO_IC_ROUTE = '/crm/purchase-orders-ic';

// Workflow instance status → purchase-order status.
const STATUS_MAP: Record<WorkflowStatus, PurchaseOrderStatus> = {
  IN_PROGRESS: 'PLACED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

const withLines = {
  lines: { orderBy: { sequence: 'asc' as const } },
};

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW) private readonly workflow: WorkflowPort,
  ) {}

  /**
   * Create a Purchase Order - IC as a DRAFT owned by the chosen SUPPLIER company.
   * The draft is not yet in any workflow — the requester later submits it (which
   * routes it to the supplier's approval chain).
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
          status: 'DRAFT',
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
        include: withLines,
      }),
    );
    return this.findOne(userId, order.id, true);
  }

  /** Edit a draft (creator) or an in-workflow order whose step allows editing. */
  async update(userId: number, id: number, dto: UpdatePurchaseOrderDto) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'purchase order', 'editing');
    if (!(await this.canEdit(userId, order))) {
      throw new ForbiddenException('You cannot edit this order right now.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          deliveryAt:
            dto.deliveryAt !== undefined
              ? dto.deliveryAt
                ? new Date(dto.deliveryAt)
                : null
              : undefined,
          notes: dto.notes !== undefined ? dto.notes.trim() || null : undefined,
        },
      });
      if (dto.lines !== undefined) {
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: dto.lines.map((l, i) => ({
            orderId: id,
            sequence: i,
            productId: l.productId,
            quantity: l.quantity,
            unitId: l.unitId,
          })),
        });
      }
    });
    return this.findOne(userId, id, true);
  }

  /** Delete a draft (creator only). Submitted orders live in the workflow. */
  async remove(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'purchase order', 'deleting');
    if (order.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only draft orders can be deleted; submitted orders are handled through the workflow.',
      );
    }
    if (!isSuperAdmin && order.placedByUserId !== userId) {
      throw new ForbiddenException('Only the creator can delete this draft.');
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Submit a draft into the supplier's approval workflow. Acts as the creator's
   * first level (create + forward), so it lands at the next approver. Falls back
   * to a plain PLACED status when no workflow is configured for the supplier.
   */
  async submit(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    if (order.status !== 'DRAFT') {
      throw new BadRequestException('This order has already been submitted.');
    }
    if (!isSuperAdmin && order.placedByUserId !== userId) {
      throw new ForbiddenException('Only the creator can submit this order.');
    }

    const { moduleId, objectId } = await this.docType();
    const totalQty = order.lines.reduce((s, l) => s + l.quantity, 0);
    const res = await this.workflow.submitAsCreator({
      startedByUserId: userId,
      companyId: order.companyId, // supplier owns / routes the workflow
      branchId: null, // supplier receives company-wide
      moduleId,
      objectId,
      documentId: order.id,
      documentRef: order.orderNo,
      amount: totalQty,
    });

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: res ? STATUS_MAP[res.status] : 'PLACED',
        workflowInstanceId: res?.instanceId ?? order.workflowInstanceId,
      },
    });
    return this.findOne(userId, id, isSuperAdmin);
  }

  /** Act on the order's workflow task (forward / approve / reject / cancel). */
  async act(userId: number, id: number, dto: ActPurchaseOrderDto) {
    const order = await this.ensureOrder(id);
    const ref = await this.docRef(order.id);
    const res = await this.workflow.actOnDocument(
      userId,
      ref,
      dto.action,
      dto.comment,
    );
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: STATUS_MAP[res.status] },
    });
    return this.findOne(userId, id, true);
  }

  /**
   * List orders for the active company.
   *  - `placed`: orders this company raised as the requester (the creator sees
   *    their own, incl. drafts; super admins see the company's).
   *  - `incoming`: submitted orders this company receives as the supplier, scoped
   *    to those the workflow has reached the viewer (they hold a task). Super
   *    admins see all submitted orders.
   */
  async findAll(
    userId: number,
    companyId: number,
    scope: 'incoming' | 'placed',
    isSuperAdmin: boolean,
  ) {
    let where: Prisma.PurchaseOrderWhereInput;
    if (scope === 'placed') {
      where = {
        orderingCompanyId: companyId,
        ...(isSuperAdmin ? {} : { placedByUserId: userId }),
      };
    } else {
      where = { companyId, status: { not: 'DRAFT' } };
      if (!isSuperAdmin) {
        const { moduleId, objectId } = await this.docType();
        const ids = await this.workflow.visibleDocumentIds(
          userId,
          moduleId,
          objectId,
        );
        where = { ...where, id: { in: ids.length ? ids : [-1] } };
      }
    }
    return this.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  /** One order plus the viewer's workflow state and available actions. */
  async findOne(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Purchase order not found.');

    const ref = await this.docRef(order.id);
    const workflow = await this.workflow.docState(userId, ref);

    const isCreator = order.placedByUserId === userId;
    const isDraft = order.status === 'DRAFT';
    const canEditDraft = isDraft && (isCreator || isSuperAdmin);
    const canActEdit = !!workflow.myTask?.canEdit;

    // Label the creator's forward button from the configured first step.
    let submitButtonText: string | null = null;
    if (canEditDraft) {
      const first = await this.workflow.firstStep(
        order.companyId,
        null,
        ref.moduleId,
        ref.objectId,
      );
      submitButtonText = first?.buttonText ?? 'Submit';
    }

    return {
      ...order,
      workflow,
      viewer: {
        isCreator,
        canEdit: canEditDraft || canActEdit,
        canDelete: canEditDraft,
        canSubmit: canEditDraft,
        submitButtonText,
      },
    };
  }

  // --- helpers ---

  private async ensureOrder(id: number) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    return order;
  }

  /** Whether the viewer may edit this order now (draft creator, or step canEdit). */
  private async canEdit(
    userId: number,
    order: { id: number; status: PurchaseOrderStatus; placedByUserId: number },
  ): Promise<boolean> {
    if (order.status === 'DRAFT') return order.placedByUserId === userId;
    const ref = await this.docRef(order.id);
    const state = await this.workflow.docState(userId, ref);
    return !!state.myTask?.canEdit;
  }

  /** The CRM module id + PO-IC object id — the workflow document type. */
  private async docType(): Promise<{ moduleId: number; objectId: number }> {
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
    if (!mod || !obj) {
      throw new BadRequestException(
        'CRM purchase-order document type is not registered.',
      );
    }
    return { moduleId: mod.id, objectId: obj.id };
  }

  private async docRef(documentId: number): Promise<DocumentRef> {
    const { moduleId, objectId } = await this.docType();
    return { moduleId, objectId, documentId };
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
