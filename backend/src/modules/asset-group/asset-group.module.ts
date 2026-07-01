import { Module } from '@nestjs/common';
import { AssetGroupService } from './asset-group.service';
import { AssetGroupController } from './asset-group.controller';

@Module({
  controllers: [AssetGroupController],
  providers: [AssetGroupService],
})
export class AssetGroupModule {}
