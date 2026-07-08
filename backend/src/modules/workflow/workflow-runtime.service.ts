import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkflowActionType,
  WorkflowInstance,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_LOOKUP, UserLookupPort } from '../../contracts/user-lookup.port';
import {
  DocumentRef,
  StartWorkflowInput,
  WorkflowDocState,
  WorkflowFirstStep,
  WorkflowStatus,
  WorkflowViewerTask,
} from '../../contracts/workflow.port';
import { ActOnTaskDto, StartWorkflowDto } from './workflow.dto';

// Actions whose level ENDS the workflow when approved (no onward routing).
const TERMINAL_ACTIONS: WorkflowActionType[] = [
  'APPROVE',
  'CREATE_APPROVE',
  'REFERENCE',
];

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  /**
   * Start an approval for a document. Auto-matches an active WorkflowDefinition
   * for (company, module, form), preferring a branch-specific one, then raises
   * the first level's tasks. Returns the instance (or null if no workflow is
   * configured — the caller may then treat the document as auto-approved).
   */
  async start(startedByUserId: number, dto: StartWorkflowDto) {
    const def = await this.matchDefinition(dto);
    if (!def) return null;

    const instance = await this.prisma.workflowInstance.create({
      data: {
        definitionId: def.id,
        companyId: dto.companyId,
        branchId: dto.branchId ?? def.branchId ?? null,
        moduleId: dto.moduleId,
        objectId: dto.objectId,
        documentId: dto.documentId,
        documentRef: dto.documentRef?.trim() || null,
        amount: dto.amount ?? null,
        currentSequence: 0,
        startedByUserId,
      },
    });
    await this.log(instance.id, null, 0, startedByUserId, 'CREATE');
    await this.activateNext(instance, null);
    return this.getInstance(instance.id);
  }

  /** Cancel any in-progress workflow(s) attached to a document. */
  async cancelForDocument(
    moduleId: number,
    objectId: number,
    documentId: number,
  ): Promise<void> {
    const instances = await this.prisma.workflowInstance.findMany({
      where: { moduleId, objectId, documentId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    for (const inst of instances) {
      await this.prisma.workflowTask.updateMany({
        where: { instanceId: inst.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await this.finish(inst.id, 'CANCELLED');
    }
  }

  /** Pending tasks assigned to a user, enriched for the inbox. */
  async myTasks(userId: number) {
    const tasks = await this.prisma.workflowTask.findMany({
      where: { assignedUserId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { instance: true },
    });
    const stepIds = tasks.map((t) => t.stepId);
    const steps = await this.prisma.workflowStep.findMany({
      where: { id: { in: stepIds } },
    });
    const stepById = new Map(steps.map((s) => [s.id, s]));
    const defIds = [...new Set(tasks.map((t) => t.instance.definitionId))];
    const defs = await this.prisma.workflowDefinition.findMany({
      where: { id: { in: defIds } },
      select: { id: true, name: true },
    });
    const defName = new Map(defs.map((d) => [d.id, d.name]));

    return tasks.map((t) => {
      const step = stepById.get(t.stepId);
      return {
        taskId: t.id,
        instanceId: t.instanceId,
        sequence: t.sequence,
        canApprove: t.canApprove,
        createdAt: t.createdAt,
        workflowName: defName.get(t.instance.definitionId) ?? '',
        documentRef: t.instance.documentRef,
        documentId: t.instance.documentId,
        moduleId: t.instance.moduleId,
        objectId: t.instance.objectId,
        amount: t.instance.amount,
        action: step?.action,
        buttonText: step?.buttonText ?? 'Approve',
        canCancel: step?.canCancel ?? false,
        canReject: step?.canReject ?? false,
        canEdit: step?.canEdit ?? false,
      };
    });
  }

  /** Instance detail + resolved timeline for the drawer. */
  async getInstance(id: number) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { id: 'asc' } },
        actions: { orderBy: { id: 'asc' } },
      },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');

    const userIds = [
      ...new Set([
        instance.startedByUserId,
        ...instance.tasks.map((t) => t.assignedUserId),
        ...instance.actions.map((a) => a.userId),
      ]),
    ];
    const summaries = await this.users.findByIds(userIds);
    const nameById = new Map(summaries.map((u) => [u.id, u.name]));
    const name = (uid: number) => nameById.get(uid) ?? `User #${uid}`;

    return {
      ...instance,
      startedByName: name(instance.startedByUserId),
      timeline: instance.actions.map((a) => ({
        id: a.id,
        sequence: a.sequence,
        action: a.action,
        comment: a.comment,
        userId: a.userId,
        userName: name(a.userId),
        createdAt: a.createdAt,
      })),
      tasks: instance.tasks.map((t) => ({
        ...t,
        assignedName: name(t.assignedUserId),
      })),
    };
  }

  /** Act on a task: approve / forward / reject / cancel / reference. */
  async act(userId: number, taskId: number, dto: ActOnTaskDto) {
    const task = await this.prisma.workflowTask.findUnique({
      where: { id: taskId },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assignedUserId !== userId) {
      throw new ForbiddenException('This task is not assigned to you.');
    }
    if (task.status !== 'PENDING') {
      throw new BadRequestException('This task has already been actioned.');
    }
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: task.instanceId },
    });
    if (!instance || instance.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This workflow is no longer active.');
    }
    const step = await this.prisma.workflowStep.findUnique({
      where: { id: task.stepId },
    });
    if (!step) throw new NotFoundException('Workflow step not found');

    // --- terminal actions: reject / cancel ---
    if (dto.action === 'REJECT') {
      if (!step.canReject) {
        throw new ForbiddenException('Reject is not allowed at this step.');
      }
      if (!dto.comment?.trim()) {
        throw new BadRequestException('A reason is required to reject.');
      }
      await this.completeTask(task.id);
      await this.skipSiblings(instance.id, task.sequence);
      await this.log(instance.id, step.id, task.sequence, userId, 'REJECT', dto.comment);
      await this.finish(instance.id, 'REJECTED');
      await this.notify(
        instance.startedByUserId,
        instance.id,
        null,
        'Document rejected',
        `${instance.documentRef ?? 'Document'} was rejected.`,
      );
      return this.getInstance(instance.id);
    }
    if (dto.action === 'CANCEL') {
      if (!step.canCancel) {
        throw new ForbiddenException('Cancel is not allowed at this step.');
      }
      await this.completeTask(task.id);
      await this.skipSiblings(instance.id, task.sequence);
      await this.log(instance.id, step.id, task.sequence, userId, 'CANCEL', dto.comment);
      await this.finish(instance.id, 'CANCELLED');
      return this.getInstance(instance.id);
    }

    // --- positive progression: approve / forward / reference ---
    const forwards =
      step.action === 'CREATE_FORWARD' ||
      step.action === 'APPROVE_FORWARD' ||
      step.action === 'REVIEW_FORWARD' ||
      step.action === 'CREATE_REFERENCE';
    // Field-limit rule: a value beyond the step's limit cannot be approved here —
    // it must be reviewed and forwarded to the next level.
    const mustForward = !task.canApprove;
    const advance = forwards || mustForward;
    const loggedAction = mustForward
      ? 'REVIEW_FORWARD'
      : advance
        ? 'FORWARD'
        : 'APPROVE';

    await this.completeTask(task.id);
    await this.skipSiblings(instance.id, task.sequence);
    await this.log(instance.id, step.id, task.sequence, userId, loggedAction, dto.comment);

    if (advance && !TERMINAL_ACTIONS.includes(step.action)) {
      await this.activateNext(instance, task.sequence);
    } else if (advance && mustForward) {
      // Terminal step but value beyond limit → still forward for higher approval.
      await this.activateNext(instance, task.sequence);
    } else {
      await this.finish(instance.id, 'APPROVED');
    }
    return this.getInstance(instance.id);
  }

  async notifications(userId: number) {
    return this.prisma.workflowNotification.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: number, id: number) {
    await this.prisma.workflowNotification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    return { success: true };
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.workflowNotification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  // --- document integration (WorkflowPort) ---

  /**
   * Submit a freshly-created document AS its creator: start the instance, then —
   * when the creator is the first level's approver (step 1 = the creator's own
   * CREATE_FORWARD level) — immediately act on that task so it lands at level 2.
   * If the creator isn't a first-level approver, the workflow simply waits at
   * level 1 for whoever is.
   */
  async submitAsCreator(
    input: StartWorkflowInput,
  ): Promise<{ instanceId: number; status: WorkflowStatus } | null> {
    const instance = await this.start(input.startedByUserId, {
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      moduleId: input.moduleId,
      objectId: input.objectId,
      documentId: input.documentId,
      documentRef: input.documentRef,
      amount: input.amount,
    });
    if (!instance) return null;

    let status = instance.status as WorkflowStatus;
    const myTask = instance.tasks.find(
      (t) => t.assignedUserId === input.startedByUserId && t.status === 'PENDING',
    );
    if (myTask) {
      const after = await this.act(input.startedByUserId, myTask.id, {
        action: 'FORWARD',
      });
      status = after.status as WorkflowStatus;
    }
    return { instanceId: instance.id, status };
  }

  /** Act on the current user's pending task for a document. */
  async actOnDocument(
    userId: number,
    ref: DocumentRef,
    action: ActOnTaskDto['action'],
    comment?: string,
  ): Promise<{ status: WorkflowStatus }> {
    const instance = await this.currentInstance(ref);
    if (!instance || instance.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This document has no active workflow.');
    }
    const task = await this.prisma.workflowTask.findFirst({
      where: {
        instanceId: instance.id,
        assignedUserId: userId,
        status: 'PENDING',
      },
    });
    if (!task) {
      throw new ForbiddenException('You have no pending action on this document.');
    }
    const after = await this.act(userId, task.id, { action, comment });
    return { status: after.status as WorkflowStatus };
  }

  /** The document's workflow state for the viewer (buttons + approval trail). */
  async docState(userId: number, ref: DocumentRef): Promise<WorkflowDocState> {
    const instance = await this.currentInstance(ref);
    if (!instance) {
      return {
        instanceId: null,
        status: null,
        currentSequence: 0,
        myTask: null,
        timeline: [],
      };
    }
    const full = await this.getInstance(instance.id);
    const pending = await this.prisma.workflowTask.findFirst({
      where: {
        instanceId: instance.id,
        assignedUserId: userId,
        status: 'PENDING',
      },
    });
    let myTask: WorkflowViewerTask | null = null;
    if (pending) {
      const step = await this.prisma.workflowStep.findUnique({
        where: { id: pending.stepId },
      });
      myTask = {
        taskId: pending.id,
        sequence: pending.sequence,
        buttonText: step?.buttonText ?? 'Approve',
        actionType: step?.action ?? 'APPROVE',
        canApprove: pending.canApprove,
        canReject: step?.canReject ?? false,
        canCancel: step?.canCancel ?? false,
        canEdit: step?.canEdit ?? false,
      };
    }
    return {
      instanceId: instance.id,
      status: instance.status as WorkflowStatus,
      currentSequence: instance.currentSequence,
      myTask,
      timeline: full.timeline.map((t) => ({
        id: t.id,
        sequence: t.sequence,
        action: t.action,
        comment: t.comment,
        userId: t.userId,
        userName: t.userName,
        createdAt: t.createdAt,
      })),
    };
  }

  /** Preview the first configured step, to label a draft's forward button. */
  async firstStep(
    companyId: number,
    branchId: number | null,
    moduleId: number,
    objectId: number,
  ): Promise<WorkflowFirstStep | null> {
    const def = await this.matchDefinition({
      companyId,
      branchId: branchId ?? undefined,
      moduleId,
      objectId,
    });
    if (!def) return null;
    const step = await this.prisma.workflowStep.findFirst({
      where: { definitionId: def.id },
      orderBy: { sequence: 'asc' },
    });
    if (!step) return null;
    return { buttonText: step.buttonText, actionType: step.action };
  }

  /** Document ids (within a module + form) the user holds a task on. */
  async visibleDocumentIds(
    userId: number,
    moduleId: number,
    objectId: number,
  ): Promise<number[]> {
    const tasks = await this.prisma.workflowTask.findMany({
      where: { assignedUserId: userId, instance: { moduleId, objectId } },
      select: { instance: { select: { documentId: true } } },
    });
    return [...new Set(tasks.map((t) => t.instance.documentId))];
  }

  /** The in-progress instance for a document, else the most recent one. */
  private async currentInstance(ref: DocumentRef) {
    const active = await this.prisma.workflowInstance.findFirst({
      where: { ...ref, status: 'IN_PROGRESS' },
      orderBy: { id: 'desc' },
    });
    if (active) return active;
    return this.prisma.workflowInstance.findFirst({
      where: { ...ref },
      orderBy: { id: 'desc' },
    });
  }

  // --- engine internals ---

  /** Advance the instance to the next step after `afterSequence` (or step 1). */
  private async activateNext(
    instance: WorkflowInstance,
    afterSequence: number | null,
  ): Promise<void> {
    const next = await this.prisma.workflowStep.findFirst({
      where: {
        definitionId: instance.definitionId,
        sequence: { gt: afterSequence ?? 0 },
      },
      orderBy: { sequence: 'asc' },
      include: { users: { select: { userId: true } } },
    });
    if (!next) {
      await this.finish(instance.id, 'APPROVED');
      return;
    }

    const assignees = await this.resolveAssignees(next);
    if (assignees.length === 0) {
      // No one to act at this level — skip it and continue (guarded by sequence).
      await this.log(instance.id, next.id, next.sequence, instance.startedByUserId, 'AUTO_SKIP');
      await this.activateNext(instance, next.sequence);
      return;
    }

    const canApprove = this.withinLimit(
      instance.amount,
      next.approvalMode,
      next.valueFrom,
      next.valueTo,
    );
    await this.prisma.$transaction([
      this.prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { currentSequence: next.sequence },
      }),
      this.prisma.workflowTask.createMany({
        data: assignees.map((assignedUserId) => ({
          instanceId: instance.id,
          stepId: next.id,
          sequence: next.sequence,
          assignedUserId,
          canApprove,
        })),
      }),
    ]);

    if (next.notifyInApp) {
      await this.prisma.workflowNotification.createMany({
        data: assignees.map((userId) => ({
          userId,
          instanceId: instance.id,
          title: 'Approval required',
          body: `${instance.documentRef ?? 'A document'} needs your action (${next.buttonText}).`,
        })),
      });
    }
  }

  /** Explicit step users, else all active users in the step's user group. */
  private async resolveAssignees(step: {
    userGroupId: number | null;
    users: { userId: number }[];
  }): Promise<number[]> {
    if (step.users.length) {
      return [...new Set(step.users.map((u) => u.userId))];
    }
    if (step.userGroupId) {
      return this.users.usersInGroup(step.userGroupId);
    }
    return [];
  }

  private withinLimit(
    amount: number | null,
    mode: string,
    from: number | null,
    to: number | null,
  ): boolean {
    if (mode !== 'FIELD' || amount == null) return true;
    if (from != null && amount < from) return false;
    if (to != null && amount > to) return false;
    return true;
  }

  private async matchDefinition(dto: {
    companyId: number;
    branchId?: number | null;
    moduleId: number;
    objectId: number;
  }) {
    const where: Prisma.WorkflowDefinitionWhereInput = {
      companyId: dto.companyId,
      moduleId: dto.moduleId,
      objectId: dto.objectId,
      isActive: true,
    };
    // Prefer a branch-specific workflow, then a company-wide one.
    if (dto.branchId) {
      const branchSpecific = await this.prisma.workflowDefinition.findFirst({
        where: { ...where, branchId: dto.branchId },
        orderBy: { id: 'asc' },
      });
      if (branchSpecific) return branchSpecific;
    }
    return this.prisma.workflowDefinition.findFirst({
      where: { ...where, branchId: null },
      orderBy: { id: 'asc' },
    });
  }

  private completeTask(taskId: number) {
    return this.prisma.workflowTask.update({
      where: { id: taskId },
      data: { status: 'DONE', actedAt: new Date() },
    });
  }

  private skipSiblings(instanceId: number, sequence: number) {
    return this.prisma.workflowTask.updateMany({
      where: { instanceId, sequence, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
  }

  private finish(
    instanceId: number,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  ) {
    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status },
    });
  }

  private log(
    instanceId: number,
    stepId: number | null,
    sequence: number,
    userId: number,
    action: string,
    comment?: string,
  ) {
    return this.prisma.workflowActionLog.create({
      data: {
        instanceId,
        stepId,
        sequence,
        userId,
        action,
        comment: comment?.trim() || null,
      },
    });
  }

  private notify(
    userId: number,
    instanceId: number,
    taskId: number | null,
    title: string,
    body: string,
  ) {
    return this.prisma.workflowNotification.create({
      data: { userId, instanceId, taskId, title, body },
    });
  }
}
