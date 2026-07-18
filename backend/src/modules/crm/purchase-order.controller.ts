import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { PurchaseOrderService } from './purchase-order.service';
import {
  ActPurchaseOrderDto,
  CreatePurchaseOrderDto,
  ReviewPurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './purchase-order.dto';

/**
 * Purchase Orders - IC. Raised by a requester (active company/branch) on a
 * supplier company as a DRAFT, then submitted into the supplier's approval
 * workflow. Visibility, buttons and status all follow the workflow engine.
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
    return this.service.create(
      user.id,
      companyId ?? 0,
      branchId,
      dto,
      !!user.isSuperAdmin,
    );
  }

  /**
   * List by direction relative to the active company: `received` (raised on us)
   * or `sent` (raised by us — the default).
   */
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('scope') scope?: string,
  ) {
    const s = scope === 'received' ? 'received' : 'sent';
    return this.service.findAll(
      user.id,
      companyId ?? 0,
      branchId,
      s,
      !!user.isSuperAdmin,
    );
  }

  /** Whether the current user may raise a new order (workflow-governed). */
  @Get('create-access')
  createAccess(@CurrentUser() user: AuthUser) {
    return this.service.createAccess(user.id, !!user.isSuperAdmin);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(user.id, id, !!user.isSuperAdmin);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(user.id, id, !!user.isSuperAdmin);
  }

  /** Submit a draft into the approval workflow (the creator's forward action). */
  @Post(':id/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.submit(user.id, id, !!user.isSuperAdmin);
  }

  /**
   * Customer Relations' review: accepted quantity per line, and which lines are
   * refused. Supplier company only, while they hold an editing task.
   */
  @Patch(':id/review')
  review(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewPurchaseOrderDto,
  ) {
    return this.service.review(user.id, companyId ?? 0, id, dto);
  }

  /** Reserve stock (FEFO, company-wide) against the accepted quantities. */
  @Post(':id/reserve')
  reserve(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.reserve(user.id, companyId ?? 0, id);
  }

  /** Act on the order's workflow task (forward / approve / reject / cancel). */
  @Post(':id/act')
  act(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActPurchaseOrderDto,
  ) {
    return this.service.act(user.id, id, dto);
  }
}
