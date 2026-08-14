import { Inject, Injectable, Logger } from '@nestjs/common';
import { USER_LOOKUP, UserLookupPort } from '../../contracts/user-lookup.port';
import {
  WORKPLACE_SUMMARY,
  WorkplaceItem,
  WorkplaceSummaryPort,
  WorkplaceTile,
} from '../../contracts/workplace-summary.port';

/** How many rows the "waiting on you" list carries. */
const WAITING_LIMIT = 15;
/** How many each provider is asked for, before the merge cuts them down. */
const PER_SOURCE_LIMIT = 10;

/**
 * The order the tiles are read in, left to right.
 *
 * It lives HERE, in one list, rather than as a number inside each provider —
 * because the order of the row is an editorial decision about this PAGE, and a
 * provider has no way to know what it should sit beside. Kept as one array so a
 * reshuffle is one edit rather than seven.
 *
 * A tile whose key is not named below keeps its provider's own `order` and
 * lands after everything here, so a module adding a tile appears without
 * having to be listed first.
 */
const TILE_ORDER = [
  // What this person owes, first — it is their own work before anyone else's.
  'tasks.mine',
  'tasks.overdue',
  'tasks.raised',
  // Then what is in front of them to decide or read.
  'approvals.pending',
  'approvals.review',
  // Then what has been said to them.
  'chat.unread',
  'mail.drafts',
  'mail.unread',
  'broadcasts.unread',
  'circulars.unacknowledged',
];

/**
 * The Workplace dashboard — what is waiting for ONE PERSON, across the whole
 * group (SRS §8.11 / §8.12).
 *
 * It is a **user dashboard, not a module dashboard**, and that is the decision
 * everything else follows from. Every other dashboard in this application
 * belongs to a company: you pick a company in the topbar and the numbers are
 * that company's. This one belongs to whoever is signed in, and covers every
 * company and branch they have privileges for — because a person is answerable
 * for what they are answerable for, and the fact that they happen to be working
 * in Bake House this morning does not excuse the payment waiting at Regency.
 *
 * So it does NOT reuse the Cpanel dashboard/widget engine, which is company-
 * scoped by construction. It is assembled from the WORKPLACE_SUMMARY providers,
 * each module answering for its own data with its own visibility rules
 * (contracts/workplace-summary.port.ts explains why that division matters).
 *
 * One provider failing must not empty the page: a broken query in Circulars
 * would otherwise take the approvals count down with it. Each is caught, logged
 * and skipped.
 */
@Injectable()
export class WorkplaceService {
  private readonly logger = new Logger(WorkplaceService.name);

  constructor(
    @Inject(WORKPLACE_SUMMARY)
    private readonly sources: WorkplaceSummaryPort[],
    @Inject(USER_LOOKUP) private readonly users: UserLookupPort,
  ) {}

  async dashboard(userId: number) {
    const [tileGroups, itemGroups, scope] = await Promise.all([
      Promise.all(
        this.sources.map((s) =>
          s.tiles(userId).catch((e) => {
            this.logger.error(
              `dashboard tiles "${s.key}" failed: ${String(e)}`,
            );
            return [] as WorkplaceTile[];
          }),
        ),
      ),
      Promise.all(
        this.sources.map((s) =>
          s.waiting(userId, PER_SOURCE_LIMIT).catch((e) => {
            this.logger.error(
              `dashboard items "${s.key}" failed: ${String(e)}`,
            );
            return [] as WorkplaceItem[];
          }),
        ),
      ),
      // The companies and branches this person may work in — the labels every
      // row and the whole cross-company panel are rendered from. Asked through
      // USER_LOOKUP because "which companies are mine" is the user module's
      // fact; it is the same answer the audience pickers are built on.
      this.users.audienceOptions(userId),
    ]);

    // Named tiles in the page's own order; anything else after them, in the
    // order its provider asked for.
    const rank = (key: string) => {
      const at = TILE_ORDER.indexOf(key);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    };
    const tiles = tileGroups
      .flat()
      .sort(
        (a, b) =>
          rank(a.key) - rank(b.key) ||
          a.order - b.order ||
          a.key.localeCompare(b.key),
      );

    const waiting = itemGroups.flat().sort(sortWaiting).slice(0, WAITING_LIMIT);

    return {
      tiles,
      waiting,
      // Only the companies something is actually waiting in would be a smaller
      // list, but a person's whole scope is the more useful one: a company with
      // nothing outstanding is worth showing as a clean row, not as an absence
      // the reader has to notice.
      companies: scope.companies,
      branches: scope.branches,
      /** So the page can say what it is as of, without trusting the browser. */
      asOf: new Date().toISOString(),
    };
  }
}

/**
 * The order the list is read in: late first, then what is due soonest, then the
 * newest of everything with no date on it at all.
 *
 * Dated things sort ABOVE undated ones on purpose. "Approve this" with no
 * deadline is real work, but a thing with a date attached is the one that
 * becomes a problem tomorrow, and a list that buried those under whatever
 * arrived most recently would need reading twice.
 */
function sortWaiting(a: WorkplaceItem, b: WorkplaceItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return b.at.localeCompare(a.at);
}
