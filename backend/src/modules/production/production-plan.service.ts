import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  NUMBERING,
  NumberingPort,
  NumberingScope,
} from '../../contracts/numbering.port';
import { RECIPE, RecipePort } from '../../contracts/recipe.port';
import { CreateProductionPlanDto } from './production-plan.dto';

const PRODUCTION_PLAN_DOCUMENT_CODE = 'PRODUCTION_PLAN';

const withDetail = {
  lines: {
    orderBy: [
      { costObjectName: 'asc' as const },
      { productName: 'asc' as const },
    ],
  },
  materials: { orderBy: { itemName: 'asc' as const } },
};

/**
 * Production Plans — the plan clubs the pending Work Orders into one buildable
 * document: demand aggregated per product, grouped by the cost centre / object
 * that makes it, with the raw-material requirement exploded from recipes.
 */
@Injectable()
export class ProductionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    @Inject(RECIPE) private readonly recipe: RecipePort,
  ) {}

  findAll(companyId: number | undefined, search?: string) {
    if (!companyId) return [];
    return this.prisma.productionPlan.findMany({
      where: {
        companyId,
        ...(search
          ? { planNo: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: withDetail,
    });
  }

  async findOne(id: number) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id },
      include: {
        ...withDetail,
        workOrders: { select: { id: true, orderNo: true, soNumber: true } },
      },
    });
    if (!plan) throw new NotFoundException('Production plan not found.');
    return plan;
  }

  /** How many pending work orders are waiting to be planned (drives the button). */
  async pendingCount(
    companyId: number | undefined,
  ): Promise<{ count: number }> {
    if (!companyId) return { count: 0 };
    const count = await this.prisma.workOrder.count({
      where: { companyId, status: 'PENDING', productionPlanId: null },
    });
    return { count };
  }

  /**
   * Build a plan from every pending, not-yet-planned Work Order in the company:
   * aggregate demand per product, explode recipes for the material need, and
   * link the clubbed work orders.
   */
  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: CreateProductionPlanDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');

    const workOrders = await this.prisma.workOrder.findMany({
      where: { companyId, status: 'PENDING', productionPlanId: null },
      include: { lines: true },
    });
    if (!workOrders.length) {
      throw new BadRequestException(
        'There are no pending work orders to plan.',
      );
    }

    // Aggregate demand per product across all clubbed work orders.
    const demandMap = new Map<
      number,
      { productId: number; quantity: number; unitId: number }
    >();
    for (const wo of workOrders) {
      for (const l of wo.lines) {
        const cur = demandMap.get(l.productId);
        if (cur) cur.quantity += l.quantity;
        else
          demandMap.set(l.productId, {
            productId: l.productId,
            quantity: l.quantity,
            unitId: l.unitId,
          });
      }
    }
    const demand = [...demandMap.values()];

    // Explode recipes (material need + each product's primary group).
    const explosion = await this.recipe.explode(
      companyId,
      demand.map((d) => ({ productId: d.productId, quantity: d.quantity })),
    );
    const plannedById = new Map(
      explosion.products.map((p) => [p.productId, p]),
    );

    // Lines carry the product's RECIPE cost centre / object for this company —
    // planning is about making, so the recipe side applies. A product with no
    // costing set plans fine and simply groups as unassigned.
    const costNames = await this.costingNames(explosion.products);

    const lines = demand.map((d) => {
      const planned = plannedById.get(d.productId);
      const costCenterId = planned?.costCenterId ?? null;
      const costObjectId = planned?.costObjectId ?? null;
      return {
        productId: d.productId,
        productName: planned?.productName ?? `#${d.productId}`,
        quantity: d.quantity,
        unitId: d.unitId,
        primaryGroupId: planned?.primaryGroupId ?? null,
        costCenterId,
        costCenterName:
          costCenterId != null
            ? (costNames.centres.get(costCenterId) ?? null)
            : null,
        costObjectId,
        costObjectName:
          costObjectId != null
            ? (costNames.objects.get(costObjectId) ?? null)
            : null,
      };
    });

    const woIds = workOrders.map((w) => w.id);
    const plan = await this.withPlanNoRetry({ companyId, branchId }, (planNo) =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.productionPlan.create({
          data: {
            companyId,
            branchId: branchId ?? null,
            planNo,
            status: 'DRAFT',
            notes: dto.notes?.trim() || null,
            createdByUserId: userId,
            lines: { create: lines },
            materials: { create: explosion.materials },
          },
        });
        // Link the clubbed work orders to this plan (marks them planned).
        await tx.workOrder.updateMany({
          where: { id: { in: woIds }, productionPlanId: null },
          data: { productionPlanId: created.id },
        });
        return created;
      }),
    );
    return this.findOne(plan.id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.productionPlan.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const plan = await this.findOne(id);
    assertUnlocked(plan, 'production plan', 'deleting');
    // Work orders detach automatically (onDelete: SetNull), returning to the
    // pending pool so they can be re-planned.
    await this.prisma.productionPlan.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  /**
   * Names for the cost centres / objects a plan's products point at, so each
   * line can snapshot them. Snapshotted rather than joined at read time: a
   * later rename must not rewrite what a past plan was raised against.
   *
   * Cost centres live in Cpanel, hence plain id lookups here — no relation to
   * traverse from the production side.
   */
  private async costingNames(
    products: { costCenterId: number | null; costObjectId: number | null }[],
  ) {
    const centreIds = [
      ...new Set(
        products
          .map((p) => p.costCenterId)
          .filter((n): n is number => n != null),
      ),
    ];
    const objectIds = [
      ...new Set(
        products
          .map((p) => p.costObjectId)
          .filter((n): n is number => n != null),
      ),
    ];
    const [centres, objects] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { id: { in: centreIds } },
        select: { id: true, name: true },
      }),
      this.prisma.costObject.findMany({
        where: { id: { in: objectIds } },
        select: { id: true, name: true },
      }),
    ]);
    return {
      centres: new Map(centres.map((c) => [c.id, c.name])),
      objects: new Map(objects.map((o) => [o.id, o.name])),
    };
  }

  private async withPlanNoRetry<T>(
    scope: NumberingScope,
    fn: (planNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const planNo = await this.nextPlanNo(scope, i);
      try {
        return await fn(planNo);
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

  private async nextPlanNo(
    scope: NumberingScope,
    attempt: number,
  ): Promise<string> {
    return this.numbering.nextOrDefault(
      scope,
      PRODUCTION_PLAN_DOCUMENT_CODE,
      { prefix: 'PP-', padding: 4 },
      undefined,
      attempt,
    );
  }
}
