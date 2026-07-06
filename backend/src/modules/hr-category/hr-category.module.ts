import { Module } from '@nestjs/common';
import { HrCategoryService } from './hr-category.service';
import { HrCategoryController } from './hr-category.controller';

@Module({
  controllers: [HrCategoryController],
  providers: [HrCategoryService],
})
export class HrCategoryModule {}
