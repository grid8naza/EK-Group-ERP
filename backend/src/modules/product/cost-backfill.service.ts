import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One-time backfill of `Product.lastCostedAt`, run on boot so every database
 * gets it rather than only the one a developer happened to patch by hand.
 *
 * The column was added after products already carried costs, so those rows had
 * no timestamp and every review screen read them as "never costed". This stamps
 * the ones that DO have a cost with the row's `updatedAt`.
 *
 * `updatedAt` is an APPROXIMATION, and the only one available: it is when the
 * row last changed for any reason, so it is an upper bound on when the cost was
 * set — a product edited last week for an unrelated reason will claim to have
 * been costed last week. That is accepted deliberately as a one-off starting
 * point; every path that moves a cost from here on writes the real timestamp, so
 * the approximation is replaced the first time each product is genuinely
 * recosted.
 *
 * A product with no cost at all is left NULL — it has genuinely never been
 * costed, and saying so is more useful than inventing a date.
 *
 * Idempotent: it only ever touches rows that are still NULL, so it is a no-op on
 * the second boot and can never overwrite a real timestamp.
 */
@Injectable()
export class ProductCostBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductCostBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Raw SQL because the value comes from another column of the same row,
      // which Prisma's typed update cannot express.
      const stamped = await this.prisma.$executeRaw`
        UPDATE products
           SET "lastCostedAt" = "updatedAt"
         WHERE "lastCostedAt" IS NULL
           AND "costPrice" > 0
      `;
      if (stamped > 0) {
        this.logger.log(
          `Backfilled lastCostedAt on ${stamped} product${
            stamped === 1 ? '' : 's'
          } from updatedAt (approximate; replaced on the next real recost).`,
        );
      }
    } catch (e) {
      // A failed backfill leaves the timestamps NULL, which reads as "never
      // costed" — conservative, and no reason to stop the app booting.
      this.logger.error(
        `lastCostedAt backfill failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
