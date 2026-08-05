import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { SalesOrderService } from './sales-order.service';
import { ActSalesOrderDto, UpdateSalesOrderDto } from './sales-order.dto';

/**
 * Inter-Company Sales Orders (ICSO) — the selling company's order to supply,
 * converted from an approved ICPO and then travelling the seller's own approval
 * workflow.
 *
 * There is no create endpoint: an ICSO only ever comes from a purchase order.
 * The LSO (raised directly on an external customer) will add one once the
 * Customer master exists.
 */
@ApiTags('sales-orders')
@ApiBearerAuth()
@Controller('sales-orders')
export class SalesOrderController {
  constructor(private readonly service: SalesOrderService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
  ) {
    return this.service.findAll(user.id, companyId ?? 0, !!user.isSuperAdmin);
  }

  /** Whether the current user may act on this form (workflow-governed). */
  @Get('create-access')
  createAccess(@CurrentUser() user: AuthUser) {
    return this.service.createAccess(user.id, !!user.isSuperAdmin);
  }

  /** Convert an approved ICPO into a sales order. The supplier company only. */
  @Post('from-purchase-order/:purchaseOrderId')
  convert(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Param('purchaseOrderId', ParseIntPipe) purchaseOrderId: number,
  ) {
    return this.service.convertFromPurchaseOrder(
      user.id,
      companyId ?? 0,
      branchId,
      purchaseOrderId,
    );
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(user.id, id, !!user.isSuperAdmin);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSalesOrderDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user.id, id, !!user.isSuperAdmin);
  }

  /** Submit a draft into the approval workflow (the creator's forward action). */
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.submit(user.id, id, !!user.isSuperAdmin);
  }

  /** Raise the production Work Order for an approved order (one per order). */
  @Post(':id/work-order')
  createWorkOrder(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.createWorkOrder(user.id, companyId ?? 0, id);
  }

  /** Act on the order's workflow task (forward / approve / reject / cancel). */
  @Post(':id/act')
  act(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActSalesOrderDto,
  ) {
    return this.service.act(user.id, id, dto);
  }
}
