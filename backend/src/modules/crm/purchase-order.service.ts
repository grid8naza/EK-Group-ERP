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
  PurchaseOrderLineInput,
  UpdatePurchaseOrderDto,
} from './purchase-order.dto';

// A PO is matched to its workflow at the ORIGIN (the buyer's company/branch), so
// the workflow binds to the ICPO screen — the buyer's view of the order, which
// lives in the Purchase module. "ICPO - Received" (CRM) is the supplier's view of
// the same row and has no workflow of its own.
const ICPO_MODULE_CODE = 'PURCHASE';
const ICPO_ROUTE = '/purchase/icpo';
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

/** A line as persisted, once its transfer price has been resolved. */
type LinePayload = {
  productId: number;
  quantity: number;
  unitId: number;
  rate: number;
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

    const lines = await this.priceLines(dto.supplierCompanyId, dto.lines);

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
          lines: { create: lines.map((l, i) => ({ sequence: i, ...l })) },
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

    // A draft isn't placed yet, so it tracks the master's current price. Once the
    // order is in the workflow its rates are frozen at what they were placed at —
    // an approver editing quantities must not re-price the order under them.
    const lines = dto.lines
      ? order.status === 'DRAFT'
        ? await this.priceLines(order.companyId, dto.lines)
        : await this.repriceInFlight(order.companyId, dto.lines, order.lines)
      : undefined;

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
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((l, i) => ({ orderId: id, sequence: i, ...l })),
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

    // THE snapshot moment. Placing the order fixes its rates at the supplier's
    // transfer price right now, and nothing moves them afterwards. Doing it here
    // rather than trusting the last draft save means a draft that sat for a month
    // can't be placed at a stale price, whatever route reached this method.
    const priceOf = await this.priceMap(
      order.companyId,
      order.lines.map((l) => l.productId),
    );
    await this.prisma.$transaction(
      order.lines.map((l) =>
        this.prisma.purchaseOrderLine.update({
          where: { id: l.id },
          data: { rate: priceOf.get(l.productId)! },
        }),
      ),
    );
    const placedLines = order.lines.map((l) => ({
      ...l,
      rate: priceOf.get(l.productId)!,
    }));

    const { moduleId, objectId } = await this.docType();
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
      // Field-limit steps test this. It is the order's VALUE at placement —
      // summed quantity would be meaningless here, since lines carry their own
      // units and adding 5 Kg to 3 Cartons yields "8".
      amount: this.orderTotal(placedLines),
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
   * List orders for the active company, by DIRECTION. One PO is a single row
   * seen from two sides, so the active company decides which side it is on:
   *  - `sent`: orders this company raised on a supplier (it is the requester).
   *    Drafts stay private to their creator — they haven't been forwarded yet.
   *  - `received`: submitted orders raised ON this company (it is the supplier).
   *    Drafts are never included; they don't exist outside the buyer.
   *
   * Both scopes are company-scoped, super admins included — otherwise the two
   * screens would mix for exactly the users most likely to be checking them.
   * Access to each screen is governed by its own privilege (they are separate
   * Object Master rows), so no further per-row filtering happens here.
   */
  async findAll(
    userId: number,
    companyId: number,
    scope: 'sent' | 'received',
    isSuperAdmin: boolean,
  ) {
    // Without an active company neither direction is meaningful.
    if (!companyId) return [];

    const where: Prisma.PurchaseOrderWhereInput =
      scope === 'sent'
        ? {
            orderingCompanyId: companyId,
            ...(isSuperAdmin
              ? {}
              : {
                  OR: [
                    { status: { not: PurchaseOrderStatus.DRAFT } },
                    { placedByUserId: userId },
                  ],
                }),
          }
        : { companyId, status: { not: PurchaseOrderStatus.DRAFT } };

    const rows = await this.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
    return rows.map((r) => ({ ...r, total: this.orderTotal(r.lines) }));
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
   * Current transfer prices for these products, from the SUPPLIER's master.
   *
   * Prices are read here rather than accepted from the client: an intercompany
   * price is group policy (Product.intercompanyPrice), not something the
   * ordering branch negotiates — which is exactly how it differs from an LPO's
   * rate. A product the supplier doesn't offer is rejected rather than silently
   * priced at 0, since a 0 would understate the order's value and let it slip
   * under an approval limit.
   */
  private async priceMap(
    supplierCompanyId: number,
    productIds: number[],
  ): Promise<Map<number, number>> {
    const ids = [...new Set(productIds)];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: ids },
        OR: [
          { allCompanies: true },
          { companies: { some: { companyId: supplierCompanyId } } },
        ],
      },
      select: { id: true, intercompanyPrice: true },
    });
    const priceOf = new Map(products.map((p) => [p.id, p.intercompanyPrice]));
    const missing = ids.filter((id) => !priceOf.has(id));
    if (missing.length) {
      throw new BadRequestException(
        'Some products are not offered by the supplier company.',
      );
    }
    return priceOf;
  }

  /** Lines priced at the supplier's CURRENT transfer price (drafts only). */
  private async priceLines(
    supplierCompanyId: number,
    lines: PurchaseOrderLineInput[],
  ): Promise<LinePayload[]> {
    const priceOf = await this.priceMap(
      supplierCompanyId,
      lines.map((l) => l.productId),
    );
    return lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitId: l.unitId,
      rate: priceOf.get(l.productId)!,
    }));
  }

  /**
   * Lines for an order already in the workflow: keep the rate it was PLACED at.
   *
   * The order's value is what an approver signed off, so a later master price
   * change must not reach back into it. A line for a product that wasn't on the
   * order before has no placed rate to keep, so it takes the current one.
   */
  private async repriceInFlight(
    supplierCompanyId: number,
    lines: PurchaseOrderLineInput[],
    placed: { productId: number; rate: number }[],
  ): Promise<LinePayload[]> {
    const placedRate = new Map(placed.map((l) => [l.productId, l.rate]));
    const added = lines
      .map((l) => l.productId)
      .filter((id) => !placedRate.has(id));
    const priceOf = added.length
      ? await this.priceMap(supplierCompanyId, added)
      : new Map<number, number>();

    return lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitId: l.unitId,
      rate: placedRate.get(l.productId) ?? priceOf.get(l.productId)!,
    }));
  }

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

  /** The Purchase module id + ICPO object id — the workflow document type. */
  private async docType(): Promise<{ moduleId: number; objectId: number }> {
    const [mod, obj] = await Promise.all([
      this.prisma.module.findUnique({
        where: { code: ICPO_MODULE_CODE },
        select: { id: true },
      }),
      this.prisma.objectMaster.findFirst({
        where: { route: ICPO_ROUTE },
        select: { id: true },
      }),
    ]);
    if (!mod || !obj) {
      throw new BadRequestException(
        'The ICPO document type is not registered.',
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
