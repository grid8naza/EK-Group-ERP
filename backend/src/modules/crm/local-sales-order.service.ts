import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  DocumentRef,
  WORKFLOW,
  WorkflowPort,
  WorkflowStatus,
} from '../../contracts/workflow.port';
import {
  ActLocalSalesOrderDto,
  CreateLocalSalesOrderDto,
  LocalSalesOrderLineDto,
  UpdateLocalSalesOrderDto,
} from './local-sales-order.dto';
import { ContractService } from './contract.service';

const CRM_MODULE_CODE = 'CRM';
const LSO_ROUTE = '/crm/lso';
const LSO_DOCUMENT_CODE = 'SALES_ORDER_LOCAL';

const STATUS_MAP: Record<WorkflowStatus, SalesOrderStatus> = {
  IN_PROGRESS: 'PLACED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

const withLines = {
  lines: { orderBy: { sequence: 'asc' as const } },
};

/**
 * Local Sales Orders — what an OUTSIDE customer has ordered from a branch.
 *
 * The third order document, and the one that had been missing. ICPO is the
 * branch asking the factory; ICSO is the factory answering; this is a shop, a
 * caterer or an institution asking the BRANCH. It shares the SalesOrder model
 * with the ICSO because nothing inverts between them — `companyId` is the seller
 * either way — and the two are told apart by which counterparty is set.
 *
 * A separate SERVICE, though, because almost nothing else is shared. An ICSO is
 * CONVERTED from an approved ICPO, splits its lines across the batches that will
 * fill them, takes its price from those batches and can raise a work order. An
 * LSO is typed from scratch, names its own price, and is the first document in
 * its chain. Only the workflow choreography is the same, and that is small
 * enough to say twice.
 *
 * What it feeds: the Order Catalogue reads these as demand ON the branch. Goods
 * a customer has ordered are goods the branch must have on top of what its shelf
 * needs, so they ADD to what it orders from the factory.
 */
@Injectable()
export class LocalSalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW) private readonly workflow: WorkflowPort,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    // Same module, so a direct injection — the boundary rule forbids reaching
    // ACROSS modules, and the contracts are CRM's own.
    private readonly contracts: ContractService,
  ) {}

  async create(
    userId: number,
    companyId: number | undefined,
    activeBranchId: number | undefined,
    dto: CreateLocalSalesOrderDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const branchId =
      dto.branchId !== undefined ? dto.branchId : (activeBranchId ?? null);
    await this.assertCustomer(companyId, dto.customerId);
    const lines = await this.assertLines(
      companyId,
      dto.lines,
      dto.customerId,
      dto.deliveryAt ? new Date(dto.deliveryAt) : null,
    );

    for (let attempt = 0; ; attempt++) {
      const orderNo = await this.numbering.nextOrDefault(
        { companyId, branchId },
        LSO_DOCUMENT_CODE,
        { prefix: 'CO-', padding: 5 },
        undefined,
        attempt,
      );
      try {
        const row = await this.prisma.salesOrder.create({
          data: {
            companyId,
            branchId,
            // The XOR the model cannot express: a local order names a CUSTOMER
            // and never a buyer company, whose demand arrives as an ICPO of its
            // own and would otherwise be counted twice.
            customerId: dto.customerId,
            buyerCompanyId: null,
            buyerBranchId: null,
            orderNo,
            deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : null,
            notes: dto.notes?.trim() || null,
            createdByUserId: userId,
            status: 'DRAFT',
            lines: { create: lines },
          },
          include: withLines,
        });
        return this.findOne(userId, row.id, true);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          attempt < 25
        ) {
          continue; // somebody took that number between our read and our write
        }
        throw e;
      }
    }
  }

  async update(userId: number, id: number, dto: UpdateLocalSalesOrderDto) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'customer order', 'editing');
    if (!(await this.canEdit(userId, order))) {
      throw new ForbiddenException('You cannot edit this order right now.');
    }
    if (dto.customerId != null) {
      await this.assertCustomer(order.companyId, dto.customerId);
    }
    const lines = dto.lines
      ? await this.assertLines(
          order.companyId,
          dto.lines,
          dto.customerId ?? order.customerId ?? undefined,
          dto.deliveryAt !== undefined
            ? dto.deliveryAt
              ? new Date(dto.deliveryAt)
              : null
            : order.deliveryAt,
        )
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.salesOrder.update({
        where: { id },
        data: {
          ...(dto.customerId != null ? { customerId: dto.customerId } : {}),
          ...(dto.deliveryAt !== undefined
            ? { deliveryAt: dto.deliveryAt ? new Date(dto.deliveryAt) : null }
            : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes.trim() || null }
            : {}),
        },
      });
      if (lines) {
        // Replaced wholesale — an order is one statement of what was asked for.
        await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
        await tx.salesOrderLine.createMany({
          data: lines.map((l, i) => ({ orderId: id, sequence: i, ...l })),
        });
      }
    });
    return this.findOne(userId, id, true);
  }

  async remove(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    assertUnlocked(order, 'customer order', 'deleting');
    if (order.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only draft orders can be deleted; submitted orders are handled through the workflow.',
      );
    }
    if (!isSuperAdmin && order.createdByUserId !== userId) {
      throw new ForbiddenException('Only the creator can delete this draft.');
    }
    await this.prisma.salesOrder.delete({ where: { id } });
    return { success: true };
  }

  /**
   * The active company's customer orders. Drafts stay private to their creator,
   * matching the ICSO — an order nobody has submitted is not yet anybody's news.
   */
  async findAll(userId: number, companyId: number, isSuperAdmin: boolean) {
    if (!companyId) return [];
    const rows = await this.prisma.salesOrder.findMany({
      where: {
        companyId,
        // LOCAL orders only. Without this the screen would list the ICSOs too,
        // which share the table.
        customerId: { not: null },
        ...(isSuperAdmin
          ? {}
          : {
              OR: [
                { status: { not: SalesOrderStatus.DRAFT } },
                { createdByUserId: userId },
              ],
            }),
      },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
    return this.decorate(rows);
  }

  async findOne(userId: number, id: number, isSuperAdmin: boolean) {
    const order = await this.ensureOrder(id);
    const ref = await this.docRef(order.id);
    const workflow = await this.workflow.docState(userId, ref);

    const isCreator = order.createdByUserId === userId;
    const isDraft = order.status === 'DRAFT';
    const canEditDraft = isDraft && (isCreator || isSuperAdmin);
    const inProgress = workflow.status === 'IN_PROGRESS';
    const isCreatorWithdraw = isCreator && inProgress && !workflow.myTask;

    const firstStep =
      canEditDraft || isCreatorWithdraw
        ? await this.workflow.firstStep(
            order.companyId,
            null,
            ref.moduleId,
            ref.objectId,
          )
        : null;

    const [decorated] = await this.decorate([order]);
    return {
      ...decorated,
      workflow,
      canEdit: canEditDraft || !!workflow.myTask?.canEdit,
      canSubmit: canEditDraft,
      submitButtonText: canEditDraft ? (firstStep?.buttonText ?? 'Submit') : null,
      canCancel: isCreatorWithdraw && !!firstStep?.canCancel,
    };
  }

  /** Whether the current user may raise one (workflow-governed, like the ICSO). */
  async createAccess(userId: number, isSuperAdmin: boolean) {
    const { moduleId, objectId } = await this.docType();
    const gate = await this.workflow.creatorGate(userId, moduleId, objectId);
    return {
      workflowGoverned: gate.governed,
      canCreate: isSuperAdmin || gate.allowed,
    };
  }

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
      companyId: order.companyId,
      branchId: null,
      moduleId,
      objectId,
      documentId: order.id,
      documentRef: order.orderNo,
      // Field-limit steps test the order's VALUE, as on every other order.
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

  async act(userId: number, id: number, dto: ActLocalSalesOrderDto) {
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

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /**
   * The order, and only if it IS a local one. An id belonging to an ICSO is a
   * not-found here rather than a row this screen half-understands.
   */
  private async ensureOrder(id: number) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, customerId: { not: null } },
      include: withLines,
    });
    if (!order) throw new NotFoundException('Customer order not found.');
    return order;
  }

  private async canEdit(
    userId: number,
    order: { id: number; status: SalesOrderStatus; createdByUserId: number },
  ) {
    if (order.status === 'DRAFT') return order.createdByUserId === userId;
    const state = await this.workflow.docState(
      userId,
      await this.docRef(order.id),
    );
    return !!state.myTask?.canEdit;
  }

  private async assertCustomer(companyId: number, customerId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, name: true, isActive: true },
    });
    if (!customer) {
      throw new BadRequestException(
        'That customer does not belong to this company.',
      );
    }
    if (!customer.isActive) {
      throw new BadRequestException(`${customer.name} is no longer active.`);
    }
  }

  /**
   * Lines whose products this company actually sells, each with a quantity —
   * and priced at the CONTRACT rate wherever a contract covers them.
   *
   * The contract price is applied here rather than defaulted on the form, and
   * it overrides whatever rate was sent. That is what a contract is: a price
   * agreed for the term, not a suggestion the counter can talk itself out of.
   * A branch that needs to charge something else is describing a change to the
   * agreement, and that belongs on the contract.
   *
   * Priced as at the DELIVERY date where one is given, since that is when the
   * goods change hands and which contract is live is a question about that day.
   */
  private async assertLines(
    companyId: number,
    lines: LocalSalesOrderLineDto[],
    customerId?: number,
    on?: Date | null,
  ) {
    const wanted = lines.filter((l) => l.quantity > 0);
    if (!wanted.length) {
      throw new BadRequestException(
        'Add at least one product with a quantity.',
      );
    }
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: wanted.map((l) => l.productId) },
        isActive: true,
        canSell: true,
        companies: { some: { companyId, canSell: true } },
      },
      select: { id: true },
    });
    const known = new Set(products.map((p) => p.id));
    if (wanted.some((l) => !known.has(l.productId))) {
      throw new BadRequestException(
        'A product on this order is not one this company sells.',
      );
    }
    const contractPrice = customerId
      ? await this.contracts.priceFor(
          companyId,
          customerId,
          (on ?? new Date()).toISOString().slice(0, 10),
        )
      : new Map();

    return wanted.map((l) => ({
      productId: l.productId,
      // orderedQty mirrors quantity here: on an ICSO the two differ because the
      // seller trims what the buyer asked for, but a customer order IS the ask.
      orderedQty: l.quantity,
      quantity: l.quantity,
      unitId: l.unitId,
      rate: contractPrice.get(l.productId)?.rate ?? l.rate ?? 0,
    }));
  }

  /** Rows with the names and totals a screen needs. */
  private async decorate(
    rows: Prisma.SalesOrderGetPayload<{ include: typeof withLines }>[],
  ) {
    if (!rows.length) return [];
    const [customers, products, units, branches] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          id: {
            in: [
              ...new Set(rows.map((r) => r.customerId).filter((c): c is number => c != null)),
            ],
          },
        },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.product.findMany({
        where: {
          id: {
            in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.productId)))],
          },
        },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.unit.findMany({
        select: { id: true, symbol: true, code: true },
      }),
      this.prisma.branch.findMany({ select: { id: true, name: true } }),
    ]);
    const customer = new Map(customers.map((c) => [c.id, c]));
    const product = new Map(products.map((p) => [p.id, p]));
    const unit = new Map(units.map((u) => [u.id, u.symbol ?? u.code]));
    const branch = new Map(branches.map((b) => [b.id, b.name]));

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      branchId: r.branchId,
      branchName: r.branchId != null ? (branch.get(r.branchId) ?? null) : null,
      orderNo: r.orderNo,
      orderDate: r.orderDate,
      deliveryAt: r.deliveryAt,
      customerId: r.customerId,
      customerCode:
        r.customerId != null ? (customer.get(r.customerId)?.code ?? null) : null,
      customerName:
        r.customerId != null ? (customer.get(r.customerId)?.name ?? null) : null,
      status: r.status,
      workflowStatus: r.workflowStatus,
      notes: r.notes,
      isLocked: r.isLocked,
      createdByUserId: r.createdByUserId,
      total: this.orderTotal(r.lines),
      lines: r.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productCode: product.get(l.productId)?.code ?? null,
        productName: product.get(l.productId)?.name ?? null,
        quantity: l.quantity,
        unitId: l.unitId,
        unitSymbol: unit.get(l.unitId) ?? '',
        rate: l.rate,
        amount: l.quantity * l.rate,
      })),
    }));
  }

  private orderTotal(lines: { quantity: number; rate: number }[]) {
    return lines.reduce((sum, l) => sum + l.quantity * l.rate, 0);
  }

  private async docType(): Promise<{ moduleId: number; objectId: number }> {
    const [mod, obj] = await Promise.all([
      this.prisma.module.findUnique({
        where: { code: CRM_MODULE_CODE },
        select: { id: true },
      }),
      this.prisma.objectMaster.findFirst({
        where: { route: LSO_ROUTE },
        select: { id: true },
      }),
    ]);
    if (!mod || !obj) {
      throw new BadRequestException('The LSO document type is not registered.');
    }
    return { moduleId: mod.id, objectId: obj.id };
  }

  private async docRef(documentId: number): Promise<DocumentRef> {
    const { moduleId, objectId } = await this.docType();
    return { moduleId, objectId, documentId };
  }
}
