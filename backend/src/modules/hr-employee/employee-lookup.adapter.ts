import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EmployeeLookupPort,
  EmployeeSummary,
} from '../../contracts/employee-lookup.port';

/**
 * The HR module's in-process implementation of EmployeeLookupPort.
 *
 * It talks only to its own table via Prisma and returns the small
 * EmployeeSummary shape — never a Prisma entity. Allowed imports here: prisma
 * (shared) + contracts (the port). It must NOT import any other feature module —
 * `npm run lint:boundaries` enforces that.
 */
@Injectable()
export class EmployeeLookupAdapter implements EmployeeLookupPort {
  constructor(private readonly prisma: PrismaService) {}

  private readonly summarySelect = {
    id: true,
    code: true,
    name: true,
    email: true,
    phone: true,
    companyId: true,
    branchId: true,
    isActive: true,
  } as const;

  findById(id: number): Promise<EmployeeSummary | null> {
    return this.prisma.employee.findUnique({
      where: { id },
      select: this.summarySelect,
    });
  }

  findByIds(ids: number[]): Promise<EmployeeSummary[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: this.summarySelect,
    });
  }
}
