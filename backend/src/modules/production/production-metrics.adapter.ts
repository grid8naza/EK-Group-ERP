import { Injectable } from '@nestjs/common';
import { ProductionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MetricContext,
  MetricDef,
  MetricProviderPort,
} from '../../contracts/metric-provider.port';

/**
 * The Production module's metric provider. Every metric is company-scoped
 * (ProductionOrder carries a plain `companyId`) and reads only this module's
 * own table. Registered in contracts/contracts.module.ts.
 */
@Injectable()
export class ProductionMetricsAdapter implements MetricProviderPort {
  constructor(private readonly prisma: PrismaService) {}

  private countByStatus(status: ProductionStatus) {
    return (ctx: MetricContext) =>
      this.prisma.productionOrder.count({
        where: { companyId: ctx.companyId, status },
      });
  }

  metrics(): MetricDef[] {
    const M = (key: string, label: string, rest: Partial<MetricDef>): MetricDef => ({
      key,
      label,
      moduleCode: 'PRODUCTION',
      compute: async () => 0,
      ...rest,
    });

    return [
      M('production.orders.planned', 'Planned Orders', {
        compute: this.countByStatus(ProductionStatus.PLANNED),
      }),
      M('production.orders.inProgress', 'In-Progress Orders', {
        compute: this.countByStatus(ProductionStatus.IN_PROGRESS),
      }),
      M('production.orders.completed', 'Completed Orders', {
        compute: this.countByStatus(ProductionStatus.COMPLETED),
      }),
      M('production.orders.cancelled', 'Cancelled Orders', {
        compute: this.countByStatus(ProductionStatus.CANCELLED),
      }),
      M('production.orders.total', 'Total Orders', {
        compute: (ctx) =>
          this.prisma.productionOrder.count({
            where: { companyId: ctx.companyId },
          }),
      }),
      M('production.qty.planned', 'Planned Quantity', {
        compute: async (ctx) => {
          const r = await this.prisma.productionOrder.aggregate({
            _sum: { quantity: true },
            where: { companyId: ctx.companyId, status: ProductionStatus.PLANNED },
          });
          return r._sum.quantity ?? 0;
        },
      }),
      // Calculated metric: completed orders as a percentage of all orders.
      M('production.orders.completionRate', 'Completion %', {
        format: 'percent',
        compute: async (ctx) => {
          const [completed, total] = await Promise.all([
            this.prisma.productionOrder.count({
              where: { companyId: ctx.companyId, status: ProductionStatus.COMPLETED },
            }),
            this.prisma.productionOrder.count({
              where: { companyId: ctx.companyId },
            }),
          ]);
          return total ? Math.round((completed / total) * 100) : 0;
        },
      }),
    ];
  }
}
