import { Injectable } from '@nestjs/common';
import { DispatchPort, IncomingDispatch } from '../../contracts/dispatch.port';
import { DispatchLinkService } from './dispatch-link.service';

/**
 * Binds the DISPATCH port to the CRM module (which owns the dispatch row), so
 * the receiving side can list incoming shipments and close them once the goods
 * are banked into stock. Bound in contracts.module.ts.
 */
@Injectable()
export class DispatchLinkAdapter implements DispatchPort {
  constructor(private readonly service: DispatchLinkService) {}

  incomingFor(
    buyerCompanyId: number,
    buyerBranchId: number | null,
  ): Promise<IncomingDispatch[]> {
    return this.service.incomingFor(buyerCompanyId, buyerBranchId);
  }

  findIncoming(dispatchId: number, buyerCompanyId: number) {
    return this.service.findIncoming(dispatchId, buyerCompanyId);
  }

  markReceived(dispatchId: number): Promise<void> {
    return this.service.markReceived(dispatchId);
  }

  markDispatched(dispatchId: number): Promise<void> {
    return this.service.markDispatched(dispatchId);
  }
}
