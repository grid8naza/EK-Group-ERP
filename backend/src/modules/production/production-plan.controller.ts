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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductionPlanService } from './production-plan.service';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateProductionPlanDto } from './production-plan.dto';

/** Production Plan — clubs pending work orders into one buildable plan. */
@ApiTags('production-plans')
@ApiBearerAuth()
@Controller('production-plans')
export class ProductionPlanController {
  constructor(private readonly service: ProductionPlanService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(companyId, search);
  }

  /** How many pending work orders are waiting — drives the New Plan button. */
  @Get('pending-count')
  pendingCount(@CompanyId() companyId: number | undefined) {
    return this.service.pendingCount(companyId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateProductionPlanDto,
  ) {
    return this.service.create(user.id, companyId, branchId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(LockPrivilegeGuard('/production/plans'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
