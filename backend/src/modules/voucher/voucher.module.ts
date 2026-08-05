import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';
import { PartyLedgerController } from './party-ledger.controller';
import { PartyLedgerService } from './party-ledger.service';
import { VoucherSeedService } from './voucher-seed.service';

@Module({
  controllers: [VoucherController, PartyLedgerController],
  providers: [VoucherService, VoucherSeedService, PartyLedgerService],
})
export class VoucherModule {}
