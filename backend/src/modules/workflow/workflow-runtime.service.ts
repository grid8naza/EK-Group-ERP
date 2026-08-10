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
import { limitValue } from './limit-fields';
import { ActOnTaskDto, StartWorkflowDto } from './workflow.dto';

// Actions whose level ENDS the workflow when approved (no onward routing).
// CONVERT_* actions approve like APPROVE does; what makes them different happens
// in the owning module, after this engine reports which action fired.
const TERMINAL_ACTIONS: WorkflowActionType[] = [
  'APPROVE',
  'CREATE_APPROVE',
  'REFERENCE',
  'CONVERT_ICSO',
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
        // Stored so a step's limit tests the field it NAMES; see limitValue.
        fields: dto.fields ?? undefined,
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

    // Where the document itself can be read. The inbox does not act on a
    // document — it takes the approver TO it, because approving a thing you
    // cannot see is approving a reference number, and because what approval
    // MEANS is the owning module's business: posting a voucher to the books,
    // turning an approved ICPO into a sales order. The engine cannot reach a
    // module to do any of that, so it sends the approver where the module can.
    const objects = await this.prisma.objectMaster.findMany({
      where: { id: { in: [...new Set(tasks.map((t) => t.instance.objectId))] } },
      select: { id: true, route: true, objectName: true },
    });
    const objectById = new Map(objects.map((o) => [o.id, o]));

    // WHOSE document it is. An approver on a company-wide workflow is asked to
    // sign for every branch of the company, and one who works across companies
    // for every one of those too — so a list of ten payments with nothing but a
    // number and an amount asks them to approve what they cannot identify. The
    // instance has carried both since it started; it was simply never returned.
    const companies = await this.prisma.company.findMany({
      where: { id: { in: [...new Set(tasks.map((t) => t.instance.companyId))] } },
      select: { id: true, name: true },
    });
    const companyById = new Map(companies.map((c) => [c.id, c.name]));
    const branchIds = tasks
      .map((t) => t.instance.branchId)
      .filter((b): b is number => b != null);
    const branches = branchIds.length
      ? await this.prisma.branch.findMany({
          where: { id: { in: [...new Set(branchIds)] } },
          select: { id: true, name: true },
        })
      : [];
    const branchById = new Map(branches.map((b) => [b.id, b.name]));

    return tasks.map((t) => {
      const step = stepById.get(t.stepId);
      const flags = this.stepFlags(t.sequence, step);
      const object = objectById.get(t.instance.objectId);
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
        /** The screen this document is read and acted on. */
        route: object?.route ?? null,
        /** What that screen is called, for a row that says where it is going. */
        documentType: object?.objectName ?? null,
        /** Whose books it belongs to, and which branch raised it. */
        companyId: t.instance.companyId,
        companyName: companyById.get(t.instance.companyId) ?? null,
        branchId: t.instance.branchId,
        branchName: t.instance.branchId
          ? (branchById.get(t.instance.branchId) ?? null)
          : null,
        amount: t.instance.amount,
        action: step?.action,
        buttonText: step?.buttonText ?? 'Approve',
        canCancel: flags.canCancel,
        canReject: flags.canReject,
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

    // Access can be withdrawn while a task is already sitting in somebody's
    // inbox. Whoever cannot act for a company cannot act for it at any level,
    // including one they were legitimately given yesterday.
    const [allowed] = await this.withCompanyAccess(
      [userId],
      step,
      instance.companyId,
      instance.moduleId,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You no longer have access to the company or the module this document belongs to, so you cannot act on it.',
      );
    }

    const flags = this.stepFlags(task.sequence, step);

    // --- terminal actions: reject / cancel ---
    if (dto.action === 'REJECT') {
      if (!flags.canReject) {
        throw new ForbiddenException('Reject is not allowed at this step.');
      }
      if (!dto.comment?.trim()) {
        throw new BadRequestException('A reason is required to reject.');
      }
      await this.completeTask(task.id);
      await this.skipSiblings(instance.id, task.sequence);
      await this.log(instance.id, step.id, task.sequence, userId, 'REJECT', dto.comment);
      await this.finish(instance.id, 'REJECTED');
      // Alerts are for receivers (the next approver), not the sender — a rejection
      // ends the flow with no receiver, so no notification is raised here. The
      // requester tracks the outcome via the document's status.
      return this.getInstance(instance.id);
    }
    if (dto.action === 'CANCEL') {
      if (!flags.canCancel) {
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
      // Terminal step but value beyond limit → still forward for higher
      // approval, and there had BETTER be one. `requireNext` is what stops the
      // forward becoming an approval: the whole point of the limit is that this
      // person may not approve this amount, so finishing the workflow because
      // nobody is above them would grant exactly what it forbids.
      await this.activateNext(instance, task.sequence, { requireNext: true });
    } else {
      await this.finish(instance.id, 'APPROVED');
    }
    return this.getInstance(instance.id);
  }

  async notifications(userId: number) {
    const rows = await this.prisma.workflowNotification.findMany({
      // Only surface alerts whose task is still awaiting this user — once the task
      // is DONE/SKIPPED (actioned, superseded, or the whole instance finished) the
      // alert is stale. Legacy rows with no linked task are treated as stale too.
      where: { userId, task: { is: { status: 'PENDING' } } },
      orderBy: { id: 'desc' },
      take: 50,
      include: {
        instance: { select: { objectId: true, documentId: true } },
      },
    });

    // Where the document is. An alert that knows which document it is about
    // should land on it, not on a list the reader then has to search — the
    // approvals inbox is the place you go when you have not been told which
    // one, and the bell has just told you.
    const objects = await this.prisma.objectMaster.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.instance.objectId))] } },
      select: { id: true, route: true },
    });
    const routeById = new Map(objects.map((o) => [o.id, o.route]));

    return rows.map(({ instance, ...n }) => ({
      ...n,
      route: routeById.get(instance.objectId) ?? null,
      documentId: instance.documentId,
    }));
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
      where: { userId, isRead: false, task: { is: { status: 'PENDING' } } },
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
  ): Promise<{
    instanceId: number;
    status: WorkflowStatus;
    statusLabel: string | null;
  } | null> {
    const instance = await this.start(input.startedByUserId, {
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      moduleId: input.moduleId,
      objectId: input.objectId,
      documentId: input.documentId,
      documentRef: input.documentRef,
      amount: input.amount,
      fields: input.fields,
    });
    if (!instance) return null;

    let status = instance.status as WorkflowStatus;
    let statusLabel: string | null = null;
    const myTask = instance.tasks.find(
      (t) => t.assignedUserId === input.startedByUserId && t.status === 'PENDING',
    );
    if (myTask) {
      const step = await this.prisma.workflowStep.findUnique({
        where: { id: myTask.stepId },
        select: { statusLabel: true },
      });
      const after = await this.act(input.startedByUserId, myTask.id, {
        action: 'FORWARD',
      });
      status = after.status as WorkflowStatus;
      statusLabel = step?.statusLabel ?? null;
      // The creator immediately forwards their own first level, so drop the
      // self-notification raised when it activated — alerts are for receivers.
      //
      // By TASK, not by instance-and-user. Forwarding has already activated the
      // next level and raised its alert, and where the same person sits at two
      // consecutive levels — an accountant who prepares and also checks, or a
      // small company where one person holds two roles — deleting every alert
      // they held on this instance took the new one with it. The bell then said
      // nothing about a document waiting on them.
      //
      // Belt and braces at that: `notifications` and `unreadCount` already show
      // only alerts whose task is still PENDING, and this one's task is DONE the
      // moment it is forwarded. The row is removed to keep the table tidy, not
      // to keep the bell honest.
      await this.prisma.workflowNotification.deleteMany({
        where: { taskId: myTask.id },
      });
    }
    return { instanceId: instance.id, status, statusLabel };
  }

  /** Act on the current user's pending task for a document. */
  async actOnDocument(
    userId: number,
    ref: DocumentRef,
    action: ActOnTaskDto['action'],
    comment?: string,
  ): Promise<{
    status: WorkflowStatus;
    statusLabel: string | null;
    actedAction: string | null;
  }> {
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
    const step = await this.prisma.workflowStep.findUnique({
      where: { id: task.stepId },
      select: { statusLabel: true, action: true },
    });
    const after = await this.act(userId, task.id, { action, comment });
    // The status a positive step stamps onto the document; reject/cancel fall back
    // to the enum status the caller derives from `status`.
    const positive = action !== 'REJECT' && action !== 'CANCEL';
    const statusLabel = positive ? (step?.statusLabel ?? null) : null;
    // Which action the acted step was configured with. The engine can't reach a
    // business module to run a CONVERT_* action's side-effect, so it reports what
    // fired and the owning module decides what that means. Null on reject/cancel:
    // nothing was converted.
    return {
      status: after.status as WorkflowStatus,
      statusLabel,
      actedAction: positive ? (step?.action ?? null) : null,
    };
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
    // A stalled instance heals itself the moment somebody looks at the
    // document, so putting the configuration right — restoring access, adding
    // an approver to a group — is all anyone has to do. Without this a stall
    // would need a button nobody would know to press.
    const stalled = await this.retryStalled(instance);
    // Re-read: the retry may have moved the instance on, or finished it, and
    // reporting the status captured before it would tell the screen the
    // document is still going when it has just completed.
    const current =
      (await this.prisma.workflowInstance.findUnique({
        where: { id: instance.id },
        select: { status: true, currentSequence: true },
      })) ?? instance;

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
      const flags = this.stepFlags(pending.sequence, step);
      myTask = {
        taskId: pending.id,
        sequence: pending.sequence,
        buttonText: step?.buttonText ?? 'Approve',
        actionType: step?.action ?? 'APPROVE',
        canApprove: pending.canApprove,
        canReject: flags.canReject,
        canCancel: flags.canCancel,
        canEdit: step?.canEdit ?? false,
      };
    }
    return {
      instanceId: instance.id,
      status: current.status as WorkflowStatus,
      currentSequence: current.currentSequence,
      myTask,
      /** Waiting on nobody: the level it has reached has no one who can act. */
      stalled,
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

  /**
   * Stop the instance here, and say why once.
   *
   * The sequence is left ON the level that could not proceed, which is what
   * retryStalled reads to know where to start again. The reason is written only
   * the first time: every read of the document retries the stall, and a line per
   * retry would bury the trail under the same sentence repeated as often as
   * anybody looked at it.
   */
  private async stall(
    instance: WorkflowInstance,
    stepId: number | null,
    sequence: number,
    reason: string,
  ): Promise<void> {
    await this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: { currentSequence: sequence },
    });
    const alreadySaid = await this.prisma.workflowActionLog.findFirst({
      where: { instanceId: instance.id, sequence, action: 'STALLED' },
      select: { id: true },
    });
    if (alreadySaid) return;
    await this.log(
      instance.id,
      stepId,
      sequence,
      instance.startedByUserId,
      'STALLED',
      reason,
    );
  }

  /**
   * Why this level has nobody, in the words of what actually happened.
   *
   * A group that has lost its last member and a group whose members cannot
   * reach the company both leave the level empty, and they are put right in
   * completely different ways — one by adding somebody to the group, the other
   * by granting access. Saying "nobody can act for this company" for both sent
   * whoever read the trail looking in the wrong place.
   */
  private async stallReason(step: {
    userGroupId: number | null;
    users: { userId: number }[];
  }): Promise<string> {
    if (step.users.length) {
      return 'nobody named on this level can act for this company';
    }
    if (step.userGroupId) {
      const members = await this.users.usersInGroup(step.userGroupId);
      return members.length
        ? 'nobody in the group on this level can act for this company'
        : 'the group on this level has no active members';
    }
    return 'no approver is named on this level';
  }

  /**
   * Try a stalled level again, and say whether it is still stalled.
   *
   * An instance that is IN_PROGRESS with no pending task anywhere can only be
   * stalled: every other path either raises a task, finishes the instance, or
   * stalls it deliberately. So this needs no flag of its own — the absence of
   * work IS the condition.
   *
   * WHERE to start again depends on which kind of stall it is, and the level's
   * own tasks say which. A level that stopped because nobody could act on it
   * has no completed task, so activation re-runs from that level. A level that
   * stopped because a forced forward had nowhere to go HAS one — somebody
   * acted — so activation must look past it, at whatever level has since been
   * added above. Starting from the wrong one either skips a level or asks
   * somebody to act twice.
   */
  private async retryStalled(instance: WorkflowInstance): Promise<boolean> {
    if (instance.status !== 'IN_PROGRESS') return false;
    const pending = await this.prisma.workflowTask.count({
      where: { instanceId: instance.id, status: 'PENDING' },
    });
    if (pending) return false;

    const acted = await this.prisma.workflowTask.count({
      where: {
        instanceId: instance.id,
        sequence: instance.currentSequence,
        status: 'DONE',
      },
    });
    await this.activateNext(
      instance,
      acted ? instance.currentSequence : instance.currentSequence - 1,
      // A level already acted on can only have stalled one way: a forced
      // forward with nowhere to go. The retry has to carry the same condition,
      // or it undoes the stall it is retrying — running out of steps would read
      // as approved, and the amount the limit refused would be granted by the
      // next person who merely LOOKED at the document.
      { requireNext: !!acted },
    );

    const nowPending = await this.prisma.workflowTask.count({
      where: { instanceId: instance.id, status: 'PENDING' },
    });
    const after = await this.prisma.workflowInstance.findUnique({
      where: { id: instance.id },
      select: { status: true },
    });
    // Still stalled only if it is still going and still has nothing to do —
    // an instance that finished on the retry is not stalled, it is done.
    return after?.status === 'IN_PROGRESS' && nowPending === 0;
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
    return {
      buttonText: step.buttonText,
      actionType: step.action,
      canCancel: step.canCancel,
    };
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

  /**
   * Whether a workflow governs creating this document type and whether the user
   * may create it (is on a Create-action step). With a companyId, tests that
   * company's workflow; without, tests every active workflow for the form.
   */
  async creatorGate(
    userId: number,
    moduleId: number,
    objectId: number,
    companyId?: number | null,
    branchId?: number | null,
  ): Promise<{ governed: boolean; allowed: boolean }> {
    if (companyId) {
      const def = await this.matchDefinition({
        companyId,
        branchId: branchId ?? undefined,
        moduleId,
        objectId,
      });
      if (!def) return { governed: false, allowed: true };
      return {
        governed: true,
        allowed: await this.userInCreateStep(userId, def.id, def.companyId, moduleId),
      };
    }
    const defs = await this.prisma.workflowDefinition.findMany({
      where: { moduleId, objectId, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!defs.length) return { governed: false, allowed: true };
    for (const d of defs) {
      if (await this.userInCreateStep(userId, d.id, d.companyId, moduleId)) {
        return { governed: true, allowed: true };
      }
    }
    return { governed: true, allowed: false };
  }

  /**
   * Whether the user is an assignee of a Create-action step of a definition.
   *
   * Company access counts here as everywhere else: somebody who cannot reach
   * the company is not one of its designated creators, whatever a step says.
   */
  private async userInCreateStep(
    userId: number,
    definitionId: number,
    definitionCompanyId: number,
    definitionModuleId: number,
  ): Promise<boolean> {
    const steps = await this.prisma.workflowStep.findMany({
      where: {
        definitionId,
        action: { in: ['CREATE_FORWARD', 'CREATE_APPROVE', 'CREATE_REFERENCE'] },
      },
      include: { users: { select: { userId: true } } },
    });
    for (const s of steps) {
      const assignees = await this.resolveAssignees(
        s,
        definitionCompanyId,
        definitionModuleId,
      );
      if (assignees.includes(userId)) return true;
    }
    return false;
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
    opts: { requireNext?: boolean } = {},
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
      // Running out of steps normally MEANS approved — that is how a workflow
      // ends. Not when the last act was a forced forward: somebody was told
      // they may not approve this amount, and completing the workflow because
      // there is nobody above them would grant precisely what the limit
      // withheld. It stops instead, and says why.
      if (opts.requireNext) {
        await this.stall(
          instance,
          null,
          afterSequence ?? 0,
          'the value is beyond this level’s limit and there is no higher level to forward it to',
        );
        return;
      }
      await this.finish(instance.id, 'APPROVED');
      return;
    }

    const assignees = await this.resolveAssignees(
      next,
      instance.companyId,
      instance.moduleId,
    );
    if (assignees.length === 0) {
      // Nobody can act at this level, so the document STOPS here. It used to
      // skip on, which quietly threw the level away: a control somebody had
      // configured disappeared because a group emptied or an approver's access
      // was withdrawn, and the document went to the next level — or to approved
      // — with nothing but a line in the trail to show for it.
      //
      // A step always names a group or a user (see assertStepsValid), so a level
      // resolving to nobody is never a deliberately blank one. It is a
      // configuration that has stopped being true, and the answer to that is to
      // wait for somebody to put it right, not to carry on without it.
      //
      // The instance stays IN_PROGRESS and its sequence sits ON the stalled
      // level, so retryStalled can pick it up again the moment it can be filled.
      await this.stall(
        instance,
        next.id,
        next.sequence,
        await this.stallReason(next),
      );
      return;
    }

    const canApprove = this.withinLimit(instance, next);
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
      // Link each alert to the task it's about, so the bell can drop it the moment
      // that task stops being PENDING (actioned here, or skipped when a peer acts).
      const tasks = await this.prisma.workflowTask.findMany({
        where: { instanceId: instance.id, stepId: next.id, sequence: next.sequence },
        select: { id: true, assignedUserId: true },
      });
      // Named by KIND as well as by number. The bell serves every module at
      // once, and "HOF/JV-00004 needs your action" asks the reader to know a
      // numbering scheme; "Journal HOF/JV-00004" tells them what is waiting.
      const form = await this.prisma.objectMaster.findUnique({
        where: { id: instance.objectId },
        select: { objectName: true },
      });
      const document = [form?.objectName, instance.documentRef]
        .filter(Boolean)
        .join(' ');
      await this.prisma.workflowNotification.createMany({
        data: tasks.map((t) => ({
          userId: t.assignedUserId,
          instanceId: instance.id,
          taskId: t.id,
          title: 'Approval required',
          body: `${document || 'A document'} needs your action (${next.buttonText}).`,
        })),
      });
    }
  }

  /** Explicit step users, else all active users in the step's user group. */
  private async resolveAssignees(
    step: {
      userGroupId: number | null;
      targetCompanyId: number | null;
      targetModuleId: number | null;
      users: { userId: number }[];
    },
    documentCompanyId: number,
    documentModuleId: number,
  ): Promise<number[]> {
    const named = step.users.length
      ? [...new Set(step.users.map((u) => u.userId))]
      : step.userGroupId
        ? await this.users.usersInGroup(step.userGroupId)
        : [];
    return this.withCompanyAccess(
      named,
      step,
      documentCompanyId,
      documentModuleId,
    );
  }

  /**
   * Only those who can reach the companies this step involves.
   *
   * Naming an approver is checked when a workflow is saved, but that answer goes
   * stale: a group gains a member, somebody's access to a company is withdrawn,
   * and a workflow nobody has touched since starts raising tasks for people who
   * cannot open the document. Whoever cannot act for a company is not asked to,
   * at any level — so the list is re-tested every time a level activates.
   *
   * Both companies, where a step is routed: the one it acts for, and the one
   * whose document it is. Routing does not move the document.
   */
  private async withCompanyAccess(
    userIds: number[],
    step: { targetCompanyId: number | null; targetModuleId: number | null },
    documentCompanyId: number,
    documentModuleId: number,
  ): Promise<number[]> {
    const needed = [
      ...new Set([step.targetCompanyId ?? documentCompanyId, documentCompanyId]),
    ];
    // The module the step acts in, tested in the company the document is in —
    // module access is granted per company, so the pair is the question.
    const moduleId = step.targetModuleId ?? documentModuleId;
    const allowed: number[] = [];
    for (const userId of userIds) {
      const ok = await Promise.all([
        ...needed.map((c) => this.users.canAccessCompany(userId, c)),
        this.users.canAccessModule(userId, documentCompanyId, moduleId),
      ]);
      if (ok.every(Boolean)) allowed.push(userId);
    }
    return allowed;
  }

  /**
   * The actions a step really offers at its position: Cancel is an origin-only
   * action (step 1, the creator's level) and Reject only applies to downstream
   * approvers (step 2+). Enforced at runtime so the rule holds even for
   * workflows saved before the step editor hid the invalid checkboxes.
   */
  private stepFlags(
    sequence: number,
    step: { canCancel?: boolean; canReject?: boolean } | null | undefined,
  ): { canCancel: boolean; canReject: boolean } {
    return {
      canCancel: !!step?.canCancel && sequence <= 1,
      canReject: !!step?.canReject && sequence > 1,
    };
  }

  /**
   * Whether this step may approve the document itself, or must pass it up.
   *
   * The value tested is the one the step NAMES — limitValue resolves it out of
   * what the module supplied, falling back to the headline amount. A step that
   * is not limited at all approves anything.
   *
   * A named field with no value here cannot be tested, and that is NOT the same
   * as being within the limit: somebody wrote down a ceiling, and the honest
   * answer to "is this under it?" being unknown is to send it up rather than to
   * wave it through. An unlimited document (`amount` null on a form that
   * supplies none) is the one exception — there is no value in play at all.
   */
  private withinLimit(
    instance: { amount: number | null; fields?: unknown },
    step: {
      approvalMode: string;
      fieldName: string | null;
      valueFrom: number | null;
      valueTo: number | null;
    },
  ): boolean {
    if (step.approvalMode !== 'FIELD') return true;
    const value = limitValue(instance.fields, instance.amount, step.fieldName);
    if (value == null) {
      // Nothing named, nothing supplied: no value is in play, so the limit has
      // nothing to bite on. Anything else — a name the module did not fill in —
      // has to escalate.
      const named = step.fieldName?.trim() || 'amount';
      return named === 'amount' && instance.amount == null;
    }
    if (step.valueFrom != null && value < step.valueFrom) return false;
    if (step.valueTo != null && value > step.valueTo) return false;
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
