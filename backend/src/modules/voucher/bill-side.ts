import { BalanceSide, Prisma } from '@prisma/client';

/**
 * Which way a bill allocation moves the balance.
 *
 * Shared by the write side and the read side deliberately. What a bill still
 * owes is derived in three places — the picker's outstanding list, the check
 * that refuses an over-settlement, and the ageing report — and if any of them
 * read a direction differently from the others, a bill would be settled
 * according to one rule and aged according to another.
 */
export const otherSide = (side: BalanceSide): BalanceSide =>
  side === 'DR' ? 'CR' : 'DR';

/**
 * The side an allocation carries, for a row that may predate the column.
 *
 * Allocations written before adjustments existed have none. Every one of those
 * was made on its line's own side — that is all a stack could do then — so the
 * line is asked. Cheap: the caller selects one column to get it.
 */
export const sideOf = (row: {
  side: BalanceSide | null;
  line?: { debit: Prisma.Decimal } | null;
}): BalanceSide =>
  row.side ?? (row.line && Number(row.line.debit) > 0 ? 'DR' : 'CR');
