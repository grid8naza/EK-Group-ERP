import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  USER_LOOKUP,
  type UserLookupPort,
} from '../../contracts/user-lookup.port';
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
  constructor(
    private prisma: PrismaService,
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

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
    const shadows = await this.shadowedDefinitions(companyId);
    return rows.map((r) => ({
      ...this.flatten(r),
      /** Set on an active definition another one is already governing its form. */
      shadowedBy: shadows.get(r.id) ?? null,
    }));
  }

  /**
   * Which active definitions are being governed by another — and by which.
   *
   * New ones are refused (see assertOnlyActiveFor), but a database written
   * before that rule may hold a pair, and a pair is invisible: both read as
   * active, and only the one the runtime picks does anything. So the listing
   * has to say which is which, or somebody edits the wrong one and watches
   * their changes have no effect.
   *
   * The rule is the runtime's own, kept in step with matchDefinition: within a
   * level — company-wide, or one branch — the lowest id wins. Across levels
   * nothing is shadowed, because a company-wide workflow still governs every
   * branch that has none of its own.
   *
   * Computed over ALL of the company's active definitions rather than over the
   * rows being returned: a filtered listing would otherwise report a row as
   * fine simply because the one shadowing it was filtered out.
   */
  private async shadowedDefinitions(companyId: number) {
    const active = await this.prisma.workflowDefinition.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, branchId: true, moduleId: true, objectId: true },
      orderBy: { id: 'asc' },
    });
    const governing = new Map<string, { id: number; name: string }>();
    const shadowed = new Map<number, { id: number; name: string }>();
    for (const d of active) {
      const level = `${d.branchId ?? 'company'}:${d.moduleId}:${d.objectId}`;
      const holder = governing.get(level);
      if (holder) shadowed.set(d.id, holder);
      else governing.set(level, { id: d.id, name: d.name });
    }
    return shadowed;
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
    await this.assertBranchBelongs(cid, dto.branchId ?? null);
    await this.assertApproversHaveAccess(cid, dto.steps);
    if (dto.isActive ?? true) {
      await this.assertOnlyActiveFor({
        companyId: cid,
        branchId: dto.branchId ?? null,
        moduleId: dto.moduleId,
        objectId: dto.objectId,
      });
    }
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
    // Only when it is actually MOVING. Re-sending the branch a workflow already
    // sits on must not refuse the save — see the grandfathering below, and for
    // the same reason: nothing should stand between somebody and a repair.
    if (dto.branchId !== undefined && dto.branchId !== existing.branchId) {
      await this.assertBranchBelongs(existing.companyId, dto.branchId);
    }
    if (dto.steps !== undefined) this.assertStepsValid(dto.steps);
    if (dto.steps !== undefined) {
      // What was already on this workflow may be saved again. The rules below
      // are there to stop somebody CONFIGURING a level that can never act; on a
      // definition that already names one they would do the opposite, refusing
      // every save until it is fixed — including the save that fixes it, since
      // the whole chain goes up together and one bad step would hold the other
      // four hostage. A group that has since been emptied, or an approver whose
      // access has since gone, therefore passes if it was already there. What
      // is NEWLY named is held to the rules in full.
      //
      // Nothing is lost by allowing it: such a level stalls the moment it is
      // reached, says why, and starts again by itself once it is put right.
      const prior = await this.prisma.workflowStep.findMany({
        where: { definitionId: id },
        select: { userGroupId: true, users: { select: { userId: true } } },
      });
      await this.assertApproversHaveAccess(existing.companyId, dto.steps, {
        groupIds: new Set(
          prior.map((s) => s.userGroupId).filter((g): g is number => g != null),
        ),
        userIds: new Set(prior.flatMap((s) => s.users.map((u) => u.userId))),
      });
    }

    // Re-checked on the two edits that can create a clash: switching a
    // definition back on, and moving it between a branch and the company as a
    // whole. Editing the steps of one that is already the only active one
    // cannot clash with anything, so it is not re-tested.
    const willBeActive = dto.isActive ?? existing.isActive;
    const willBeBranch =
      dto.branchId !== undefined ? dto.branchId : existing.branchId;
    if (
      willBeActive &&
      (dto.isActive === true || dto.branchId !== undefined)
    ) {
      await this.assertOnlyActiveFor(
        {
          companyId: existing.companyId,
          branchId: willBeBranch ?? null,
          moduleId: existing.moduleId,
          objectId: existing.objectId,
        },
        id,
      );
    }

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

  /**
   * An approver may only be named for a company they can reach.
   *
   * A workflow is a list of people who will be asked to act for a company. Name
   * somebody who has no access to it and the task still lands in their inbox and
   * still blocks the document — they simply cannot open it, and there is no
   * message anywhere saying why. So it is refused where it is written.
   *
   * TWO companies are tested where a step is routed elsewhere: the one it acts
   * for, and the one whose document it is. Routing a step to another company
   * does not move the document — a voucher stays in the books of the company
   * that raised it — so an approver who can reach the routed company but not the
   * originating one still cannot read the thing they are approving.
   *
   * Only explicitly-named users are checked here. A step that names a GROUP is
   * checked at runtime instead: membership changes without the workflow being
   * touched, so a save-time answer would go stale. See resolveAssignees.
   */
  private async assertApproversHaveAccess(
    definitionCompanyId: number,
    steps: WorkflowStepInput[] | undefined,
    /** Groups and users already on this workflow — see the caller in update. */
    already: { groupIds: Set<number>; userIds: Set<number> } = {
      groupIds: new Set(),
      userIds: new Set(),
    },
  ) {
    for (const step of steps ?? []) {
      const acting = step.targetCompanyId ?? definitionCompanyId;
      const needed = [...new Set([acting, definitionCompanyId])];

      // A group's COMPANY is a property of the group, not of who happens to be
      // in it today, so unlike membership it can be settled here — and must be:
      // a group of another company's people is a level that can never act, and
      // it saves perfectly happily before stalling the first document to reach
      // it. The setup screen already narrows the list; this is what holds when
      // the definition is written any other way.
      if (step.userGroupId && !already.groupIds.has(step.userGroupId)) {
        await this.assertGroupCanAct(step.userGroupId, step.sequence, needed);
      }

      for (const userId of step.userIds ?? []) {
        if (already.userIds.has(userId)) continue;
        for (const companyId of needed) {
          if (await this.users.canAccessCompany(userId, companyId)) continue;
          const [user, company] = await Promise.all([
            this.users.findById(userId),
            this.prisma.company.findUnique({
              where: { id: companyId },
              select: { name: true },
            }),
          ]);
          throw new BadRequestException(
            `${user?.name ?? `User ${userId}`} has no access to ${company?.name ?? `company ${companyId}`}, ` +
              `so they cannot act for it at step ${step.sequence}. Give them access to that company, or name somebody who has it.`,
          );
        }
      }
    }
  }

  /**
   * A workflow bound to a branch must be bound to one of its OWN company's.
   *
   * A branch belongs to exactly one company, and the runtime matches a document
   * to a definition by company AND branch together — so a workflow on another
   * company's branch matches nothing, ever. It saves cleanly, lists as active,
   * is not a duplicate of anything, and simply never fires: the worst shape a
   * misconfiguration can take, because there is nothing to notice.
   *
   * Null is always valid — that is the company-wide workflow, which is what
   * every branch without one of its own falls back to.
   */
  private async assertBranchBelongs(
    companyId: number,
    branchId: number | null,
  ) {
    if (branchId == null) return;
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true, companyId: true, company: { select: { name: true } } },
    });
    if (!branch) {
      throw new BadRequestException('That branch no longer exists.');
    }
    if (branch.companyId !== companyId) {
      const owner = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      });
      throw new BadRequestException(
        `${branch.name} is a branch of ${branch.company.name}, not ${owner?.name ?? 'this company'}. ` +
          `A workflow bound to it would never match anything. Choose one of this company's branches, or leave it company-wide.`,
      );
    }
  }

  /**
   * A group named on a step has to be able to act for the companies involved.
   *
   * Two things are checked, and they fail for different reasons. The group's own
   * company is fixed, so a group from elsewhere is simply the wrong group and is
   * refused outright. Emptiness is not fixed — a group loses its last member
   * long after any workflow was saved — so this only catches one that is empty
   * ALREADY. The runtime catches the rest; see resolveAssignees.
   */
  private async assertGroupCanAct(
    userGroupId: number,
    sequence: number,
    neededCompanyIds: number[],
  ) {
    const group = await this.prisma.userGroup.findUnique({
      where: { id: userGroupId },
      select: { id: true, name: true, companyId: true, company: { select: { name: true } } },
    });
    if (!group) {
      throw new BadRequestException(`Step ${sequence}: that user group no longer exists.`);
    }
    if (!neededCompanyIds.includes(group.companyId)) {
      const needed = await this.prisma.company.findMany({
        where: { id: { in: neededCompanyIds } },
        select: { name: true },
      });
      throw new BadRequestException(
        `Step ${sequence}: “${group.name}” is a group of ${group.company.name}, so nobody in it can act for ` +
          `${needed.map((c) => c.name).join(' or ')}. Choose a group of that company.`,
      );
    }
    const members = await this.users.usersInGroup(userGroupId);
    if (!members.length) {
      throw new BadRequestException(
        `Step ${sequence}: “${group.name}” has no active members, so nothing would ever reach it. ` +
          `Put somebody in the group, or name the approvers on the step.`,
      );
    }
  }

  /**
   * One active workflow per form, per company, per branch.
   *
   * A second one is not a richer configuration — it is a silent one. The runtime
   * matches a definition by (company, branch, module, form) and takes the lowest
   * id, so the other never governs anything: somebody edits it, saves it, sees
   * it listed as active, and nothing they wrote ever fires. Refused at the point
   * of making it rather than explained afterwards.
   *
   * A branch workflow alongside a company-wide one is NOT a clash — the runtime
   * prefers the branch's and falls back to the company's, which is exactly what
   * that pair is for. Only two at the same level collide, and `null` is a level.
   *
   * Inactive ones are left alone entirely: keeping last year's chain switched off
   * beside this year's is how anybody would expect to revise one.
   */
  private async assertOnlyActiveFor(
    scope: {
      companyId: number;
      branchId: number | null;
      moduleId: number;
      objectId: number;
    },
    exceptId?: number,
  ) {
    const clash = await this.prisma.workflowDefinition.findFirst({
      where: {
        ...scope,
        isActive: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (!clash) return;

    const form = await this.prisma.objectMaster.findUnique({
      where: { id: scope.objectId },
      select: { objectName: true },
    });
    const where = scope.branchId ? 'this branch' : 'the company as a whole';
    throw new BadRequestException(
      `“${clash.name}” is already the active workflow for ${form?.objectName ?? 'this form'} in ${where}. ` +
        `Switch it off first, or edit it — two active workflows on one form would leave one of them never firing.`,
    );
  }

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
        // A limit says "beyond this, somebody senior decides" — so there has to
        // BE somebody senior. On the last level there is nowhere to send it, and
        // what the reader configured as a ceiling would hold nothing back: the
        // engine refuses the approval, forces a forward, finds no one above, and
        // the document goes through anyway. A limit that only relabels the trail
        // is worse than none, because it reads on screen as a control.
        if (s.sequence === Math.max(...seqs)) {
          throw new BadRequestException(
            `Step ${s.sequence} is the last level, so a value limit on it would hold nothing back — ` +
              `anything beyond it has nowhere to go and would be approved regardless. ` +
              `Put the limit on an earlier level, or add the level that decides the larger amounts.`,
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
        statusLabel: s.statusLabel?.trim() || null,
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
