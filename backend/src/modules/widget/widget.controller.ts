import {
  BadRequestException,
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
import { WidgetService } from './widget.service';
import { MetricRegistryService } from './metric-registry.service';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateWidgetDto,
  MetricValuesDto,
  UpdateWidgetDto,
} from './widget.dto';

function requireCompany(companyId?: number): number {
  if (!companyId) throw new BadRequestException('No active company selected');
  return companyId;
}

@ApiTags('widgets')
@ApiBearerAuth()
@Controller('widgets')
export class WidgetController {
  constructor(
    private readonly service: WidgetService,
    private readonly metrics: MetricRegistryService,
  ) {}

  @Get()
  findAll(
    @CompanyId() companyId?: number,
    @Query('moduleId') moduleId?: string,
  ) {
    return this.service.findAll(
      requireCompany(companyId),
      moduleId ? Number(moduleId) : undefined,
    );
  }

  // Named metrics available for a module's METRIC widgets (the builder's
  // metric dropdown).
  @Get('metrics')
  metricCatalog(
    @CompanyId() companyId?: number,
    @Query('moduleId') moduleId?: string,
  ) {
    requireCompany(companyId);
    if (!moduleId) throw new BadRequestException('moduleId is required');
    return this.metrics.listForModule(Number(moduleId));
  }

  // Compute metric values for the active company/branch (the dashboard
  // renderer batches all its METRIC widgets' keys here).
  @Post('metric-values')
  metricValues(
    @Body() dto: MetricValuesDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.metrics.computeMany(dto.keys, {
      companyId: requireCompany(companyId),
      branchId: branchId ?? null,
    });
  }

  @Post()
  create(@Body() dto: CreateWidgetDto, @CompanyId() companyId?: number) {
    return this.service.create(dto, requireCompany(companyId));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWidgetDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a widget (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/cpanel/widgets'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}
