import { Module } from '@nestjs/common';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';

@Module({
  controllers: [PurchaseOrderController, SalesOrderController],
  providers: [PurchaseOrderService, SalesOrderService],
})
export class CrmModule {}
