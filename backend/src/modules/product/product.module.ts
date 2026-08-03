import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { CostingService } from './costing.service';

@Module({
  controllers: [ProductController],
  providers: [ProductService, CostingService],
})
export class ProductModule {}
