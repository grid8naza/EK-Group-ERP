import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateWorkflowStatusDto,
  UpdateWorkflowStatusDto,
} from './workflow-status.dto';

/**
 * The document-status vocabulary (name + icon) super admins manage. Workflow
 * steps pick a status by name; the paired icon is shown in document listings.
 */
@Injectable()
export class WorkflowStatusService {
  constructor(private prisma: PrismaService) {}

  findAll(activeOnly = false) {
    return this.prisma.workflowStatus.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: number) {
    const row = await this.prisma.workflowStatus.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Status not found');
    return row;
  }

  create(dto: CreateWorkflowStatusDto) {
    return this.prisma.workflowStatus.create({
      data: {
        name: dto.name.trim(),
        icon: dto.icon?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateWorkflowStatusDto) {
    await this.findOne(id);
    return this.prisma.workflowStatus.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        icon: dto.icon !== undefined ? dto.icon?.trim() || null : undefined,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.workflowStatus.delete({ where: { id } });
    return { success: true };
  }
}
