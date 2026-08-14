import { Injectable } from '@nestjs/common';
import { countByCompany } from '../../common/by-company';
import {
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';
import { WorkflowRuntimeService } from './workflow-runtime.service';

/** Where the two halves of the inbox are read. */
const APPROVAL_ROUTE = '/workflow/approvals';
const REVIEW_ROUTE = '/workplace/documents/for-review';

/**
 * The approval engine's contribution to the Workplace dashboard: documents
 * waiting on this person to decide, and documents sent for them to read.
 *
 * Both come from `myTasks`, which is the same call the two inbox screens make —
 * deliberately, because the rule that puts a task in one half or the other
 * (`reviewOnly`) is the engine's and must not be re-decided here. A dashboard
 * that counted approvals differently from the screen it links to would be worse
 * than one that showed nothing.
 *
 * Nothing is filtered by company: an approver on a group-wide workflow signs for
 * whichever company raised the document, and the inbox has always shown all of
 * them. The tiles carry the split by company instead.
 */
@Injectable()
export class WorkflowSummaryAdapter implements WorkplaceSummaryPort {
  readonly key = 'approvals';

  constructor(private readonly runtime: WorkflowRuntimeService) {}

  async tiles(userId: number): Promise<WorkplaceTile[]> {
    const tasks = await this.runtime.myTasks(userId);
    const approvals = tasks.filter((t) => t.kind === 'APPROVAL');
    const reviews = tasks.filter((t) => t.kind === 'REVIEW');

    return [
      {
        key: 'approvals.pending',
        label: 'For approval',
        count: approvals.length,
        route: APPROVAL_ROUTE,
        icon: 'check-circle-2',
        tone: approvals.length ? 'attention' : 'normal',
        order: 10,
        byCompany: countByCompany(approvals),
      },
      {
        key: 'approvals.review',
        label: 'For review',
        count: reviews.length,
        route: REVIEW_ROUTE,
        icon: 'eye',
        order: 20,
        byCompany: countByCompany(reviews),
      },
    ];
  }

  async waiting(userId: number, limit: number): Promise<WorkplaceItem[]> {
    const tasks = await this.runtime.myTasks(userId);
    return tasks.slice(0, limit).map((t) => ({
      key: `approval:${t.taskId}`,
      kind: t.kind === 'REVIEW' ? ('REVIEW' as const) : ('APPROVAL' as const),
      // The kind of document as well as its number: "Journal HOF/JV-00004" tells
      // the reader what is waiting; the reference alone asks them to know a
      // numbering scheme.
      title:
        [t.documentType, t.documentRef].filter(Boolean).join(' ') ||
        'A document',
      subtitle: t.workflowName || null,
      at: t.createdAt.toISOString(),
      route: t.route,
      documentId: t.documentId,
      companyId: t.companyId,
      branchId: t.branchId,
    }));
  }
}
