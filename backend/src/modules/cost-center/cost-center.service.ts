import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateCostCenterDto, UpdateCostCenterDto } from './cost-center.dto';

@Injectable()
export class CostCenterService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId?: number) {
    return this.prisma.costCenter.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const costCenter = await this.prisma.costCenter.findUnique({
      where: { id },
    });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    return costCenter;
  }

  async create(dto: CreateCostCenterDto) {
    // Cost centers may only be created for companies that opted into them.
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { costCenterApplicable: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    if (!company.costCenterApplicable) {
      throw new ConflictException(
        'This company is not cost-center-applicable. Enable "Cost Center Applicable" on the company first.',
      );
    }
    return this.prisma.costCenter.create({ data: dto });
  }

  async update(id: number, dto: UpdateCostCenterDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'cost center', 'editing');
    return this.prisma.costCenter.update({ where: { id }, data: dto });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.costCenter.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'cost center', 'deleting');

    // Block deletion while cost objects still live under this cost center,
    // rather than silently cascade-deleting them.
    const count = await this.prisma.costObject.count({
      where: { costCenterId: id },
    });
    if (count > 0) {
      throw new ConflictException(
        `Cannot delete this cost center — ${count} cost object(s) still belong to it. Delete them first.`,
      );
    }

    await this.prisma.costCenter.delete({ where: { id } });
    return { success: true };
  }
}
