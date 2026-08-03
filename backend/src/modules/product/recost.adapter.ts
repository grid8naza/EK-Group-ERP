import { Injectable } from '@nestjs/common';
import { RecostedProduct, RecostPort } from '../../contracts/recost.port';
import { CostingService } from './costing.service';

/**
 * The product module's implementation of RecostPort — lets the Asset and HR
 * masters announce a rate change WITHOUT importing this module. Bound to the
 * RECOST token in contracts.module.ts.
 */
@Injectable()
export class RecostAdapter implements RecostPort {
  constructor(private readonly costing: CostingService) {}

  recostForRateChange(input: {
    assetIds?: number[];
    designationIds?: number[];
  }): Promise<RecostedProduct[]> {
    return this.costing.recostForRateChange(input);
  }
}
