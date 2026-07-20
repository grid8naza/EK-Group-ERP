import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import { RECIPE, RecipePort } from '../../contracts/recipe.port';
import { CreateProductionPlanDto } from './production-plan.dto';

const PRODUCTION_PLAN_DOCUMENT_CODE = 'PRODUCTION_PLAN';

const withDetail = {
  lines: { orderBy: [{ divisionName: 'asc' as const }, { productName: 'asc' as const }] },
  materials: { orderBy: { itemName: 'asc' as const } },
};

/**
 * Production Plans — the plan clubs the pending Work Orders into one buildable
 * document: demand aggregated per product, grouped by the division that makes
 * it, with the raw-material requirement exploded from recipes.
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
  async pendingCount(companyId: number | undefined): Promise<{ count: number }> {
    if (!companyId) return { count: 0 };
    const count = await this.prisma.workOrder.count({
      where: { companyId, status: 'PENDING', productionPlanId: null },
    });
    return { count };
  }

  /**
   * Build a plan from every pending, not-yet-planned Work Order in the company:
   * aggregate demand per product, explode recipes for the material need, group
   * each product under its division, and link the clubbed work orders.
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

    // Resolve division for each product's primary group.
    const primaryGroupIds = [
      ...new Set(
        explosion.products
          .map((p) => p.primaryGroupId)
          .filter((g): g is number => g != null),
      ),
    ];
    const maps = primaryGroupIds.length
      ? await this.prisma.productionDivisionGroup.findMany({
          where: { companyId, primaryGroupId: { in: primaryGroupIds } },
          select: {
            primaryGroupId: true,
            division: { select: { id: true, name: true } },
          },
        })
      : [];
    const divisionByGroup = new Map(
      maps.map((m) => [m.primaryGroupId, m.division]),
    );

    const lines = demand.map((d) => {
      const planned = plannedById.get(d.productId);
      const primaryGroupId = planned?.primaryGroupId ?? null;
      const division =
        primaryGroupId != null ? divisionByGroup.get(primaryGroupId) : null;
      return {
        productId: d.productId,
        productName: planned?.productName ?? `#${d.productId}`,
        quantity: d.quantity,
        unitId: d.unitId,
        primaryGroupId,
        divisionId: division?.id ?? null,
        divisionName: division?.name ?? null,
      };
    });

    const woIds = workOrders.map((w) => w.id);
    const plan = await this.withPlanNoRetry(companyId, (planNo) =>
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

  private async withPlanNoRetry<T>(
    companyId: number,
    fn: (planNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const planNo = await this.nextPlanNo(companyId, i);
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

  private async nextPlanNo(companyId: number, attempt: number): Promise<string> {
    return this.numbering.nextOrDefault(
      companyId,
      PRODUCTION_PLAN_DOCUMENT_CODE,
      { prefix: 'PP-', padding: 4 },
      undefined,
      attempt,
    );
  }
}
