import { Prisma } from '@prisma/client';

/**
 * Create a document, retrying with the next number when its number is taken.
 *
 * Document numbers are derived (MAX + 1), so two users creating the same kind of
 * document at the same instant compute the SAME number and one of them loses the
 * unique constraint. That is the safe failure — no duplicate is ever written —
 * but the loser should quietly take the next number rather than see an error.
 *
 * `numbers` is asked again per attempt, with the attempt index, so each retry
 * offsets past the number that just clashed.
 */
export async function withNumberRetry<N, T>(
  numbers: (attempt: number) => Promise<N>,
  create: (n: N) => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; ; i++) {
    const n = await numbers(i);
    try {
      return await create(n);
    } catch (e) {
      if (
        i < attempts &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        continue;
      }
      throw e;
    }
  }
}
