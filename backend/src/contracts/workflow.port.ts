/**
 * Port — how business modules will start/cancel an approval workflow for one of
 * their documents WITHOUT importing the Workflow module. Today the runtime is
 * also reachable over REST (`POST /workflow/instances`); this port is the
 * in-process contract for when a module (CRM, Accounts, …) wires approvals to a
 * real document. Bind it in contracts.module.ts (token → WorkflowModule's
 * adapter) once the first consumer exists.
 *
 * Rules: small, serializable shapes only; methods async; never leak Prisma types.
 */

export const WORKFLOW = Symbol('WORKFLOW');

export interface StartWorkflowInput {
  startedByUserId: number;
  companyId: number;
  branchId?: number | null;
  moduleId: number;
  objectId: number;
  documentId: number;
  documentRef?: string;
  /** Value tested by FIELD-approval limits (e.g. an amount). */
  amount?: number;
}

export interface WorkflowPort {
  /**
   * Start an approval for a document. Returns the new instance id, or null when
   * no active workflow is configured for that document type (caller may then
   * treat the document as auto-approved).
   */
  start(input: StartWorkflowInput): Promise<{ instanceId: number } | null>;

  /** Cancel any in-progress workflow attached to a document. */
  cancelForDocument(
    moduleId: number,
    objectId: number,
    documentId: number,
  ): Promise<void>;
}
