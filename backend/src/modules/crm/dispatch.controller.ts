import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DispatchService } from './dispatch.service';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateDispatchDto } from './dispatch.dto';

/** Dispatch — ship an approved sales order with its travelling documents. */
@ApiTags('dispatches')
@ApiBearerAuth()
@Controller('dispatches')
export class DispatchController {
  constructor(private readonly service: DispatchService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(companyId, search);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** Dispatch an approved sales order (one dispatch per order). */
  @Post('from-sales-order/:salesOrderId')
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Param('salesOrderId', ParseIntPipe) salesOrderId: number,
    @Body() dto: CreateDispatchDto,
  ) {
    return this.service.create(user.id, companyId, branchId, salesOrderId, dto);
  }

  @UseGuards(LockPrivilegeGuard('/crm/dispatch'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
