import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { CatalogueService } from './catalogue.service';

/**
 * Order Catalogue — the priced, pictured product list a branch raises its ICPO
 * from, with the quantity to order already worked out.
 *
 * READ ONLY, deliberately. The catalogue is a way of filling the ICPO form in,
 * not a second way of ordering: pressing Create posts to /purchase-orders like
 * any other draft, so the approval workflow, the creator gate and the numbering
 * series all still apply.
 */
@ApiTags('purchase-catalogue')
@ApiBearerAuth()
@Controller('purchase-catalogue')
export class CatalogueController {
  constructor(private readonly service: CatalogueService) {}

  /**
   * One supplier company's catalogue, measured for the ACTIVE branch.
   *
   * The branch comes from the X-Branch-Id header, never from a query parameter:
   * an ICPO belongs to the branch that raised it, so a branch cannot order for
   * another one and must not be shown figures as though it could.
   *
   * `deliveryDate` (YYYY-MM-DD) is the day the goods are wanted — it decides how
   * many days of cover to order, since the gap to the supplier's next production
   * run is measured from it. Defaults to tomorrow.
   */
  @Get()
  forSupplier(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('supplierId') supplierId?: string,
    @Query('deliveryDate') deliveryDate?: string,
  ) {
    // Number(), not ParseIntPipe — an optional pipe 400s on an absent param.
    return this.service.forSupplier(
      companyId ?? 0,
      branchId,
      Number(supplierId),
      deliveryDate,
    );
  }
}
