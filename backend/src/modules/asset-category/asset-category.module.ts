import { Module } from '@nestjs/common';
import { AssetCategoryService } from './asset-category.service';
import { AssetCategoryController } from './asset-category.controller';

@Module({
  controllers: [AssetCategoryController],
  providers: [AssetCategoryService],
})
export class AssetCategoryModule {}
