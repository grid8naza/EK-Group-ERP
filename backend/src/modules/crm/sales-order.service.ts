import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  DocumentRef,
  WORKFLOW,
  WorkflowFirstStep,
  WorkflowPort,
  WorkflowStatus,
} from '../../contracts/workflow.port';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  ActSalesOrderDto,
  SalesOrderLineInput,
  UpdateSalesOrderDto,
} from './sales-order.dto';

// The sales order is raised by the SELLER, so its workflow is matched at the
// seller's company — the only origin there is.
const CRM_MODULE_CODE = 'CRM';
const ICSO_ROUTE = '/crm/icso';
// Document code the central numbering rules key on (see Document Master seed).
const ICSO_DOCUMENT_CODE = 'SALES_ORDER_IC';

// Workflow instance status → sales-order status.
const STATUS_MAP: Record<WorkflowStatus, SalesOrderStatus> = {
  IN_PROGRESS: 'PLACED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

const withLines = {
  lines: { orderBy: { sequence: 'asc' as const } },
};

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW) private readonly workflow: WorkflowPort,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  /**
   * Convert an APPROVED ICPO into a sales order — the seller's own record of
   * what it will supply.
   *
   * Deliberate rather than automatic: the whole point is the quantity check, and
   * an order created behind everyone's back defeats it. Lines start at the
   * quantities the buyer asked for; CRM staff trim them (0 drops a line) before
   * submitting.
   *
   * Only the SUPPLIER company converts — it is the seller. The ICPO's own
   * `companyId` is that supplier, which is what makes this check a one-liner.
   */
  async convertFromPurchaseOrder(
    userId: number,
    companyId: number,
    purchaseOrderId: number,
  ) {
    if (!companyId) {
      throw new BadRequestException('No active company.');
    }
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');

    // PurchaseOrder.companyId is the SUPPLIER — i.e. us, the seller.
    if (po.companyId !== companyId) {
      throw new ForbiddenException(
        'Only the supplier company can convert this order.',
      );
    }
    if (po.status !== 'APPROVED') {
      throw new BadRequestException(
        'Only an approved purchase order can be converted.',
      );
    }
    const existing = await this.prisma.salesOrder.findUnique({
      where: { purchaseOrderId },
      select: { id: true, orderNo: true },
    });
    if (existing) {
      throw new ConflictException(
        `This purchase order was already converted (${existing.orderNo}).`,
      );
    }
    if (!po.lines.length) {
      throw new BadRequestException('That purchase order has no lines.');
    }

    const order = await this.withOrderNoRetry(companyId, (orderNo) =>
      this.prisma.salesOrder.create({
        data: {
          companyId,
          buyerCompanyId: po.orderingCompanyId,
          buyerBranchId: po.orderingBranchId,
          purchaseOrderId: po.id,
          // Snapshot the origin PO. The sales order is our record of what was
          // asked for, and must keep saying so even if the ICPO is later edited.
          poNumber: po.orderNo,
          poDate: po.orderDate,
          poDeliveryAt: po.deliveryAt,
          poNotes: po.notes,
          orderNo,
          // Start from the buyer's requested date; the seller can commit to another.
          deliveryAt: po.deliveryAt,
          createdByUserId: userId,
          status: 'DRAFT',
          lines: {
            create: po.lines.map((l, i) => ({
              sequence: i,
              productId: l.productId,
              orderedQty: l.quantity, // what was asked — never edited
              quantity: l.quantity, // what we'll supply — the editable one
              unitId: l.unitId,
              rate: l.rate, // the rate the buyer's approver signed off
            })),
          },
        },
        include: withLines,
      }),
    );
    return this.findOne(userId, order.id, true);
  }

  /** Whether the current user may act on the sales-order form (workflow-governed). */
  async createAccess(userId: number, isSuperAdmin: boolean) {
    const { moduleId, objectId } = await this.docType();
    const gate = await this.workflow.creatorGate(userId, moduleId, objectId);
    return {
      workflowGoverned: gate.governed,
      canCreate: isSuperAdmin || gate.allowed,
    };
  }

  /** Edit a draft (creator) or an in-workflow order whose step allows editing. */
  async update(userId: number, id: number, dto: UpdateSalesOrderDto) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'sales order', 'editing');
    if (!(await this.canEdit(userId, order))) {
      throw new ForbiddenException('You cannot edit this order right now.');
    }
    const lines = dto.lines
      ? this.resolveLines(order.lines, dto.lines)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.salesOrder.update({
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
      if (lines) {
        await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
        await tx.salesOrderLine.createMany({
          data: lines.map((l, i) => ({ orderId: id, sequence: i, ...l })),
        });
      }
    });
    return this.findOne(userId, id, true);
  }

  /** Delete a draft (creator only). Submitted orders live in the workflow. */
  async remove(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'sales order', 'deleting');
    if (order.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only draft orders can be deleted; submitted orders are handled through the workflow.',
      );
    }
    if (!isSuperAdmin && order.createdByUserId !== userId) {
      throw new ForbiddenException('Only the creator can delete this draft.');
    }
    // Deleting frees the ICPO to be converted again — purchaseOrderId is unique,
    // so a mistaken conversion isn't a dead end.
    await this.prisma.salesOrder.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Submit a draft into the seller's approval workflow. Acts as the creator's
   * first level (create + forward). Falls back to a plain PLACED status when no
   * workflow is configured.
   */
  async submit(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    if (order.status !== 'DRAFT') {
      throw new BadRequestException('This order has already been submitted.');
    }
    if (!isSuperAdmin && order.createdByUserId !== userId) {
      throw new ForbiddenException('Only the creator can submit this order.');
    }

    const { moduleId, objectId } = await this.docType();
    const res = await this.workflow.submitAsCreator({
      startedByUserId: userId,
      // Matched at the seller's company — the only origin a sales order has.
      companyId: order.companyId,
      branchId: null,
      moduleId,
      objectId,
      documentId: order.id,
      documentRef: order.orderNo,
      // Field-limit steps test the order's VALUE, as on the ICPO and LPO.
      amount: this.orderTotal(order.lines),
    });

    await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: res ? STATUS_MAP[res.status] : 'PLACED',
        workflowInstanceId: res?.instanceId ?? order.workflowInstanceId,
        workflowStatus: res?.statusLabel ?? null,
      },
    });
    return this.findOne(userId, id, isSuperAdmin);
  }

  /** Act on the order's workflow task (forward / approve / reject / cancel). */
  async act(userId: number, id: number, dto: ActSalesOrderDto) {
    const order = await this.ensureOrder(id);
    const ref = await this.docRef(order.id);

    // Creator withdrawing their own in-progress order — they hold no task once
    // forwarded, so gate it on the create step's canCancel.
    if (dto.action === 'CANCEL' && order.createdByUserId === userId) {
      const state = await this.workflow.docState(userId, ref);
      if (!state.myTask) {
        const first = await this.workflow.firstStep(
          order.companyId,
          null,
          ref.moduleId,
          ref.objectId,
        );
        if (!first?.canCancel) {
          throw new ForbiddenException('You cannot cancel this order.');
        }
        await this.workflow.cancelForDocument(
          ref.moduleId,
          ref.objectId,
          ref.documentId,
        );
        await this.prisma.salesOrder.update({
          where: { id },
          data: { status: 'CANCELLED', workflowStatus: null },
        });
        return this.findOne(userId, id, true);
      }
    }

    const res = await this.workflow.actOnDocument(
      userId,
      ref,
      dto.action,
      dto.comment,
    );
    await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: STATUS_MAP[res.status],
        workflowStatus: res.statusLabel ?? null,
      },
    });
    return this.findOne(userId, id, true);
  }

  /**
   * List the active company's sales orders — it is the SELLER on every one of
   * them, so there is only one direction. Drafts stay private to their creator;
   * the screen's own privilege governs access.
   */
  async findAll(userId: number, companyId: number, isSuperAdmin: boolean) {
    if (!companyId) return [];
    const where: Prisma.SalesOrderWhereInput = {
      companyId,
      ...(isSuperAdmin
        ? {}
        : {
            OR: [
              { status: { not: SalesOrderStatus.DRAFT } },
              { createdByUserId: userId },
            ],
          }),
    };
    const rows = await this.prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
    return rows.map((r) => ({ ...r, total: this.orderTotal(r.lines) }));
  }

  /** One order plus the viewer's workflow state and available actions. */
  async findOne(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Sales order not found.');

    const ref = await this.docRef(order.id);
    const workflow = await this.workflow.docState(userId, ref);

    const isCreator = order.createdByUserId === userId;
    const isDraft = order.status === 'DRAFT';
    const canEditDraft = isDraft && (isCreator || isSuperAdmin);
    const canActEdit = !!workflow.myTask?.canEdit;
    const inProgress = workflow.status === 'IN_PROGRESS';
    const isCreatorWithdraw = isCreator && inProgress && !workflow.myTask;

    let firstStep: WorkflowFirstStep | null = null;
    if (canEditDraft || isCreatorWithdraw) {
      firstStep = await this.workflow.firstStep(
        order.companyId,
        null,
        ref.moduleId,
        ref.objectId,
      );
    }
    const submitButtonText = canEditDraft
      ? (firstStep?.buttonText ?? 'Submit')
      : null;
    const canCancel = isCreatorWithdraw && !!firstStep?.canCancel;

    return {
      ...order,
      total: this.orderTotal(order.lines),
      workflow,
      viewer: {
        isCreator,
        canEdit: canEditDraft || canActEdit,
        canDelete: canEditDraft,
        canSubmit: canEditDraft,
        canCancel,
        submitButtonText,
      },
    };
  }

  // --- helpers ---

  /** The order's value — what field-limit approval steps are tested against. */
  private orderTotal(lines: { quantity: number; rate: number }[]): number {
    return lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  }

  /**
   * Apply the seller's quantities to the converted lines.
   *
   * Only quantity moves. Product, unit, rate and the ordered quantity all come
   * from the ICPO and stay put — the seller chooses how much to send, not what
   * it costs or what was asked for. A line at 0 is DROPPED rather than stored,
   * and an order can't be emptied that way.
   */
  private resolveLines(
    current: {
      productId: number;
      orderedQty: number;
      unitId: number;
      rate: number;
    }[],
    input: SalesOrderLineInput[],
  ) {
    const byProduct = new Map(current.map((l) => [l.productId, l]));
    const kept = input.filter((l) => l.quantity > 0);
    if (!kept.length) {
      throw new BadRequestException(
        'An order needs at least one line with a quantity — delete it instead.',
      );
    }
    return kept.map((l) => {
      const from = byProduct.get(l.productId);
      if (!from) {
        throw new BadRequestException(
          'That product is not on this order. Lines come from the purchase order and cannot be added.',
        );
      }
      return {
        productId: l.productId,
        orderedQty: from.orderedQty,
        quantity: l.quantity,
        unitId: from.unitId,
        rate: from.rate,
      };
    });
  }

  private async ensureOrder(id: number) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Sales order not found.');
    return order;
  }

  /** Whether the viewer may edit this order now (draft creator, or step canEdit). */
  private async canEdit(
    userId: number,
    order: { id: number; status: SalesOrderStatus; createdByUserId: number },
  ): Promise<boolean> {
    if (order.status === 'DRAFT') return order.createdByUserId === userId;
    const ref = await this.docRef(order.id);
    const state = await this.workflow.docState(userId, ref);
    return !!state.myTask?.canEdit;
  }

  /** The CRM module id + ICSO object id — the workflow document type. */
  private async docType(): Promise<{ moduleId: number; objectId: number }> {
    const [mod, obj] = await Promise.all([
      this.prisma.module.findUnique({
        where: { code: CRM_MODULE_CODE },
        select: { id: true },
      }),
      this.prisma.objectMaster.findFirst({
        where: { route: ICSO_ROUTE },
        select: { id: true },
      }),
    ]);
    if (!mod || !obj) {
      throw new BadRequestException('The ICSO document type is not registered.');
    }
    return { moduleId: mod.id, objectId: obj.id };
  }

  private async docRef(documentId: number): Promise<DocumentRef> {
    const { moduleId, objectId } = await this.docType();
    return { moduleId, objectId, documentId };
  }

  /** Generate the next per-seller order number, retrying on a unique clash. */
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

  /**
   * The next ICSO number for the selling company. Prefers the company's
   * configured Document Numbering rule; falls back to the built-in SO-##### when
   * no rule is set for this document.
   */
  private async nextOrderNo(companyId: number, attempt: number): Promise<string> {
    const configured = await this.numbering.next(companyId, ICSO_DOCUMENT_CODE);
    if (configured) return configured;
    const n = await this.prisma.salesOrder.count({ where: { companyId } });
    return `SO-${String(n + 1 + attempt).padStart(5, '0')}`;
  }
}
