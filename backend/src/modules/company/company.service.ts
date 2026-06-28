import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { extname, join } from 'path';
import { rename as renameFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCompanyDto,
  SetCompanyModulesDto,
  UpdateCompanyDto,
} from './company.dto';
import { provisionCompanyCpanel } from './company-provisioning';
import { assertUnlocked } from '../../common/assert-unlocked';
import { COMPANY_UPLOAD_DIR, COMPANY_URL_PREFIX } from './company.constants';

/** Minimal multer file shape (avoids needing @types/multer). */
interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  /** Store an uploaded logo and return its served URL (used by create/update). */
  async uploadLogo(file: UploadedFile): Promise<{ url: string }> {
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    };
    const ext = extname(file.originalname) || extMap[file.mimetype] || '';
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await renameFile(file.path, join(COMPANY_UPLOAD_DIR, name));
    return { url: `${COMPANY_URL_PREFIX}/${name}` };
  }

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
    // Create + scaffold atomically: if provisioning fails partway, the company
    // insert rolls back instead of leaving a half-provisioned company behind.
    const { booksStartDate, ...rest } = dto;
    return this.prisma.$transaction(
      async (tx) => {
        const company = await tx.company.create({
          data: {
            ...rest,
            booksStartDate: booksStartDate
              ? new Date(booksStartDate)
              : undefined,
          },
        });
        // Scaffold the Cpanel module (menus, admin group) so a freshly created
        // company is immediately usable.
        await provisionCompanyCpanel(tx, company.id);
        return company;
      },
      { timeout: 20000 },
    );
  }

  async update(id: number, dto: UpdateCompanyDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'company', 'editing');

    // Don't let a company be marked non-branch-applicable while branches still
    // exist — that would orphan them (and the users' branch access).
    if (dto.branchApplicable === false && existing.branchApplicable) {
      const count = await this.prisma.branch.count({ where: { companyId: id } });
      if (count > 0) {
        throw new ConflictException(
          `Cannot disable branches — this company still has ${count} branch(es). Delete them first.`,
        );
      }
    }

    // Cost center / cost object rules. Cost objects live under cost centers, so
    // "cost object applicable" can only be on when "cost center applicable" is.
    const effCostCenter =
      dto.costCenterApplicable ?? existing.costCenterApplicable;
    let effCostObject =
      dto.costObjectApplicable ?? existing.costObjectApplicable;
    if (!effCostCenter && effCostObject) {
      if (dto.costObjectApplicable === true) {
        throw new ConflictException(
          'Cost Object Applicable requires Cost Center Applicable.',
        );
      }
      // Turning cost center off implicitly turns cost objects off.
      effCostObject = false;
    }
    // Block disabling cost centers while any still exist (objects live under
    // them, so this also covers the cost-object case).
    if (dto.costCenterApplicable === false && existing.costCenterApplicable) {
      const count = await this.prisma.costCenter.count({
        where: { companyId: id },
      });
      if (count > 0) {
        throw new ConflictException(
          `Cannot disable cost centers — this company still has ${count} cost center(s). Delete them first.`,
        );
      }
    }
    // Block disabling cost objects while any still exist.
    if (!effCostObject && existing.costObjectApplicable) {
      const count = await this.prisma.costObject.count({
        where: { companyId: id },
      });
      if (count > 0) {
        throw new ConflictException(
          `Cannot disable cost objects — this company still has ${count} cost object(s). Delete them first.`,
        );
      }
    }

    const { booksStartDate, ...rest } = dto;
    return this.prisma.company.update({
      where: { id },
      data: {
        ...rest,
        // Persist the (possibly coerced) cost-object flag.
        costObjectApplicable: effCostObject,
        ...(booksStartDate !== undefined
          ? { booksStartDate: booksStartDate ? new Date(booksStartDate) : null }
          : {}),
      },
    });
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
    assertUnlocked(existing, 'company', 'deleting');

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
