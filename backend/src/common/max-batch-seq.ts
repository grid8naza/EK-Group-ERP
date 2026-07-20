import { Prisma } from '@prisma/client';

/** How many of today's batch numbers to scan back through. */
const SCAN_LIMIT = 200;

/**
 * The highest sequence already used by a company's batch numbers under `prefix`
 * (`CompanyCode-YYMMDD-`), which the built-in `CompanyCode-YYMMDD-####` scheme
 * counts up from — `Nz(DMax(...),0)`.
 *
 * Counting the rows instead would reissue a number the moment one is deleted:
 * three batches minus the middle one still counts 2, and the next batch would
 * collide with the third.
 */
export async function maxBatchSeq(
  tx: Prisma.TransactionClient,
  companyId: number,
  prefix: string,
): Promise<number> {
  const rows = await tx.stockBatch.findMany({
    where: { companyId, batchNo1: { startsWith: prefix } },
    select: { batchNo1: true },
    orderBy: { batchNo1: 'desc' },
    take: SCAN_LIMIT,
  });
  let max = 0;
  for (const r of rows) {
    const seq = Number(r.batchNo1?.slice(prefix.length));
    if (Number.isSafeInteger(seq) && seq > max) max = seq;
  }
  return max;
}
