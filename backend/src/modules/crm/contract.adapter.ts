import { Injectable } from '@nestjs/common';
import { ContractDue, ContractPort } from '../../contracts/contract.port';
import { ContractService } from './contract.service';

/**
 * CRM's in-process implementation of ContractPort — lets the Order Catalogue
 * (Purchase) ask what the contracts oblige on a day WITHOUT importing this
 * module. Bound to the CONTRACT token in contracts.module.ts.
 */
@Injectable()
export class ContractAdapter implements ContractPort {
  constructor(private readonly contracts: ContractService) {}

  dueOn(
    companyId: number,
    branchId: number | null,
    date: string,
  ): Promise<ContractDue[]> {
    return this.contracts.dueOn(companyId, branchId, date);
  }
}
