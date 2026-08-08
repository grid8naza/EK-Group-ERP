import { Module } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryController } from './category.controller';
import { InventoryTreeSeedService } from './inventory-tree-seed.service';

@Module({
  controllers: [CategoryController],
  // The tree seed sits with the category rather than the group because the
  // category is the top of it: a group states which categories it serves, so
  // the categories have to exist first and one seeder has to own both.
  providers: [CategoryService, InventoryTreeSeedService],
})
export class CategoryModule {}
