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
import {
  NUMBERING,
  NumberingPort,
  NumberingScope,
} from '../../contracts/numbering.port';
import { STOCK, StockPort } from '../../contracts/stock.port';
import { WORK_ORDER, WorkOrderPort } from '../../contracts/work-order.port';
import { DispatchService } from './dispatch.service';
import {
  ActSalesOrderDto,
  SalesOrderLineInput,
  UpdateSalesOrderDto,
} from './sales-order.dto';

// The sales order is raised by the SELLER, so its workflow is matched at the
// seller's company — the only origin there is.
const CRM_MODULE_CODE = 'CRM';
const ICSO_ROUTE = '/crm/icso';
// The purchase order's rows in the shared stock_reservations table — where this
// order's prices come from, since the price follows the batch that ships.
const PO_DOCUMENT_TYPE = 'PURCHASE_ORDER';
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
    @Inject(STOCK) private readonly stock: StockPort,
    @Inject(WORK_ORDER) private readonly workOrders: WorkOrderPort,
    private readonly dispatch: DispatchService,
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
    /** The SELLER's active branch — the one taking the order, and whose
        numbering series the order draws on. Not the buyer's branch, which
        arrives on the ICPO as orderingBranchId. */
    branchId: number | undefined,
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
    // Only what the supplier actually agreed to supply crosses over: a line they
    // refused isn't sold, and a line's accepted quantity is the commitment. An
    // unreviewed line (acceptedQty null) falls back to what was asked — an order
    // approved without review means "yes, all of it".
    const supplying = po.lines
      .filter((l) => !l.cancelled)
      .map((l) => ({ ...l, supplyQty: l.acceptedQty ?? l.quantity }))
      .filter((l) => l.supplyQty > 0);
    if (!supplying.length) {
      throw new BadRequestException(
        'Every line on that purchase order was cancelled or accepted at zero — there is nothing to sell.',
      );
    }

    const lines = await this.priceFromBatches(po.id, supplying);

    const order = await this.withOrderNoRetry(
      { companyId, branchId },
      (orderNo) =>
        this.prisma.salesOrder.create({
          data: {
            companyId,
            branchId: branchId ?? null,
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
            lines: { create: lines.map((l, i) => ({ sequence: i, ...l })) },
          },
          include: withLines,
        }),
    );
    return this.findOne(userId, order.id, true);
  }

  /**
   * Raise the production Work Order for an APPROVED sales order — what the seller
   * must MAKE to fulfil it. Only the lines with no stock behind them (batchId
   * null) need producing; the rest ship from existing batches. Delegated to the
   * Production module through the WORK_ORDER port (one work order per sales
   * order, enforced there).
   */
  async createWorkOrder(userId: number, companyId: number, id: number) {
    if (!companyId) throw new BadRequestException('No active company.');
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Sales order not found.');
    if (order.companyId !== companyId) {
      throw new ForbiddenException(
        'Only the selling company can raise this order’s work order.',
      );
    }
    if (order.status !== 'APPROVED') {
      throw new BadRequestException(
        'Only an approved sales order can raise a work order.',
      );
    }
    const toProduce = order.lines
      .filter((l) => l.batchId == null && l.quantity > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitId: l.unitId,
      }));
    if (!toProduce.length) {
      throw new BadRequestException(
        'Every line on this order ships from stock — there is nothing to produce.',
      );
    }
    return this.workOrders.createFromSalesOrder({
      userId,
      companyId,
      branchId: null,
      salesOrderId: order.id,
      soNumber: order.orderNo,
      soDeliveryAt: order.deliveryAt,
      lines: toProduce,
    });
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

    // The production work order this order has raised (once approved), so the
    // screen can show "Work order WO-#### created" instead of the convert button.
    const workOrder = await this.workOrders.getForSalesOrder(order.id);
    // The dispatch raised for this order, so the screen can show "Dispatched"
    // instead of the dispatch button.
    const dispatch = await this.dispatch.getForSalesOrder(order.id);

    return {
      ...order,
      total: this.orderTotal(order.lines),
      workOrderId: workOrder?.id ?? null,
      workOrderNo: workOrder?.orderNo ?? null,
      dispatchId: dispatch?.id ?? null,
      dispatchNo: dispatch?.dispatchNo ?? null,
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
   * Turn the supplier's accepted quantities into priced sales lines.
   *
   * The price comes from the BATCH that will ship, never from the product
   * master: stock physically labelled at an old price cannot be sold at a new
   * one, and the master only holds the most recent price, for information. So a
   * product filled from two batches becomes TWO lines at two prices — which is
   * exactly how FEFO reserved it.
   *
   * Whatever the reservation couldn't cover has to be produced. It has no batch,
   * so there is no price to inherit: it takes the master's latest price as a
   * starting point and stays editable, until production gives it a real batch
   * with a real price.
   */
  private async priceFromBatches(
    purchaseOrderId: number,
    supplying: {
      id: number;
      productId: number;
      unitId: number;
      quantity: number;
      supplyQty: number;
    }[],
  ) {
    const held = await this.stock.reservationDetailFor(
      PO_DOCUMENT_TYPE,
      purchaseOrderId,
    );
    const heldByLine = new Map<number, typeof held>();
    for (const h of held) {
      const arr = heldByLine.get(h.lineId) ?? [];
      arr.push(h);
      heldByLine.set(h.lineId, arr);
    }

    // Only needed for the balance — the "latest price", explicitly informational.
    const masterPrice = new Map(
      (
        await this.prisma.product.findMany({
          where: {
            id: { in: [...new Set(supplying.map((l) => l.productId))] },
          },
          select: { id: true, intercompanyPrice: true },
        })
      ).map((p) => [p.id, p.intercompanyPrice]),
    );

    const out: {
      productId: number;
      batchId: number | null;
      batchNo: string | null;
      orderedQty: number;
      quantity: number;
      unitId: number;
      rate: number;
    }[] = [];

    for (const l of supplying) {
      const holds = heldByLine.get(l.id) ?? [];
      let covered = 0;
      for (const h of holds) {
        // Never ship more of a batch than was accepted, even if more is held.
        const take = Math.min(h.quantity, l.supplyQty - covered);
        if (take <= 0) break;
        out.push({
          productId: l.productId,
          batchId: h.batchId,
          batchNo: h.batchNo,
          orderedQty: l.quantity,
          quantity: take,
          unitId: l.unitId,
          rate: h.intercompanyPrice, // the batch's own price — not editable
        });
        covered += take;
      }
      const balance = l.supplyQty - covered;
      if (balance > 0) {
        out.push({
          productId: l.productId,
          batchId: null, // to be produced
          batchNo: null,
          orderedQty: l.quantity,
          quantity: balance,
          rate: masterPrice.get(l.productId) ?? 0,
          unitId: l.unitId,
        });
      }
    }
    return out;
  }

  /**
   * Apply the seller's edits to the converted lines.
   *
   * Quantity always moves. The PRICE moves only on a balance line — one with no
   * batch, waiting to be produced — because a batch's price belongs to the goods
   * and cannot be renegotiated on the way out. Product, unit, batch and the
   * ordered quantity all come from the purchase order and its reservations, and
   * stay put. A line at 0 is DROPPED rather than stored, and an order can't be
   * emptied that way.
   */
  private resolveLines(
    current: {
      id: number;
      productId: number;
      batchId: number | null;
      batchNo: string | null;
      orderedQty: number;
      unitId: number;
      rate: number;
    }[],
    input: SalesOrderLineInput[],
  ) {
    const byId = new Map(current.map((l) => [l.id, l]));
    const kept = input.filter((l) => l.quantity > 0);
    if (!kept.length) {
      throw new BadRequestException(
        'An order needs at least one line with a quantity — delete it instead.',
      );
    }
    return kept.map((l) => {
      const from = byId.get(l.lineId);
      if (!from) {
        throw new BadRequestException(
          'That line is not on this order. Lines come from the purchase order and cannot be added.',
        );
      }
      return {
        productId: from.productId,
        batchId: from.batchId,
        batchNo: from.batchNo,
        orderedQty: from.orderedQty,
        quantity: l.quantity,
        unitId: from.unitId,
        // A batch dictates its own price; only the to-be-produced part is open.
        rate: from.batchId === null ? (l.rate ?? from.rate) : from.rate,
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
      throw new BadRequestException(
        'The ICSO document type is not registered.',
      );
    }
    return { moduleId: mod.id, objectId: obj.id };
  }

  private async docRef(documentId: number): Promise<DocumentRef> {
    const { moduleId, objectId } = await this.docType();
    return { moduleId, objectId, documentId };
  }

  /** Generate the next per-seller order number, retrying on a unique clash. */
  private async withOrderNoRetry<T>(
    scope: NumberingScope,
    fn: (orderNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const orderNo = await this.nextOrderNo(scope, i);
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
  private async nextOrderNo(
    scope: NumberingScope,
    attempt: number,
  ): Promise<string> {
    return this.numbering.nextOrDefault(
      scope,
      ICSO_DOCUMENT_CODE,
      { prefix: 'SO-', padding: 5 },
      undefined,
      attempt,
    );
  }
}
