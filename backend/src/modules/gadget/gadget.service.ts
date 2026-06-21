import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGadgetDto, UpdateGadgetDto } from './gadget.dto';

@Injectable()
export class GadgetService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: number, moduleId?: number) {
    return this.prisma.gadget.findMany({
      where: { companyId, ...(moduleId ? { moduleId } : {}) },
      include: {
        module: { select: { id: true, name: true, code: true } },
        _count: { select: { placements: true } },
      },
      orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async create(dto: CreateGadgetDto, companyId: number) {
    const { code, ...rest } = dto;
    const finalCode = await this.uniqueCode(
      companyId,
      dto.moduleId,
      code || dto.name,
    );
    return this.prisma.gadget.create({
      data: {
        ...rest,
        companyId,
        code: finalCode,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: number, dto: UpdateGadgetDto) {
    await this.ensure(id);
    const { code, config, ...rest } = dto;
    return this.prisma.gadget.update({
      where: { id },
      data: {
        ...rest,
        ...(config !== undefined
          ? { config: config as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async remove(id: number) {
    await this.ensure(id);
    await this.prisma.gadget.delete({ where: { id } });
    return { success: true };
  }

  private async ensure(id: number) {
    const g = await this.prisma.gadget.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Gadget not found');
    return g;
  }

  // Build a unique code per (company, module) from a name/base string.
  private async uniqueCode(companyId: number, moduleId: number, base: string) {
    const slug =
      base
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'GADGET';
    let candidate = slug;
    let n = 1;
    // Loop until the code is free for this company+module.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await this.prisma.gadget.findFirst({
        where: { companyId, moduleId, code: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
      n += 1;
      candidate = `${slug}_${n}`;
    }
  }
}
