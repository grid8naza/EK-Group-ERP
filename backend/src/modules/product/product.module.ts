import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { CostingService } from './costing.service';
import { ProductCostBackfillService } from './cost-backfill.service';

@Module({
  controllers: [ProductController],
  providers: [ProductService, CostingService, ProductCostBackfillService],
})
export class ProductModule {}
