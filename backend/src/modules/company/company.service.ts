import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCompanyDto,
  SetCompanyModulesDto,
  UpdateCompanyDto,
} from './company.dto';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  findAll(search?: string) {
    return this.prisma.company.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  create(dto: CreateCompanyDto) {
    return this.prisma.company.create({ data: dto });
  }

  async update(id: number, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.company.delete({ where: { id } });
    return { success: true };
  }

  // ---- Per-company module enablement ----

  /**
   * Returns the whole module catalog annotated with whether each is enabled
   * for this company, so the cpanel can toggle modules per company.
   */
  async getModules(companyId: number) {
    await this.findOne(companyId);
    const [catalog, enabled] = await Promise.all([
      this.prisma.module.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.companyModule.findMany({ where: { companyId } }),
    ]);
    const map = new Map(enabled.map((e) => [e.moduleId, e]));
    return catalog.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      description: m.description,
      icon: m.icon,
      isCore: m.isCore,
      enabled: map.has(m.id) ? map.get(m.id)!.isActive : false,
      sortOrder: map.get(m.id)?.sortOrder ?? m.sortOrder,
    }));
  }

  /**
   * The active company's enabled modules (joined catalog), for dropdowns.
   * Core modules are universal, so they are always included regardless of the
   * per-company links.
   */
  async getEnabledModules(companyId: number) {
    const [rows, coreModules] = await Promise.all([
      this.prisma.companyModule.findMany({
        where: { companyId, isActive: true },
        include: { module: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.module.findMany({
        where: { isCore: true, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const userModules = rows.map((r) => r.module).filter((m) => !m.isCore);
    // Core first (universal), then the company's user modules.
    return [...coreModules, ...userModules].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
  }

  /** Replace the set of enabled modules for a company. */
  async setModules(companyId: number, dto: SetCompanyModulesDto) {
    await this.findOne(companyId);
    const wanted = dto.moduleIds;
    await this.prisma.$transaction([
      this.prisma.companyModule.deleteMany({
        where: { companyId, moduleId: { notIn: wanted.length ? wanted : [-1] } },
      }),
      ...wanted.map((moduleId, i) =>
        this.prisma.companyModule.upsert({
          where: { companyId_moduleId: { companyId, moduleId } },
          create: { companyId, moduleId, sortOrder: i + 1, isActive: true },
          update: { isActive: true, sortOrder: i + 1 },
        }),
      ),
    ]);
    return this.getModules(companyId);
  }
}
