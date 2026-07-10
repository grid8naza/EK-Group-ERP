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
  WorkflowFirstStep,
  WorkflowPort,
  WorkflowStatus,
} from '../../contracts/workflow.port';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  ActPurchaseOrderDto,
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './purchase-order.dto';

const CRM_MODULE_CODE = 'CRM';
// The PO is received in the supplier's CRM; a workflow binds to this screen.
const PO_IC_ROUTE = '/crm/purchase-orders-ic';
// Document code the central numbering rules key on (see Document Master seed).
const PO_IC_DOCUMENT_CODE = 'PURCHASE_ORDER_IC';

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
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
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
    isSuperAdmin = false,
  ) {
    if (!orderingCompanyId) {
      throw new BadRequestException('No active company for the requester.');
    }
    if (dto.supplierCompanyId === orderingCompanyId) {
      throw new BadRequestException(
        'Choose a supplier company other than your own.',
      );
    }

    // When a PO workflow governs this form, it SUPERSEDES the Add privilege:
    // only a user on a Create-action step may raise the order. The workflow is
    // matched at the document's ORIGIN — the requester's company + branch — so a
    // different branch can have its own workflow / creator.
    const { moduleId, objectId } = await this.docType();
    const gate = await this.workflow.creatorGate(
      userId,
      moduleId,
      objectId,
      orderingCompanyId,
      orderingBranchId ?? null,
    );
    if (gate.governed && !gate.allowed && !isSuperAdmin) {
      throw new ForbiddenException(
        'This order is governed by an approval workflow — only its designated creator can raise it.',
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

  /**
   * Whether the current user may raise a new order. When a workflow governs the
   * PO form, only its designated creator(s) may — this supersedes the Add
   * privilege. When no workflow exists, creation falls back to the screen
   * privilege (enforced in the UI), so `canCreate` is true here.
   */
  async createAccess(userId: number, isSuperAdmin: boolean) {
    const { moduleId, objectId } = await this.docType();
    const gate = await this.workflow.creatorGate(userId, moduleId, objectId);
    return {
      workflowGoverned: gate.governed,
      canCreate: isSuperAdmin || gate.allowed,
    };
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
      // Match at the ORIGIN: the requester's company + branch. This lets each
      // branch run its own workflow (e.g. a per-branch creator); the approval
      // steps then route to the supplier via their cross-boundary targets.
      companyId: order.orderingCompanyId,
      branchId: order.orderingBranchId,
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
        workflowStatus: res?.statusLabel ?? null,
      },
    });
    return this.findOne(userId, id, isSuperAdmin);
  }

  /** Act on the order's workflow task (forward / approve / reject / cancel). */
  async act(userId: number, id: number, dto: ActPurchaseOrderDto) {
    const order = await this.ensureOrder(id);
    const ref = await this.docRef(order.id);

    // Creator withdrawing their own in-progress order. Having forwarded it, the
    // creator no longer holds a task, so this can't go through the task-based
    // path — gate it on the create step's `canCancel` and cancel the instance.
    if (dto.action === 'CANCEL' && order.placedByUserId === userId) {
      const state = await this.workflow.docState(userId, ref);
      if (!state.myTask) {
        const first = await this.workflow.firstStep(
          order.orderingCompanyId,
          order.orderingBranchId,
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
        await this.prisma.purchaseOrder.update({
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
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: STATUS_MAP[res.status],
        // A positive step stamps its status label; reject/cancel clear it so the
        // listing falls back to the plain Rejected / Cancelled status.
        workflowStatus: res.statusLabel ?? null,
      },
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
    scope: 'incoming' | 'placed' | 'involved',
    isSuperAdmin: boolean,
  ) {
    let where: Prisma.PurchaseOrderWhereInput;
    if (scope === 'placed') {
      where = {
        orderingCompanyId: companyId,
        ...(isSuperAdmin ? {} : { placedByUserId: userId }),
      };
    } else if (scope === 'involved') {
      // The unified Purchase Order screen: every order the user is part of —
      // ones they raised (incl. drafts) OR that the workflow has reached them.
      // Super admins see all.
      if (isSuperAdmin) {
        where = {};
      } else {
        const { moduleId, objectId } = await this.docType();
        const ids = await this.workflow.visibleDocumentIds(
          userId,
          moduleId,
          objectId,
        );
        where = {
          OR: [
            { placedByUserId: userId },
            { id: { in: ids.length ? ids : [-1] } },
          ],
        };
      }
    } else {
      // incoming (supplier side) — reserved for the future sales-order view.
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
    const inProgress = workflow.status === 'IN_PROGRESS';
    // Creator withdraw applies only once they've forwarded (no pending task of
    // their own) — Cancel is an origin (step 1) action, never a downstream one.
    const isCreatorWithdraw = isCreator && inProgress && !workflow.myTask;

    // The create step both labels the creator's forward button (while a draft)
    // and says whether the creator may withdraw the order once it's in flight.
    let firstStep: WorkflowFirstStep | null = null;
    if (canEditDraft || isCreatorWithdraw) {
      firstStep = await this.workflow.firstStep(
        order.orderingCompanyId,
        order.orderingBranchId,
        ref.moduleId,
        ref.objectId,
      );
    }
    const submitButtonText = canEditDraft
      ? (firstStep?.buttonText ?? 'Submit')
      : null;
    // Creator withdraw: on an in-progress order whose create step allows cancel.
    const canCancel = isCreatorWithdraw && !!firstStep?.canCancel;

    return {
      ...order,
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
   * The next Purchase Order - IC number for the supplier company. Prefers the
   * company's configured Document Numbering rule (which advances its own counter,
   * so each retry yields a fresh number); falls back to the built-in PO-##### when
   * no rule is set for this document.
   */
  private async nextOrderNo(companyId: number, attempt: number): Promise<string> {
    const configured = await this.numbering.next(companyId, PO_IC_DOCUMENT_CODE);
    if (configured) return configured;
    const n = await this.prisma.purchaseOrder.count({ where: { companyId } });
    return `PO-${String(n + 1 + attempt).padStart(5, '0')}`;
  }
}
