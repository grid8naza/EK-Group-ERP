import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModuleDto, UpdateModuleDto } from './module-master.dto';

@Injectable()
export class ModuleMasterService {
  constructor(private prisma: PrismaService) {}

  // Attach the list of company ids a (non-core) module is enabled for.
  private withCompanyIds<T extends { companyModules?: { companyId: number }[] }>(
    m: T,
  ) {
    const { companyModules, ...rest } = m;
    return { ...rest, companyIds: (companyModules ?? []).map((c) => c.companyId) };
  }

  async findAll() {
    const modules = await this.prisma.module.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { companyModules: { select: { companyId: true } } },
    });
    return modules.map((m) => this.withCompanyIds(m));
  }

  async findOne(id: number) {
    const module = await this.prisma.module.findUnique({
      where: { id },
      include: { companyModules: { select: { companyId: true } } },
    });
    if (!module) throw new NotFoundException('Module not found');
    return this.withCompanyIds(module);
  }

  // Replace a module's company links. Core modules are universal, so they have
  // no per-company links.
  private async syncCompanies(
    moduleId: number,
    isCore: boolean,
    companyIds?: number[],
  ) {
    if (isCore) {
      await this.prisma.companyModule.deleteMany({ where: { moduleId } });
      return;
    }
    if (companyIds === undefined) return; // not provided => leave as-is
    const wanted = companyIds;
    await this.prisma.$transaction([
      this.prisma.companyModule.deleteMany({
        where: {
          moduleId,
          companyId: { notIn: wanted.length ? wanted : [-1] },
        },
      }),
      ...wanted.map((companyId, i) =>
        this.prisma.companyModule.upsert({
          where: { companyId_moduleId: { companyId, moduleId } },
          create: { companyId, moduleId, sortOrder: i + 1, isActive: true },
          update: { isActive: true },
        }),
      ),
    ]);
  }

  async create(dto: CreateModuleDto) {
    const { companyIds, ...data } = dto;
    const module = await this.prisma.module.create({ data });
    await this.syncCompanies(module.id, !!module.isCore, companyIds);
    return this.findOne(module.id);
  }

  async update(id: number, dto: UpdateModuleDto) {
    const existing = await this.findOne(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This module is locked. Unlock it before editing.',
      );
    }
    const { companyIds, ...data } = dto;
    const module = await this.prisma.module.update({ where: { id }, data });
    const isCore = module.isCore ?? existing.isCore;
    await this.syncCompanies(id, !!isCore, companyIds);
    return this.findOne(id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.module.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const module = await this.findOne(id);
    if (module.isLocked) {
      throw new ConflictException(
        'This module is locked. Unlock it before deleting.',
      );
    }
    if (module.isCore)
      throw new BadRequestException('Core modules cannot be removed');
    await this.prisma.module.delete({ where: { id } });
    return { success: true };
  }
}
