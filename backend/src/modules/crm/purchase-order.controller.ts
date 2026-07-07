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
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto } from './purchase-order.dto';

/**
 * Purchase Orders - IC. Raised by a requester (active company/branch) on a
 * supplier company; received & reviewed by the supplier's CRM staff via the
 * workflow, who later convert them to sales orders.
 */
@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreatePurchaseOrderDto,
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
