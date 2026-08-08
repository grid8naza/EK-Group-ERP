import { Module } from '@nestjs/common';
import { MasterDataSeedService } from './master-data-seed.service';

/**
 * The master data every screen reads, seeded on boot in dependency order.
 *
 * Deliberately NOT a feature module under src/modules: it writes across
 * inventory, HR, assets and Cpanel, and a feature module doing that would
 * either break the no-cross-module-imports rule or be split into pieces whose
 * boot order nothing guarantees. It sits beside src/scaffold, which is the same
 * kind of thing — setup that has to happen before anyone can use the app.
 */
@Module({
  providers: [MasterDataSeedService],
})
export class MasterDataModule {}
