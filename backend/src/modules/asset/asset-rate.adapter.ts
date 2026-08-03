import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetRatePort } from '../../contracts/asset-rate.port';

/**
 * The Asset module's in-process implementation of AssetRatePort — lets product
 * costing read a machine's running rate WITHOUT importing this module. Bound to
 * the ASSET_RATE token in contracts.module.ts.
 */
@Injectable()
export class AssetRateAdapter implements AssetRatePort {
  constructor(private readonly prisma: PrismaService) {}

  async costPerHourFor(assetIds: number[]): Promise<Map<number, number>> {
    const ids = [...new Set(assetIds)].filter((id) => Number.isFinite(id));
    if (!ids.length) return new Map();
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, costPerHour: true },
    });
    return new Map(rows.map((r) => [r.id, r.costPerHour ?? 0]));
  }
}
