import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateWidgetDto, UpdateWidgetDto } from './widget.dto';

@Injectable()
export class WidgetService {
  constructor(private prisma: PrismaService) {}

  /**
   * Core modules (e.g. Cpanel) are global, like ObjectMaster: their widgets
   * aren't company-scoped (companyId = null). User modules stay company-scoped.
   * Returns the companyId to store/query, or null for global.
   */
  private async scopedCompany(moduleId: number, companyId: number) {
    const m = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { isCore: true },
    });
    return m?.isCore ? null : companyId;
  }

  async findAll(companyId: number, moduleId?: number) {
    const scoped = moduleId
      ? await this.scopedCompany(moduleId, companyId)
      : companyId;
    return this.prisma.widget.findMany({
      where: { companyId: scoped, ...(moduleId ? { moduleId } : {}) },
      include: {
        module: { select: { id: true, name: true, code: true } },
        _count: { select: { placements: true } },
      },
      orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async create(dto: CreateWidgetDto, companyId: number) {
    const { code, ...rest } = dto;
    const scoped = await this.scopedCompany(dto.moduleId, companyId);
    const finalCode = await this.uniqueCode(
      scoped,
      dto.moduleId,
      code || dto.name,
    );
    return this.prisma.widget.create({
      data: {
        ...rest,
        companyId: scoped,
        code: finalCode,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: number, dto: UpdateWidgetDto) {
    const existing = await this.ensure(id);
    assertUnlocked(existing, 'widget', 'editing');
    const { code, config, ...rest } = dto;
    return this.prisma.widget.update({
      where: { id },
      data: {
        ...rest,
        ...(config !== undefined
          ? { config: config as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.ensure(id);
    return this.prisma.widget.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.ensure(id);
    assertUnlocked(existing, 'widget', 'deleting');
    await this.prisma.widget.delete({ where: { id } });
    return { success: true };
  }

  private async ensure(id: number) {
    const w = await this.prisma.widget.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Widget not found');
    return w;
  }

  // Build a unique code per (company, module) from a name/base string.
  // companyId is null for global (core-module) widgets — uniqueness is then
  // enforced per module across the global set.
  private async uniqueCode(
    companyId: number | null,
    moduleId: number,
    base: string,
  ) {
    const slug =
      base
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'WIDGET';
    let candidate = slug;
    let n = 1;
    // Loop until the code is free for this company+module.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await this.prisma.widget.findFirst({
        where: { companyId, moduleId, code: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
      n += 1;
      candidate = `${slug}_${n}`;
    }
  }
}
