import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The words a document wears while it is going round for approval.
 *
 * A step names one of these, and it is what the document's register shows once
 * that step has acted — "Prepared", then "Checked", then "Approved". The list is
 * the company's to edit from Cpanel; what is seeded here is only a starting
 * vocabulary, so that configuring a workflow does not begin with inventing one.
 *
 * Generic on purpose. The engine serves accounts, purchase and CRM alike, and
 * prepare-check-approve is the shape of an approval anywhere — it is not the
 * accounts module's vocabulary just because a voucher was the first document to
 * need it.
 *
 * Added one at a time by NAME, never in bulk and never overwriting: the four
 * words already in this table were typed by somebody, and a seed that replaced
 * them — or that stood down because the table was not empty — would be no use
 * either way. A word that is already there is left exactly as it is, colour and
 * icon included.
 */
@Injectable()
export class WorkflowStatusSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkflowStatusSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** name → the icon and colour it is shown with in a listing. */
  private static readonly STARTER = [
    { name: 'Prepared', icon: 'pencil-line', color: '#d97706', sortOrder: 10 },
    { name: 'Checked', icon: 'eye', color: '#2563eb', sortOrder: 20 },
    { name: 'Verified', icon: 'shield-check', color: '#7c3aed', sortOrder: 30 },
    { name: 'Approved', icon: 'check-circle', color: '#16a34a', sortOrder: 40 },
    { name: 'Rejected', icon: 'x-circle', color: '#e11d48', sortOrder: 50 },
  ];

  async onApplicationBootstrap(): Promise<void> {
    try {
      let added = 0;
      for (const s of WorkflowStatusSeedService.STARTER) {
        const existing = await this.prisma.workflowStatus.findUnique({
          where: { name: s.name },
          select: { id: true },
        });
        if (existing) continue;
        await this.prisma.workflowStatus.create({ data: s });
        added++;
      }
      if (added) {
        this.logger.log(`Approval statuses seeded: +${added}.`);
      }
    } catch (e) {
      // Reference data, not a reason to stop the application booting. Logged
      // and retried on the next start.
      this.logger.error(
        `Approval status seed failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
