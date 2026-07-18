import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WorkOrderService } from './work-order.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { SetWorkOrderStatusDto } from './work-order.dto';

/** Work Order (Production) — what must be made to fulfil a sales order. */
@ApiTags('work-orders')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrderController {
  constructor(private readonly service: WorkOrderService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(companyId, search, status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetWorkOrderStatusDto,
  ) {
    return this.service.setStatus(id, dto.status);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(LockPrivilegeGuard('/production/work-orders'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
