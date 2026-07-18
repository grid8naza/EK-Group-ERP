import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { WorkOrderController } from './work-order.controller';
import { WorkOrderService } from './work-order.service';
import { ProductionDivisionController } from './production-division.controller';
import { ProductionDivisionService } from './production-division.service';
import { ProductionPlanController } from './production-plan.controller';
import { ProductionPlanService } from './production-plan.service';
import { MaterialRequestController } from './material-request.controller';
import { MaterialRequestService } from './material-request.service';
import { ProductionReceiptController } from './production-receipt.controller';
import { ProductionReceiptService } from './production-receipt.service';

// USER_LOOKUP is injected from the @Global ContractsModule, so no import of the
// User module is needed here — that keeps Production independently extractable.
// The Work Order screen's own WorkOrderService instance for the controller; the
// WORK_ORDER port has a second stateless instance in ContractsModule.
@Module({
  controllers: [
    ProductionController,
    WorkOrderController,
    ProductionDivisionController,
    ProductionPlanController,
    MaterialRequestController,
    ProductionReceiptController,
  ],
  providers: [
    ProductionService,
    WorkOrderService,
    ProductionDivisionService,
    ProductionPlanService,
    MaterialRequestService,
    ProductionReceiptService,
  ],
})
export class ProductionModule {}
