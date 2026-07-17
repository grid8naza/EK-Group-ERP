import { ConflictException } from '@nestjs/common';
import { StockPort } from '../contracts/stock.port';

/**
 * Refuse to destroy batches that stock is reserved against.
 *
 * Every stock document regenerates its batches wholesale when its lines are
 * edited, and deletes them outright when it is removed. A reservation names a
 * batch by id, so destroying one leaves the hold pointing at a row that no
 * longer exists — and an orphaned hold is worse than a broken link: it keeps
 * counting against what everyone else can reserve, silently sterilising stock
 * with nothing on any screen to explain where the quantity went.
 *
 * Blocking rather than auto-releasing is deliberate. A hold is a promise made to
 * a customer's order; quietly dropping it because someone corrected a voucher
 * would break that promise without telling anybody. Making the edit fail forces
 * the reservation to be dealt with first — the same stance the codebase already
 * takes when it refuses to delete a supplier that has stock movements.
 */
export async function assertBatchesFree(
  stock: StockPort,
  batchIds: number[],
  noun: string,
  action: 'editing' | 'deleting' = 'editing',
): Promise<void> {
  if (!batchIds.length) return;
  const holds = await stock.holdsOnBatches(batchIds);
  if (!holds.length) return;

  const held = holds
    .map((h) => `${h.quantity} of batch ${h.batchNo}`)
    .join(', ');
  throw new ConflictException(
    `Stock on this ${noun} is reserved (${held}). Release the reservation before ${action} it — ${action} would destroy the batch the stock is held against.`,
  );
}
