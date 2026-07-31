import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId } from '../../auth/branch.decorator';
import { CompanyId } from '../../auth/company.decorator';
import { ProductionPerformanceService } from './production-performance.service';

/**
 * Production performance by cost centre / cost object — the production-side
 * view of the dimensions, read from Production's own data (the stock ledger).
 */
@ApiTags('production-performance')
@ApiBearerAuth()
@Controller('production-performance')
export class ProductionPerformanceController {
  constructor(private readonly service: ProductionPerformanceService) {}

  @Get('by-cost-object')
  byCostObject(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.byCostObject(companyId, branchId, from, to);
  }
}
