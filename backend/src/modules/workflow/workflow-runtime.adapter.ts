import { Injectable } from '@nestjs/common';
import { StartWorkflowInput, WorkflowPort } from '../../contracts/workflow.port';
import { WorkflowRuntimeService } from './workflow-runtime.service';

/**
 * The Workflow module's in-process implementation of WorkflowPort — lets a
 * business module (CRM, Accounts, …) start/cancel an approval for one of its
 * documents WITHOUT importing this module. Bound to the WORKFLOW token in
 * contracts.module.ts; when the workflow engine is extracted, only that binding
 * changes (to a remote client) — consumers are untouched.
 */
@Injectable()
export class WorkflowRuntimeAdapter implements WorkflowPort {
  constructor(private readonly runtime: WorkflowRuntimeService) {}

  async start(input: StartWorkflowInput) {
    const instance = await this.runtime.start(input.startedByUserId, {
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      moduleId: input.moduleId,
      objectId: input.objectId,
      documentId: input.documentId,
      documentRef: input.documentRef,
      amount: input.amount,
    });
    return instance ? { instanceId: instance.id } : null;
  }

  cancelForDocument(moduleId: number, objectId: number, documentId: number) {
    return this.runtime.cancelForDocument(moduleId, objectId, documentId);
  }
}
