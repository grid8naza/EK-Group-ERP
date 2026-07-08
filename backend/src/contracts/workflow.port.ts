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

/** Identifies one business document across a module + form. */
export interface DocumentRef {
  moduleId: number;
  objectId: number;
  documentId: number;
}

/** The instance status after a workflow operation (maps to the doc's status). */
export type WorkflowStatus =
  | 'IN_PROGRESS'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/** The viewer's pending action on a document (null = nothing to do). */
export interface WorkflowViewerTask {
  taskId: number;
  sequence: number;
  buttonText: string; // the label configured on the step (drives the form button)
  actionType: string; // WorkflowActionType of the step
  canApprove: boolean; // false = value beyond limit → may only review+forward
  canReject: boolean;
  canCancel: boolean;
  canEdit: boolean;
}

/** One entry in a document's approval trail. */
export interface WorkflowTimelineEntry {
  id: number;
  sequence: number;
  action: string;
  comment: string | null;
  userId: number;
  userName: string;
  createdAt: Date;
}

/** A document's workflow state for the viewer (drives the document's buttons). */
export interface WorkflowDocState {
  instanceId: number | null;
  status: WorkflowStatus | null; // null when no workflow has started (draft)
  currentSequence: number;
  myTask: WorkflowViewerTask | null;
  timeline: WorkflowTimelineEntry[];
}

/** Preview of the first configured step (labels the creator's forward button). */
export interface WorkflowFirstStep {
  buttonText: string;
  actionType: string;
}

/**
 * Whether a workflow governs creating a document type, and whether the user may.
 * When `governed` is true the workflow SUPERSEDES the screen's Add privilege:
 * only users on a Create-action step (`allowed`) may create the document.
 */
export interface CreateGate {
  governed: boolean;
  allowed: boolean;
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

  /**
   * Submit a freshly-created document into its workflow AS the creator: starts
   * the instance and, when the creator is the first step's approver, immediately
   * acts on that step (create+forward) so it lands at the next level. Returns
   * the instance id + resulting status, or null when no workflow is configured.
   */
  submitAsCreator(
    input: StartWorkflowInput,
  ): Promise<{ instanceId: number; status: WorkflowStatus } | null>;

  /**
   * Act on the current user's pending task for a document (approve / forward /
   * reject / cancel). Returns the resulting instance status so the caller can
   * sync its document status.
   */
  actOnDocument(
    userId: number,
    ref: DocumentRef,
    action: 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE',
    comment?: string,
  ): Promise<{ status: WorkflowStatus }>;

  /** The document's workflow state for the viewer (buttons + approval trail). */
  docState(userId: number, ref: DocumentRef): Promise<WorkflowDocState>;

  /**
   * Preview the first configured step for a document type, to label a draft's
   * forward button before the workflow has started. Null when none configured.
   */
  firstStep(
    companyId: number,
    branchId: number | null,
    moduleId: number,
    objectId: number,
  ): Promise<WorkflowFirstStep | null>;

  /**
   * Document ids (within a module + form) the user is involved in — i.e. the
   * workflow has reached their level (they hold a task of any status). Used to
   * scope an approver's listing so future levels can't see a document early.
   */
  visibleDocumentIds(
    userId: number,
    moduleId: number,
    objectId: number,
  ): Promise<number[]>;

  /**
   * Whether creating this document type is governed by a workflow, and whether
   * the user is a designated creator (assignee of a Create-action step). Pass a
   * `companyId` to test one company's workflow (the document's owner); omit it to
   * test whether the user is a creator in ANY active workflow for the form (used
   * to decide if the "New" button shows). When `governed` is true the workflow
   * supersedes the Add privilege.
   */
  creatorGate(
    userId: number,
    moduleId: number,
    objectId: number,
    companyId?: number | null,
    branchId?: number | null,
  ): Promise<CreateGate>;
}
