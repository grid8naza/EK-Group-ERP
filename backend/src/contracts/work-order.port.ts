/**
 * Port — how CRM raises a production Work Order from an approved sales order
 * WITHOUT importing the Production module. CRM reads its own sales order and
 * passes the assembled data across; Production numbers and persists the Work
 * Order. Bound in contracts.module.ts to the Production adapter.
 */

/** DI token for the work-order port. Inject with `@Inject(WORK_ORDER)`. */
export const WORK_ORDER = Symbol('WORK_ORDER');

/** One product to produce, from a sales-order line that has no stock behind it. */
export interface WorkOrderSourceLine {
  productId: number;
  quantity: number;
  unitId: number;
}

export interface CreateWorkOrderInput {
  userId: number;
  companyId: number; // the producing / selling company
  branchId?: number | null;
  salesOrderId: number;
  soNumber: string; // snapshot of the source order number
  soDeliveryAt?: Date | null;
  lines: WorkOrderSourceLine[];
}

/** Minimal work-order identity returned to the caller. */
export interface WorkOrderRef {
  id: number;
  orderNo: string;
}

export interface WorkOrderPort {
  /**
   * Create the Work Order for a sales order. Throws if one already exists
   * (salesOrderId is unique — an order raises a single work order).
   */
  createFromSalesOrder(input: CreateWorkOrderInput): Promise<WorkOrderRef>;

  /** The work order raised from a sales order, or null if none yet. */
  getForSalesOrder(salesOrderId: number): Promise<WorkOrderRef | null>;
}
