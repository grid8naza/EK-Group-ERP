import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto } from './sales-order.dto';

/**
 * Sales orders. Placed by a requester (active company/branch) on a supplier
 * company; received & processed by the supplier's CRM staff via the workflow.
 */
@ApiTags('sales-orders')
@ApiBearerAuth()
@Controller('sales-orders')
export class SalesOrderController {
  constructor(private readonly service: SalesOrderService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateSalesOrderDto,
  ) {
    return this.service.create(user.id, companyId ?? 0, branchId, dto);
  }

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('scope') scope?: string,
  ) {
    return this.service.findAll(
      companyId ?? 0,
      scope === 'placed' ? 'placed' : 'incoming',
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }
}
