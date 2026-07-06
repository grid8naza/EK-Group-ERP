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
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { HrGroupService } from './hr-group.service';
import { CreateHrGroupDto, UpdateHrGroupDto } from './hr-group.dto';

/**
 * Manpower Group Master — a multilayer sub-level under an HR Category. Available
 * to all or a chosen set of companies; the list is filtered to those available
 * in the active company.
 */
@ApiTags('hr-groups')
@ApiBearerAuth()
@Controller('hr-groups')
export class HrGroupController {
  constructor(private readonly service: HrGroupService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
    @Query('primaryGroupId') primaryGroupId?: string,
    @Query('parentGroupId') parentGroupId?: string,
  ) {
    // Optional numeric query params: parse with Number() (a missing value must
    // not 400 — see the query-int-parsing convention).
    const toId = (v?: string) => {
      const n = Number(v);
      return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
    };
    return this.service.findAll(companyId, {
      search,
      primaryGroupId: toId(primaryGroupId),
      parentGroupId: toId(parentGroupId),
    });
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(@Body() dto: CreateHrGroupDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHrGroupDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(companyId, id);
  }

  @UseGuards(LockPrivilegeGuard('/hr/groups'))
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}
