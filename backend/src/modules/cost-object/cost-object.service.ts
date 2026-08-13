import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateCostObjectDto, UpdateCostObjectDto } from './cost-object.dto';

@Injectable()
export class CostObjectService {
  constructor(private prisma: PrismaService) {}

  findAll(costCenterId?: number, companyId?: number) {
    return this.prisma.costObject.findMany({
      where: {
        ...(costCenterId ? { costCenterId } : {}),
        ...(companyId ? { companyId } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const costObject = await this.prisma.costObject.findUnique({
      where: { id },
    });
    if (!costObject) throw new NotFoundException('Cost object not found');
    return costObject;
  }

  async create(dto: CreateCostObjectDto) {
    // The cost object inherits its company from the parent cost center, whose
    // company must be cost-object-applicable.
    const costCenter = await this.prisma.costCenter.findUnique({
      where: { id: dto.costCenterId },
      select: {
        companyId: true,
        company: { select: { costObjectApplicable: true } },
      },
    });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    if (!costCenter.company.costObjectApplicable) {
      throw new ConflictException(
        'This company is not cost-object-applicable. Enable "Cost Object Applicable" on the company first.',
      );
    }
    await this.assertCategory(dto.categoryCode);

    const { costCenterId, categoryCode, ...rest } = dto;
    return this.prisma.costObject.create({
      data: {
        ...rest,
        costCenterId,
        companyId: costCenter.companyId,
        categoryCode: categoryCode?.trim() || null,
      },
    });
  }

  async update(id: number, dto: UpdateCostObjectDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'cost object', 'editing');
    await this.assertCategory(dto.categoryCode);
    return this.prisma.costObject.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.categoryCode !== undefined
          ? { categoryCode: dto.categoryCode?.trim() || null }
          : {}),
      },
    });
  }

  /**
   * The kind of department this is, checked against the category master rather
   * than taken as free text — cost per meal, contribution per counter and
   * running cost per vehicle are grouped by this code, and a typo would quietly
   * open a second bucket. Read directly by code with no foreign key, per the
   * cross-domain rule.
   */
  private async assertCategory(code?: string | null): Promise<void> {
    const value = code?.trim();
    if (!value) return;
    const category = await this.prisma.costCentreCategory.findUnique({
      where: { code: value },
    });
    if (!category?.isActive) {
      throw new BadRequestException(
        `"${value}" is not an active cost-centre category.`,
      );
    }
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.costObject.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'cost object', 'deleting');
    await this.prisma.costObject.delete({ where: { id } });
    return { success: true };
  }
}
