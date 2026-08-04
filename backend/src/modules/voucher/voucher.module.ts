import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';
import { VoucherSeedService } from './voucher-seed.service';

@Module({
  controllers: [VoucherController],
  providers: [VoucherService, VoucherSeedService],
})
export class VoucherModule {}
