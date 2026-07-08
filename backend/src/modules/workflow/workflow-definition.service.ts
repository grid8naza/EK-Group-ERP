import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateWorkflowDto,
  UpdateWorkflowDto,
  WorkflowStepInput,
} from './workflow.dto';

// A definition is returned with its ordered steps, each with its assigned users.
const withSteps = {
  steps: {
    orderBy: { sequence: 'asc' },
    include: { users: { select: { userId: true } } },
  },
} satisfies Prisma.WorkflowDefinitionInclude;

@Injectable()
export class WorkflowDefinitionService {
  constructor(private prisma: PrismaService) {}

  /** Definitions for the active company (optionally filtered by module/form). */
  async findAll(
    companyId: number | undefined,
    opts: { moduleId?: number; objectId?: number; search?: string } = {},
  ) {
    if (!companyId) return [];
    const rows = await this.prisma.workflowDefinition.findMany({
      where: {
        companyId,
        moduleId: opts.moduleId,
        objectId: opts.objectId,
        name: opts.search
          ? { contains: opts.search, mode: 'insensitive' }
          : undefined,
      },
      include: withSteps,
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.flatten(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    const def = await this.prisma.workflowDefinition.findUnique({
      where: { id },
      include: withSteps,
    });
    if (!def || (companyId && def.companyId !== companyId)) {
      throw new NotFoundException('Workflow not found');
    }
    return this.flatten(def);
  }

  async create(companyId: number | undefined, dto: CreateWorkflowDto) {
    // The origin company is the ACTIVE company (X-Company-Id). Reads (list +
    // post-save reload) are scoped to it, so honouring a different dto.companyId
    // would silently create a record the caller can't see. Prefer the header;
    // fall back to the body only when no active company is set.
    const cid = companyId ?? dto.companyId;
    if (!cid) throw new BadRequestException('A company is required.');
    this.assertStepsValid(dto.steps);
    const created = await this.prisma.workflowDefinition.create({
      data: {
        name: dto.name.trim(),
        companyId: cid,
        branchId: dto.branchId ?? null,
        moduleId: dto.moduleId,
        objectId: dto.objectId,
        isActive: dto.isActive ?? true,
        steps: { create: this.stepCreate(dto.steps) },
      },
      include: withSteps,
    });
    return this.flatten(created);
  }

  async update(companyId: number | undefined, id: number, dto: UpdateWorkflowDto) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'workflow', 'editing');
    if (dto.steps !== undefined) this.assertStepsValid(dto.steps);

    const updated = await this.prisma.workflowDefinition.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        branchId: dto.branchId !== undefined ? dto.branchId : undefined,
        isActive: dto.isActive,
        // Full-replace the step chain only when the caller sent one.
        ...(dto.steps !== undefined
          ? { steps: { deleteMany: {}, create: this.stepCreate(dto.steps) } }
          : {}),
      },
      include: withSteps,
    });
    return this.flatten(updated);
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.workflowDefinition.update({
      where: { id },
      data: { isLocked: locked },
      include: withSteps,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'workflow', 'deleting');
    await this.prisma.workflowDefinition.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private assertStepsValid(steps: WorkflowStepInput[] | undefined) {
    const list = steps ?? [];
    const seqs = list.map((s) => s.sequence);
    if (new Set(seqs).size !== seqs.length) {
      throw new BadRequestException('Step sequence numbers must be unique.');
    }
    for (const s of list) {
      if (s.approvalMode === 'FIELD') {
        if (!s.fieldName?.trim()) {
          throw new BadRequestException(
            'Field approval steps require a field name.',
          );
        }
        if (
          s.valueFrom != null &&
          s.valueTo != null &&
          s.valueFrom > s.valueTo
        ) {
          throw new BadRequestException(
            '"Value from" cannot be greater than "Value to".',
          );
        }
      }
      if (!s.userGroupId && !(s.userIds && s.userIds.length)) {
        throw new BadRequestException(
          `Step ${s.sequence}: choose a user group or at least one user.`,
        );
      }
    }
  }

  private stepCreate(
    steps: WorkflowStepInput[] | undefined,
  ): Prisma.WorkflowStepCreateWithoutDefinitionInput[] {
    return [...(steps ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        sequence: s.sequence,
        userGroupId: s.userGroupId ?? null,
        targetCompanyId: s.targetCompanyId ?? null,
        targetBranchId: s.targetBranchId ?? null,
        targetModuleId: s.targetModuleId ?? null,
        action: s.action,
        buttonText: s.buttonText.trim(),
        approvalMode: s.approvalMode ?? 'FORM',
        fieldName: s.fieldName?.trim() || null,
        valueFrom: s.valueFrom ?? null,
        valueTo: s.valueTo ?? null,
        canCancel: s.canCancel ?? false,
        canReject: s.canReject ?? false,
        canEdit: s.canEdit ?? false,
        notifyInApp: s.notifyInApp ?? true,
        slaHours: s.slaHours ?? null,
        users: {
          create: Array.from(new Set(s.userIds ?? [])).map((userId) => ({
            userId,
          })),
        },
      }));
  }

  /** Flatten each step's `users` join rows to a plain `userIds` array. */
  private flatten<
    T extends { steps: { users: { userId: number }[] }[] },
  >(def: T) {
    return {
      ...def,
      steps: def.steps.map((s) => {
        const { users, ...rest } = s;
        return { ...rest, userIds: users.map((u) => u.userId) };
      }),
    };
  }
}
