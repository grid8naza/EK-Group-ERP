import { Injectable } from '@nestjs/common';
import {
  DocumentRef,
  StartWorkflowInput,
  WorkflowPort,
} from '../../contracts/workflow.port';
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

  submitAsCreator(input: StartWorkflowInput) {
    return this.runtime.submitAsCreator(input);
  }

  actOnDocument(
    userId: number,
    ref: DocumentRef,
    action: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE',
    comment?: string,
  ) {
    return this.runtime.actOnDocument(userId, ref, action, comment);
  }

  docState(userId: number, ref: DocumentRef) {
    return this.runtime.docState(userId, ref);
  }

  firstStep(
    companyId: number,
    branchId: number | null,
    moduleId: number,
    objectId: number,
  ) {
    return this.runtime.firstStep(companyId, branchId, moduleId, objectId);
  }

  visibleDocumentIds(userId: number, moduleId: number, objectId: number) {
    return this.runtime.visibleDocumentIds(userId, moduleId, objectId);
  }
}
