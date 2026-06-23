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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { CompanyId } from '../../auth/company.decorator';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateDashboardDto,
  SaveLayoutDto,
  SetWidgetsDto,
  UpdateDashboardDto,
} from './dashboard.dto';

function requireCompany(companyId?: number): number {
  if (!companyId) throw new BadRequestException('No active company selected');
  return companyId;
}

@ApiTags('dashboards')
@ApiBearerAuth()
@Controller('dashboards')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  findAll(@CompanyId() companyId?: number, @Query('moduleId') moduleId?: string) {
    return this.service.findAll(
      requireCompany(companyId),
      moduleId ? Number(moduleId) : undefined,
    );
  }

  // Gadget catalog for a module (to pick widgets when editing a dashboard).
  @Get('gadgets')
  gadgets(
    @CompanyId() companyId: number | undefined,
    @Query('moduleId') moduleId?: string,
  ) {
    if (!moduleId) throw new BadRequestException('moduleId is required');
    return this.service.gadgetCatalog(requireCompany(companyId), Number(moduleId));
  }

  @Post()
  create(@Body() dto: CreateDashboardDto, @CompanyId() companyId?: number) {
    return this.service.create(dto, requireCompany(companyId));
  }

  @Get(':id')
  getOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getOne(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a dashboard (must be unlocked before edit or delete).
  @UseGuards(SuperAdminGuard)
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(id, dto.locked);
  }

  // Admin: set the default widget set + order for a dashboard.
  @Put(':id/widgets')
  setWidgets(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetWidgetsDto,
  ) {
    return this.service.setWidgets(id, dto);
  }

  // Current user's personal arrangement (drag-and-drop).
  @Put(':id/my-layout')
  saveLayout(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveLayoutDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.saveLayout(id, user.id, dto);
  }

  @Delete(':id/my-layout')
  resetLayout(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resetLayout(id, user.id);
  }
}
