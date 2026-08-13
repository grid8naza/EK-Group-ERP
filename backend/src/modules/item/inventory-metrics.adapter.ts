import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MetricDef,
  MetricProviderPort,
} from '../../contracts/metric-provider.port';

/**
 * The Inventory module's metric provider. Item / Category / Unit masters are
 * global reference data, so these are simple active-row counts. Registered in
 * contracts/contracts.module.ts.
 */
@Injectable()
export class InventoryMetricsAdapter implements MetricProviderPort {
  constructor(private readonly prisma: PrismaService) {}

  metrics(): MetricDef[] {
    const M = (
      key: string,
      label: string,
      compute: MetricDef['compute'],
    ): MetricDef => ({
      key,
      label,
      moduleCode: 'INVENTORY',
      compute,
    });

    return [
      M('inventory.items.total', 'Items', () =>
        this.prisma.item.count({ where: { isActive: true } }),
      ),
      M('inventory.categories.total', 'Categories', () =>
        this.prisma.category.count({ where: { isActive: true } }),
      ),
      M('inventory.units.total', 'Units', () =>
        this.prisma.unit.count({ where: { isActive: true } }),
      ),
      M('inventory.hsn.total', 'HSN Codes', () =>
        this.prisma.hsnCode.count({ where: { isActive: true } }),
      ),
    ];
  }
}
