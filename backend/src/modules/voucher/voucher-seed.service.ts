import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RETIRED_VOUCHER_TYPES, VOUCHER_TYPES } from './voucher-types';

/**
 * Loads the voucher-type master on boot, so every database recognises the same
 * kinds of voucher without anyone running SQL.
 *
 * Upserted rather than created-if-missing: which kinds exist, what they are
 * called, and whether a person may write one by hand are facts about the
 * accounting model rather than preferences someone might have changed.
 *
 * `isActive` is left alone for the kinds still listed — that one IS a choice,
 * so a company can retire a kind it never raises. The exception is a kind the
 * model itself has dropped (see RETIRED_VOUCHER_TYPES), which is switched off
 * here regardless.
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
      // A kind that no longer has a screen is switched off, not deleted — the
      // vouchers already raised under it still name it.
      await this.prisma.voucherType.updateMany({
        where: { code: { in: RETIRED_VOUCHER_TYPES }, isActive: true },
        data: { isActive: false },
      });
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
