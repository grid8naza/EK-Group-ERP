import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LabourRatePort } from '../../contracts/labour-rate.port';

/**
 * The HR Designation module's in-process implementation of LabourRatePort —
 * lets product costing read a designation's hourly rate WITHOUT importing this
 * module. Bound to the LABOUR_RATE token in contracts.module.ts.
 */
@Injectable()
export class LabourRateAdapter implements LabourRatePort {
  constructor(private readonly prisma: PrismaService) {}

  async ratePerHourFor(designationIds: number[]): Promise<Map<number, number>> {
    const ids = [...new Set(designationIds)].filter((id) => Number.isFinite(id));
    if (!ids.length) return new Map();
    const rows = await this.prisma.hrDesignation.findMany({
      where: { id: { in: ids } },
      select: { id: true, ratePerHour: true },
    });
    return new Map(rows.map((r) => [r.id, r.ratePerHour ?? 0]));
  }
}
