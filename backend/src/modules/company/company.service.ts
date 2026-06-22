import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCompanyDto,
  SetCompanyModulesDto,
  UpdateCompanyDto,
} from './company.dto';
import { provisionCompanyCpanel } from './company-provisioning';

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

  async create(dto: CreateCompanyDto) {
    const company = await this.prisma.company.create({ data: dto });
    // Scaffold the Cpanel module (menus, gadgets, dashboards, admin group) so
    // a freshly created company is immediately usable.
    await provisionCompanyCpanel(this.prisma, company.id);
    return company;
  }

  async update(id: number, dto: UpdateCompanyDto) {
    const existing = await this.findOne(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This company is locked. Unlock it before editing.',
      );
    }
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.company.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This company is locked. Unlock it before deleting.',
      );
    }

    // Block deletion while active (non-super-admin) users still belong to the
    // company — deleting would silently drop their company membership. Super
    // admins are system-wide accounts (members of every company), so they are
    // not counted.
    const activeUsers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isSuperAdmin: false,
        companies: { some: { companyId: id } },
      },
      select: { name: true, username: true },
      orderBy: { name: 'asc' },
    });
    if (activeUsers.length > 0) {
      const MAX = 10;
      const shown = activeUsers
        .slice(0, MAX)
        .map((u) => `${u.name} (${u.username})`);
      const extra = activeUsers.length - shown.length;
      const list = shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
      throw new ConflictException(
        `Cannot delete this company — ${activeUsers.length} active user(s) still belong to it: ${list}. Deactivate or move them to another company first.`,
      );
    }

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
