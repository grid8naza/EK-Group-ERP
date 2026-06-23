import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_LOOKUP,
  UserLookupPort,
} from '../../contracts/user-lookup.port';
import {
  CreateProductionOrderDto,
  UpdateProductionOrderDto,
} from './production.dto';

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    // Cross-module dependency: the User (Cpanel) module is reached ONLY through
    // its port — no import of src/modules/user anywhere in this module.
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  findAll(companyId: number, search?: string) {
    return this.prisma.productionOrder.findMany({
      where: {
        companyId,
        ...(search
          ? {
              OR: [
                { orderNo: { contains: search, mode: 'insensitive' } },
                { productName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: number, id: number) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id, companyId },
    });
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  async create(companyId: number, dto: CreateProductionOrderDto) {
    await this.validateAssignedUser(companyId, dto.assignedUserId);
    const orderNo = dto.orderNo?.trim() || (await this.nextOrderNo(companyId));
    try {
      return await this.prisma.productionOrder.create({
        data: {
          companyId,
          orderNo,
          productName: dto.productName,
          quantity: dto.quantity,
          unit: dto.unit,
          status: dto.status,
          plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
          completedDate: dto.completedDate
            ? new Date(dto.completedDate)
            : undefined,
          assignedUserId: dto.assignedUserId,
          remarks: dto.remarks,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, orderNo);
    }
  }

  async update(companyId: number, id: number, dto: UpdateProductionOrderDto) {
    const existing = await this.findOne(companyId, id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This production order is locked. Unlock it before editing.',
      );
    }
    if (dto.assignedUserId !== undefined) {
      await this.validateAssignedUser(companyId, dto.assignedUserId);
    }
    try {
      return await this.prisma.productionOrder.update({
        where: { id },
        data: {
          orderNo: dto.orderNo?.trim(),
          productName: dto.productName,
          quantity: dto.quantity,
          unit: dto.unit,
          status: dto.status,
          plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
          completedDate: dto.completedDate
            ? new Date(dto.completedDate)
            : undefined,
          assignedUserId: dto.assignedUserId,
          remarks: dto.remarks,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, dto.orderNo);
    }
  }

  async setLock(companyId: number, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    return this.prisma.productionOrder.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(companyId: number, id: number) {
    const existing = await this.findOne(companyId, id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This production order is locked. Unlock it before deleting.',
      );
    }
    await this.prisma.productionOrder.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  // Validate the assignee through the User module's port, WITHOUT importing it.
  private async validateAssignedUser(companyId: number, userId?: number | null) {
    if (userId == null) return;
    const ok = await this.users.canAccessCompany(userId, companyId);
    if (!ok) {
      throw new BadRequestException(
        'Assigned user does not exist or cannot access this company.',
      );
    }
  }

  private async nextOrderNo(companyId: number) {
    const count = await this.prisma.productionOrder.count({
      where: { companyId },
    });
    return `PO-${String(count + 1).padStart(4, '0')}`;
  }

  private asDuplicate(e: unknown, orderNo?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(
        `Production order "${orderNo}" already exists for this company.`,
      );
    }
    return e;
  }
}
