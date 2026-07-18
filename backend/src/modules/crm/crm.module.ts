import { Module } from '@nestjs/common';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

@Module({
  controllers: [
    PurchaseOrderController,
    SalesOrderController,
    DispatchController,
  ],
  providers: [PurchaseOrderService, SalesOrderService, DispatchService],
})
export class CrmModule {}
