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
import { ProductionReceiptService } from './production-receipt.service';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { RecordProductionDto } from './production-receipt.dto';

/** Production Receipt — finished goods banked into stock from a work order. */
@ApiTags('production-receipts')
@ApiBearerAuth()
@Controller('production-receipts')
export class ProductionReceiptController {
  constructor(private readonly service: ProductionReceiptService) {}

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

  /** Record production for a work order (banks finished goods into stock). */
  @Post('from-work-order/:workOrderId')
  record(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Param('workOrderId', ParseIntPipe) workOrderId: number,
    @Body() dto: RecordProductionDto,
  ) {
    return this.service.recordFromWorkOrder(
      user.id,
      companyId,
      branchId,
      workOrderId,
      dto,
    );
  }

  @UseGuards(LockPrivilegeGuard('/production/receipts'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
