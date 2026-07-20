import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MaterialRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import { RECIPE, RecipePort } from '../../contracts/recipe.port';
import { STOCK, StockPort } from '../../contracts/stock.port';
import {
  STOCK_POSTING,
  StockPostingPort,
} from '../../contracts/stock-posting.port';
import {
  GenerateMaterialRequestsDto,
  IssueMaterialRequestDto,
} from './material-request.dto';

const MATERIAL_REQUEST_DOCUMENT_CODE = 'MATERIAL_REQUEST';
/** The store's goods issue — the same note the Inventory module issues under. */
const GOODS_ISSUE_DOCUMENT_CODE = 'GOODS_ISSUE_NOTE';

const withLines = {
  lines: { orderBy: { itemName: 'asc' as const } },
};

/** "An issued" / "A cancelled" — for a status named in a sentence. */
const article = (status: MaterialRequestStatus) =>
  `${'AEIOU'.includes(status[0]) ? 'An' : 'A'} ${status.toLowerCase()}`;

/**
 * Material Requests — the requisition operations sends to the store for the raw
 * materials a production division needs. Raised from a Production Plan: one
 * request per division, aggregating that division's products' recipe materials,
 * with each line's on-hand at the store captured so shortfalls are visible.
 */
@Injectable()
export class MaterialRequestService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    @Inject(RECIPE) private readonly recipe: RecipePort,
    @Inject(STOCK) private readonly stock: StockPort,
    @Inject(STOCK_POSTING) private readonly posting: StockPostingPort,
  ) {}

  findAll(companyId: number | undefined, search?: string) {
    if (!companyId) return [];
    return this.prisma.materialRequest.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { requestNo: { contains: search, mode: 'insensitive' } },
                { planNo: { contains: search, mode: 'insensitive' } },
                { divisionName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  async findOne(id: number) {
    const mr = await this.prisma.materialRequest.findUnique({
      where: { id },
      include: withLines,
    });
    if (!mr) throw new NotFoundException('Material request not found.');
    return mr;
  }

  /**
   * Raise the material requests for a plan — one per division that has recipe
   * materials and hasn't been requested yet. Returns every request now on the
   * plan (existing + newly created).
   */
  async generateFromPlan(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    planId: number,
    dto: GenerateMaterialRequestsDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: { lines: true },
    });
    if (!plan) throw new NotFoundException('Production plan not found.');
    if (plan.companyId !== companyId) {
      throw new BadRequestException('That plan belongs to another company.');
    }

    // Target store: the caller's choice, else the company/branch default store.
    const store = await this.resolveStore(companyId, branchId, dto.storeId);

    // Which divisions already have a request for this plan — don't duplicate.
    const existing = await this.prisma.materialRequest.findMany({
      where: { productionPlanId: planId },
      select: { divisionId: true },
    });
    const done = new Set(existing.map((e) => String(e.divisionId ?? 'null')));

    // Group the plan's product lines by division.
    const byDivision = new Map<
      string,
      {
        divisionId: number | null;
        divisionName: string | null;
        demand: { productId: number; quantity: number }[];
      }
    >();
    for (const l of plan.lines) {
      const key = String(l.divisionId ?? 'null');
      const g =
        byDivision.get(key) ??
        byDivision
          .set(key, {
            divisionId: l.divisionId,
            divisionName: l.divisionName,
            demand: [],
          })
          .get(key)!;
      g.demand.push({ productId: l.productId, quantity: l.quantity });
    }

    for (const group of byDivision.values()) {
      if (done.has(String(group.divisionId ?? 'null'))) continue;
      // Explode this division's products into item requirements.
      const { materials } = await this.recipe.explode(companyId, group.demand);
      if (!materials.length) continue; // nothing to request for this division

      const itemIds = materials.map((m) => m.itemId);
      const onHand = await this.stock.onHandForItems(
        companyId,
        itemIds,
        store?.id,
      );
      const availableOf = new Map(onHand.map((o) => [o.itemId, o.onHand]));

      const lines = materials.map((m) => ({
        itemId: m.itemId,
        itemName: m.itemName,
        requiredQty: m.quantity,
        availableQty: availableOf.get(m.itemId) ?? 0,
        unitId: m.unitId,
      }));

      await this.withRequestNoRetry(companyId, (requestNo) =>
        this.prisma.materialRequest.create({
          data: {
            companyId,
            branchId: branchId ?? null,
            requestNo,
            productionPlanId: plan.id,
            planNo: plan.planNo,
            divisionId: group.divisionId,
            divisionName: group.divisionName,
            storeId: store?.id ?? null,
            storeName: store?.name ?? null,
            status: 'DRAFT',
            createdByUserId: userId,
            lines: { create: lines },
          },
        }),
      );
    }

    return this.prisma.materialRequest.findMany({
      where: { companyId, productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  /**
   * The store issues the requisition: the materials LEAVE stock here. This is
   * the only point in the pipeline where raw materials are consumed — the
   * production receipt banks output only, so without this the ledger would keep
   * showing materials that were long since baked.
   *
   * A line may be issued short (the store hands over what it has); only the
   * issued quantity moves. Issuing nothing of every line is refused — that is a
   * cancellation, not an issue.
   */
  async issue(
    companyId: number | undefined,
    branchId: number | undefined,
    id: number,
    dto: IssueMaterialRequestDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');
    const mr = await this.findOne(id);
    assertUnlocked(mr, 'material request', 'editing');
    if (mr.companyId !== companyId) {
      throw new BadRequestException('That request belongs to another company.');
    }
    if (mr.status !== 'DRAFT') {
      throw new BadRequestException(
        `${article(mr.status)} material request cannot be issued.`,
      );
    }
    if (!mr.storeId) {
      throw new BadRequestException(
        'This request has no store to issue from. Set a default store and raise it again.',
      );
    }

    // Default: issue every line in full. A line named in the payload is issued
    // at that quantity instead.
    const askedFor = new Map(
      (dto.lines ?? []).map((l) => [l.lineId, l.issuedQty]),
    );
    for (const lineId of askedFor.keys()) {
      if (!mr.lines.some((l) => l.id === lineId)) {
        throw new BadRequestException('That line is not on this request.');
      }
    }
    const issue = mr.lines.map((l) => ({
      lineId: l.id,
      itemId: l.itemId,
      itemName: l.itemName,
      quantity: askedFor.has(l.id) ? askedFor.get(l.id)! : l.requiredQty,
      requiredQty: l.requiredQty,
    }));
    const over = issue.find((l) => l.quantity > l.requiredQty);
    if (over) {
      throw new BadRequestException(
        `Cannot issue ${over.quantity} of ${over.itemName} — only ${over.requiredQty} was requested.`,
      );
    }
    const moving = issue.filter((l) => l.quantity > 0);
    if (!moving.length) {
      throw new BadRequestException(
        'Nothing to issue. Cancel the request instead.',
      );
    }

    const issueNo = await this.nextIssueNo(companyId);

    // Record the issue, then move the stock. The store either hands over the
    // whole requisition or none of it, so a posting failure puts the request
    // back exactly as it was.
    await this.prisma.$transaction(async (tx) => {
      for (const l of issue) {
        await tx.materialRequestLine.update({
          where: { id: l.lineId },
          data: { issuedQty: l.quantity },
        });
      }
      await tx.materialRequest.update({
        where: { id },
        data: { status: 'ISSUED', issueNo, issuedAt: new Date() },
      });
    });

    try {
      await this.posting.postMaterialIssue({
        companyId,
        branchId: branchId ?? mr.branchId ?? null,
        storeId: mr.storeId,
        documentId: mr.id,
        documentNo: issueNo,
        date: new Date().toISOString(),
        lines: moving.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      });
    } catch (e) {
      await this.prisma.$transaction(async (tx) => {
        for (const l of issue) {
          await tx.materialRequestLine.update({
            where: { id: l.lineId },
            data: { issuedQty: 0 },
          });
        }
        await tx.materialRequest.update({
          where: { id },
          data: { status: 'DRAFT', issueNo: null, issuedAt: null },
        });
      });
      throw e;
    }

    return this.findOne(id);
  }

  /** Advance the request's status. Issuing goes through issue() — it moves stock. */
  async setStatus(id: number, status: MaterialRequestStatus) {
    const mr = await this.findOne(id);
    assertUnlocked(mr, 'material request', 'editing');
    if (mr.status === 'CANCELLED' || mr.status === 'ISSUED') {
      throw new BadRequestException(
        `${article(mr.status)} material request cannot change status.`,
      );
    }
    if (status === 'ISSUED') {
      throw new BadRequestException(
        'Issue the request from the store so the materials leave stock.',
      );
    }
    return this.prisma.materialRequest.update({
      where: { id },
      data: { status },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.materialRequest.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const mr = await this.findOne(id);
    assertUnlocked(mr, 'material request', 'deleting');
    if (mr.status === 'ISSUED') {
      throw new BadRequestException(
        'An issued material request cannot be deleted.',
      );
    }
    await this.prisma.materialRequest.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  /** The chosen store, else the company/branch default (isDefault) store. */
  private async resolveStore(
    companyId: number,
    branchId: number | undefined,
    storeId: number | undefined,
  ): Promise<{ id: number; name: string } | null> {
    if (storeId) {
      const s = await this.prisma.store.findFirst({
        where: { id: storeId, companyId },
        select: { id: true, name: true },
      });
      if (!s) throw new BadRequestException('That store is not in this company.');
      return s;
    }
    // Prefer the active branch's default store, then any company default.
    return (
      (await this.prisma.store.findFirst({
        where: {
          companyId,
          isDefault: true,
          ...(branchId ? { branchId } : {}),
        },
        select: { id: true, name: true },
      })) ??
      (await this.prisma.store.findFirst({
        where: { companyId, isDefault: true },
        select: { id: true, name: true },
      })) ??
      null
    );
  }

  private async withRequestNoRetry<T>(
    companyId: number,
    fn: (requestNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const requestNo = await this.nextRequestNo(companyId, i);
      try {
        return await fn(requestNo);
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

  /** The goods-issue number for this store issue (GIN-#### when no rule set). */
  private async nextIssueNo(companyId: number): Promise<string> {
    const configured = await this.numbering.next(
      companyId,
      GOODS_ISSUE_DOCUMENT_CODE,
    );
    if (configured) return configured;
    const n = await this.prisma.materialRequest.count({
      where: { companyId, status: 'ISSUED' },
    });
    return `GIN-${String(n + 1).padStart(4, '0')}`;
  }

  private async nextRequestNo(
    companyId: number,
    attempt: number,
  ): Promise<string> {
    const configured = await this.numbering.next(
      companyId,
      MATERIAL_REQUEST_DOCUMENT_CODE,
    );
    if (configured) return configured;
    const n = await this.prisma.materialRequest.count({ where: { companyId } });
    return `MR-${String(n + 1 + attempt).padStart(4, '0')}`;
  }
}
