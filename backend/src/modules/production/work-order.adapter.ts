import { Injectable } from '@nestjs/common';
import {
  CreateWorkOrderInput,
  WorkOrderPort,
  WorkOrderRef,
} from '../../contracts/work-order.port';
import { WorkOrderService } from './work-order.service';

/**
 * Binds the WORK_ORDER port to the Production module's service, so CRM can raise
 * a work order through the port without importing Production. Bound in
 * contracts.module.ts.
 */
@Injectable()
export class WorkOrderAdapter implements WorkOrderPort {
  constructor(private readonly service: WorkOrderService) {}

  createFromSalesOrder(input: CreateWorkOrderInput): Promise<WorkOrderRef> {
    return this.service.createFromSalesOrder(input);
  }

  getForSalesOrder(salesOrderId: number): Promise<WorkOrderRef | null> {
    return this.service.getForSalesOrder(salesOrderId);
  }
}
