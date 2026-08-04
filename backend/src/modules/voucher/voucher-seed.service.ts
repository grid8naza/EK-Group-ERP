import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VOUCHER_TYPES } from './voucher-types';

/**
 * Loads the voucher-type master on boot, so every database recognises the same
 * kinds of voucher without anyone running SQL.
 *
 * Upserted rather than created-if-missing: which kinds exist, what they are
 * called, and whether a person may write one by hand are facts about the
 * accounting model rather than preferences someone might have changed. Only
 * `isActive` is left alone — that one IS a choice, so a company can retire a
 * kind it never raises.
 */
@Injectable()
export class VoucherSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VoucherSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      let created = 0;
      for (const [i, t] of VOUCHER_TYPES.entries()) {
        const shape = {
          name: t.name,
          nature: t.nature,
          documentCode: t.documentCode,
          isSystemOnly: t.isSystemOnly,
          sortOrder: i,
        };
        const existing = await this.prisma.voucherType.findUnique({
          where: { code: t.code },
          select: { id: true },
        });
        if (!existing) created++;
        await this.prisma.voucherType.upsert({
          where: { code: t.code },
          create: { code: t.code, ...shape },
          update: shape,
        });
      }
      if (created) this.logger.log(`Voucher types seeded: +${created}.`);
    } catch (e) {
      // The books are unusable without these, but a failure here must not stop
      // the app booting — it is logged and retried next start.
      this.logger.error(
        `Voucher type seed failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
