import { Injectable, NotFoundException } from '@nestjs/common';
import { ObjectType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateObjectDto,
  CreateObjectRevisionDto,
  UpdateObjectDto,
} from './object-master.dto';

interface FindAllParams {
  companyId: number;
  search?: string;
  moduleId?: number;
  objectType?: ObjectType;
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

    const where: Prisma.ObjectMasterWhereInput = { companyId: params.companyId };
    if (params.moduleId) where.moduleId = params.moduleId;
    if (params.objectType) where.objectType = params.objectType;
    if (params.search) {
      where.OR = [
        { objectName: { contains: params.search, mode: 'insensitive' } },
        { nameInMenu: { contains: params.search, mode: 'insensitive' } },
        { author: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const company = params.companyId;
    const [data, total, forms, reports, tables, dashboards] = await Promise.all([
      this.prisma.objectMaster.findMany({
        where,
        include: { module: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.objectMaster.count({ where }),
      this.prisma.objectMaster.count({ where: { companyId: company, objectType: 'FORM' } }),
      this.prisma.objectMaster.count({ where: { companyId: company, objectType: 'REPORT' } }),
      this.prisma.objectMaster.count({ where: { companyId: company, objectType: 'TABLE' } }),
      this.prisma.objectMaster.count({ where: { companyId: company, objectType: 'DASHBOARD' } }),
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

  create(dto: CreateObjectDto, companyId: number) {
    return this.prisma.objectMaster.create({ data: { ...dto, companyId } });
  }

  async update(id: number, dto: UpdateObjectDto) {
    await this.ensureObject(id);
    return this.prisma.objectMaster.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.ensureObject(id);
    await this.prisma.objectMaster.delete({ where: { id } });
    return { success: true };
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
