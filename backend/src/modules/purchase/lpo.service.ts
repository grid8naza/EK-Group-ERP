import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LocalPurchaseOrderStatus, Prisma } from '@prisma/client';
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
import { ActLpoDto, CreateLpoDto, LpoLineInput, UpdateLpoDto } from './lpo.dto';

// The LPO is raised by the buyer, so its workflow binds to the LPO screen —
// definitions are matched at the document's origin (the buyer's company/branch).
const PURCHASE_MODULE_CODE = 'PURCHASE';
const LPO_ROUTE = '/purchase/lpo';
// Document code the central numbering rules key on (see Document Master seed).
const LPO_DOCUMENT_CODE = 'PURCHASE_ORDER_LOCAL';

// Workflow instance status → LPO status.
const STATUS_MAP: Record<WorkflowStatus, LocalPurchaseOrderStatus> = {
  IN_PROGRESS: 'PLACED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

const withLines = {
  lines: { orderBy: { sequence: 'asc' as const } },
};

/** A line as it will be persisted, once the master has had its say on the unit. */
type ResolvedLine = {
  itemId: number | null;
  productId: number | null;
  quantity: number;
  unitId: number;
  rate: number;
};

/** The slice of an item / product master this service needs: its stock unit. */
type UnitOf = { id: number; unitId: number };

@Injectable()
export class LpoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW) private readonly workflow: WorkflowPort,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  /**
   * Raise a Local Purchase Order as a DRAFT owned by the BUYER (the active
   * company). The draft isn't in any workflow yet — the requester submits it
   * later, which routes it to their own approval chain.
   */
  async create(
    userId: number,
    companyId: number,
    branchId: number | undefined,
    dto: CreateLpoDto,
    isSuperAdmin = false,
  ) {
    if (!companyId) {
      throw new BadRequestException('No active company for the requester.');
    }
    await this.ensureSupplier(companyId, dto.supplierId);
    await this.ensureStore(companyId, dto.storeId);
    const lines = await this.resolveLines(companyId, dto.lines);

    // When a workflow governs this form it SUPERSEDES the Add privilege: only a
    // user on a Create-action step may raise the order.
    const { moduleId, objectId } = await this.docType();
    const gate = await this.workflow.creatorGate(
      userId,
      moduleId,
      objectId,
      companyId,
      branchId ?? null,
    );
    if (gate.governed && !gate.allowed && !isSuperAdmin) {
      throw new ForbiddenException(
        'This order is governed by an approval workflow — only its designated creator can raise it.',
      );
    }

    const order = await this.withOrderNoRetry(companyId, (orderNo) =>
      this.prisma.localPurchaseOrder.create({
        data: {
          companyId,
          branchId: branchId ?? null,
          supplierId: dto.supplierId,
          orderNo,
          deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : null,
          storeId: dto.storeId ?? null,
          placedByUserId: userId,
          status: 'DRAFT',
          notes: dto.notes?.trim() || null,
          lines: {
            create: lines.map((l, i) => ({ sequence: i, ...l })),
          },
        },
        include: withLines,
      }),
    );
    return this.findOne(userId, order.id, true);
  }

  /**
   * Whether the current user may raise a new order. When a workflow governs the
   * LPO form, only its designated creator(s) may — this supersedes the Add
   * privilege. With no workflow, creation falls back to the screen privilege.
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
  async update(userId: number, id: number, dto: UpdateLpoDto) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'local purchase order', 'editing');
    if (!(await this.canEdit(userId, order))) {
      throw new ForbiddenException('You cannot edit this order right now.');
    }
    if (dto.storeId !== undefined) {
      await this.ensureStore(order.companyId, dto.storeId);
    }
    const lines = dto.lines
      ? await this.resolveLines(order.companyId, dto.lines)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.localPurchaseOrder.update({
        where: { id },
        data: {
          deliveryAt:
            dto.deliveryAt !== undefined
              ? dto.deliveryAt
                ? new Date(dto.deliveryAt)
                : null
              : undefined,
          storeId: dto.storeId !== undefined ? dto.storeId : undefined,
          notes: dto.notes !== undefined ? dto.notes.trim() || null : undefined,
        },
      });
      if (lines) {
        await tx.localPurchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.localPurchaseOrderLine.createMany({
          data: lines.map((l, i) => ({ orderId: id, sequence: i, ...l })),
        });
      }
    });
    return this.findOne(userId, id, true);
  }

  /** Delete a draft (creator only). Submitted orders live in the workflow. */
  async remove(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'local purchase order', 'deleting');
    if (order.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only draft orders can be deleted; submitted orders are handled through the workflow.',
      );
    }
    if (!isSuperAdmin && order.placedByUserId !== userId) {
      throw new ForbiddenException('Only the creator can delete this draft.');
    }
    await this.prisma.localPurchaseOrder.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Submit a draft into the buyer's approval workflow. Acts as the creator's
   * first level (create + forward), so it lands at the next approver. Falls back
   * to a plain PLACED status when no workflow is configured.
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
    const res = await this.workflow.submitAsCreator({
      startedByUserId: userId,
      // Matched at the ORIGIN — which for an LPO is simply the buyer, the only
      // company involved.
      companyId: order.companyId,
      branchId: order.branchId,
      moduleId,
      objectId,
      documentId: order.id,
      documentRef: order.orderNo,
      // Field-limit steps test this. Money is the meaningful measure of external
      // spend, so approval limits read as "orders over X need a Director".
      amount: this.orderTotal(order.lines),
    });

    await this.prisma.localPurchaseOrder.update({
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
  async act(userId: number, id: number, dto: ActLpoDto) {
    const order = await this.ensureOrder(id);
    const ref = await this.docRef(order.id);

    // Creator withdrawing their own in-progress order. Having forwarded it, the
    // creator no longer holds a task, so this can't go through the task-based
    // path — gate it on the create step's `canCancel` and cancel the instance.
    if (dto.action === 'CANCEL' && order.placedByUserId === userId) {
      const state = await this.workflow.docState(userId, ref);
      if (!state.myTask) {
        const first = await this.workflow.firstStep(
          order.companyId,
          order.branchId,
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
        await this.prisma.localPurchaseOrder.update({
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
    await this.prisma.localPurchaseOrder.update({
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
   * List the active company's LPOs. There is only ONE direction here — an
   * external supplier never logs in, so unlike the ICPO there's no "received"
   * side. Drafts stay private to their creator; access to the screen is governed
   * by its privilege, so no further per-row filtering happens.
   */
  async findAll(userId: number, companyId: number, isSuperAdmin: boolean) {
    if (!companyId) return [];
    const where: Prisma.LocalPurchaseOrderWhereInput = {
      companyId,
      ...(isSuperAdmin
        ? {}
        : {
            OR: [
              { status: { not: LocalPurchaseOrderStatus.DRAFT } },
              { placedByUserId: userId },
            ],
          }),
    };
    const rows = await this.prisma.localPurchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
    // The listing shows each order's value, so it needs the same total findOne
    // computes — otherwise every row renders as zero.
    return rows.map((r) => ({ ...r, total: this.orderTotal(r.lines) }));
  }

  /** One order plus the viewer's workflow state and available actions. */
  async findOne(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.prisma.localPurchaseOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Local purchase order not found.');

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

    let firstStep: WorkflowFirstStep | null = null;
    if (canEditDraft || isCreatorWithdraw) {
      firstStep = await this.workflow.firstStep(
        order.companyId,
        order.branchId,
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

  private orderTotal(lines: { quantity: number; rate: number }[]): number {
    return lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  }

  private async ensureOrder(id: number) {
    const order = await this.prisma.localPurchaseOrder.findUnique({
      where: { id },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Local purchase order not found.');
    return order;
  }

  /** The supplier must exist, be active, and belong to the buying company. */
  private async ensureSupplier(companyId: number, supplierId: number) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId, isActive: true },
      select: { id: true },
    });
    if (!supplier) {
      throw new BadRequestException('Choose a valid supplier for this company.');
    }
  }

  /** The delivery store, when named, must belong to the buying company. */
  private async ensureStore(companyId: number, storeId?: number | null) {
    if (!storeId) return;
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, companyId, isActive: true },
      select: { id: true },
    });
    if (!store) {
      throw new BadRequestException('Choose a valid store for this company.');
    }
  }

  /**
   * Validate each line's item/product and take its unit from the master.
   *
   * Exactly one of itemId / productId must be set — the same exclusive-or the
   * Goods Receipt Note enforces, so an approved LPO line maps onto a GRN line
   * without translation. Prisma can't express XOR, so this is the enforcement.
   * Both masters are global rows with per-company availability, so each is
   * checked against the buyer's company.
   */
  private async resolveLines(
    companyId: number,
    lines: LpoLineInput[],
  ): Promise<ResolvedLine[]> {
    const itemIds = [...new Set(lines.map((l) => l.itemId).filter(isId))];
    const productIds = [...new Set(lines.map((l) => l.productId).filter(isId))];
    const available = {
      OR: [{ allCompanies: true }, { companies: { some: { companyId } } }],
    };
    const none: UnitOf[] = [];

    const [items, products] = await Promise.all([
      itemIds.length
        ? this.prisma.item.findMany({
            where: { id: { in: itemIds }, isActive: true, ...available },
            select: { id: true, unitId: true },
          })
        : Promise.resolve(none),
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds }, isActive: true, ...available },
            select: { id: true, unitId: true },
          })
        : Promise.resolve(none),
    ]);
    const itemUnit = new Map(items.map((i) => [i.id, i.unitId]));
    const productUnit = new Map(products.map((p) => [p.id, p.unitId]));

    return lines.map((l, i) => {
      const at = `Line ${i + 1}`;
      if (!l.itemId && !l.productId) {
        throw new BadRequestException(`${at}: choose an item or a product.`);
      }
      if (l.itemId && l.productId) {
        throw new BadRequestException(
          `${at}: a line cannot be both an item and a product.`,
        );
      }
      const unitId = l.itemId
        ? itemUnit.get(l.itemId)
        : productUnit.get(l.productId!);
      if (unitId === undefined) {
        throw new BadRequestException(
          `${at}: that ${l.itemId ? 'item' : 'product'} isn't available to this company.`,
        );
      }
      return {
        itemId: l.itemId ?? null,
        productId: l.productId ?? null,
        quantity: l.quantity,
        unitId,
        rate: l.rate,
      };
    });
  }

  /** Whether the viewer may edit this order now (draft creator, or step canEdit). */
  private async canEdit(
    userId: number,
    order: {
      id: number;
      status: LocalPurchaseOrderStatus;
      placedByUserId: number;
    },
  ): Promise<boolean> {
    if (order.status === 'DRAFT') return order.placedByUserId === userId;
    const ref = await this.docRef(order.id);
    const state = await this.workflow.docState(userId, ref);
    return !!state.myTask?.canEdit;
  }

  /** The Purchase module id + LPO object id — the workflow document type. */
  private async docType(): Promise<{ moduleId: number; objectId: number }> {
    const [mod, obj] = await Promise.all([
      this.prisma.module.findUnique({
        where: { code: PURCHASE_MODULE_CODE },
        select: { id: true },
      }),
      this.prisma.objectMaster.findFirst({
        where: { route: LPO_ROUTE },
        select: { id: true },
      }),
    ]);
    if (!mod || !obj) {
      throw new BadRequestException('The LPO document type is not registered.');
    }
    return { moduleId: mod.id, objectId: obj.id };
  }

  private async docRef(documentId: number): Promise<DocumentRef> {
    const { moduleId, objectId } = await this.docType();
    return { moduleId, objectId, documentId };
  }

  /** Generate the next per-buyer order number, retrying on a unique clash. */
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
   * The next LPO number for the buying company. Prefers the company's configured
   * Document Numbering rule (which advances its own counter, so each retry
   * yields a fresh number); falls back to the built-in LPO-##### when no rule is
   * set for this document.
   */
  private async nextOrderNo(companyId: number, attempt: number): Promise<string> {
    return this.numbering.nextOrDefault(
      companyId,
      LPO_DOCUMENT_CODE,
      { prefix: 'LPO-', padding: 5 },
      undefined,
      attempt,
    );
  }
}

/** Narrows `number | null | undefined` to `number` inside a filter(). */
function isId(v: number | null | undefined): v is number {
  return typeof v === 'number';
}
