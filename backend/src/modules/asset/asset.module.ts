import { Module } from '@nestjs/common';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';
import { AssetBookingService } from './asset-booking.service';
import { AssetBookingController } from './asset-booking.controller';

@Module({
  controllers: [AssetController, AssetBookingController],
  providers: [AssetService, AssetBookingService],
})
export class AssetModule {}
