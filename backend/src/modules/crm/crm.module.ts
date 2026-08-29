import { Module } from '@nestjs/common';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';
import { LocalSalesOrderController } from './local-sales-order.controller';
import { LocalSalesOrderService } from './local-sales-order.service';
import { SalesInvoiceController } from './sales-invoice.controller';
import { SalesInvoiceService } from './sales-invoice.service';

@Module({
  controllers: [
    PurchaseOrderController,
    SalesOrderController,
    DispatchController,
    ContractController,
    LocalSalesOrderController,
    SalesInvoiceController,
  ],
  providers: [
    PurchaseOrderService,
    SalesOrderService,
    DispatchService,
    ContractService,
    LocalSalesOrderService,
    SalesInvoiceService,
  ],
  // The Order Catalogue asks what the contracts oblige on a day. It lives in the
  // Purchase module, so it reaches this through a port — not by importing here.
  exports: [ContractService],
})
export class CrmModule {}
