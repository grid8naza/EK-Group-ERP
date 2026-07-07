import { Module } from '@nestjs/common';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';

@Module({
  controllers: [SalesOrderController],
  providers: [SalesOrderService],
})
export class CrmModule {}
