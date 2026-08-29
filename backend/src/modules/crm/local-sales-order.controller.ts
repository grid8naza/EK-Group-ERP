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
import { LocalSalesOrderService } from './local-sales-order.service';
import {
  ActLocalSalesOrderDto,
  CreateLocalSalesOrderDto,
  UpdateLocalSalesOrderDto,
} from './local-sales-order.dto';

/**
 * Local Sales Orders (LSO) — what an outside customer has ordered from a branch.
 *
 * Raised as a DRAFT and submitted into the seller's own approval workflow, the
 * same choreography every other order document follows. Read by the Order
 * Catalogue as demand on the branch.
 */
@ApiTags('local-sales-orders')
@ApiBearerAuth()
@Controller('local-sales-orders')
export class LocalSalesOrderController {
  constructor(private readonly service: LocalSalesOrderService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateLocalSalesOrderDto,
  ) {
    return this.service.create(user.id, companyId, branchId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
  ) {
    return this.service.findAll(user.id, companyId ?? 0, !!user.isSuperAdmin);
  }

  /** Whether the current user may raise one (workflow-governed). */
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
    @Body() dto: UpdateLocalSalesOrderDto,
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

  @Post(':id/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.submit(user.id, id, !!user.isSuperAdmin);
  }

  @Post(':id/act')
  act(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActLocalSalesOrderDto,
  ) {
    return this.service.act(user.id, id, dto);
  }
}
