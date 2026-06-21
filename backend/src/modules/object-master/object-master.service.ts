import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObjectType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateObjectDto,
  CreateObjectRevisionDto,
  UpdateObjectDto,
} from './object-master.dto';

interface FindAllParams {
  search?: string;
  moduleId?: number;
  objectType?: ObjectType;
  // System objects are visible only to super admins.
  includeSystem?: boolean;
  // Optional System/User filter (only honoured for super admins).
  isSystem?: boolean;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ObjectMasterService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: FindAllParams) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize =
      params.pageSize && params.pageSize > 0 ? params.pageSize : 15;

    // Objects are global (not company-scoped): the list shows every object.
    // System objects are hidden from non-super-admins.
    const visibility: Prisma.ObjectMasterWhereInput = params.includeSystem
      ? {}
      : { isSystem: false };

    const where: Prisma.ObjectMasterWhereInput = { ...visibility };
    if (params.moduleId) where.moduleId = params.moduleId;
    if (params.objectType) where.objectType = params.objectType;
    // The System/User filter only applies to super admins; for everyone else
    // visibility already pins isSystem=false, so it can never widen access.
    if (params.includeSystem && params.isSystem !== undefined) {
      where.isSystem = params.isSystem;
    }
    if (params.search) {
      where.OR = [
        { objectName: { contains: params.search, mode: 'insensitive' } },
        { nameInMenu: { contains: params.search, mode: 'insensitive' } },
        { author: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    // Stat-card counts respect the same visibility (but ignore the active filters).
    const countWhere = (objectType: ObjectType) => ({
      ...visibility,
      objectType,
    });
    const [data, total, forms, reports, tables, dashboards] = await Promise.all([
      this.prisma.objectMaster.findMany({
        where,
        include: { module: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.objectMaster.count({ where }),
      this.prisma.objectMaster.count({ where: countWhere('FORM') }),
      this.prisma.objectMaster.count({ where: countWhere('REPORT') }),
      this.prisma.objectMaster.count({ where: countWhere('TABLE') }),
      this.prisma.objectMaster.count({ where: countWhere('DASHBOARD') }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      counts: { forms, reports, tables, dashboards },
    };
  }

  async findOne(id: number) {
    const object = await this.prisma.objectMaster.findUnique({
      where: { id },
      include: {
        module: true,
        revisions: { orderBy: { dateRevised: 'desc' } },
      },
    });
    if (!object) throw new NotFoundException('Object not found');
    return object;
  }

  create(dto: CreateObjectDto) {
    // System objects start locked so they can't be edited/deleted by accident.
    return this.prisma.objectMaster.create({
      data: { ...dto, isLocked: !!dto.isSystem },
    });
  }

  async update(id: number, dto: UpdateObjectDto) {
    const existing = await this.ensureObject(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This object is locked. Unlock it before editing.',
      );
    }
    return this.prisma.objectMaster.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const existing = await this.ensureObject(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This object is locked. Unlock it before deleting.',
      );
    }
    await this.prisma.objectMaster.delete({ where: { id } });
    return { success: true };
  }

  /** Lock or unlock an object (the only way to clear a lock). */
  async setLock(id: number, locked: boolean) {
    await this.ensureObject(id);
    return this.prisma.objectMaster.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async findRevisions(objectId: number) {
    await this.ensureObject(objectId);
    return this.prisma.objectRevision.findMany({
      where: { objectId },
      orderBy: { dateRevised: 'desc' },
    });
  }

  async createRevision(objectId: number, dto: CreateObjectRevisionDto) {
    await this.ensureObject(objectId);
    return this.prisma.objectRevision.create({
      data: { ...dto, objectId },
    });
  }

  private async ensureObject(id: number) {
    const object = await this.prisma.objectMaster.findUnique({ where: { id } });
    if (!object) throw new NotFoundException('Object not found');
    return object;
  }
}
