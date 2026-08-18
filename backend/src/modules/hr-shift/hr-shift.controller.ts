import {
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
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { HrShiftService } from './hr-shift.service';
import { HrRosterService } from './hr-roster.service';
import {
  BulkAssignDto,
  CreateHrShiftDto,
  SaveShiftAssignmentDto,
  UpdateHrShiftDto,
} from './hr-shift.dto';

/** Shift Master — the named working patterns a company (or one branch) keeps. */
@ApiTags('hr-shifts')
@ApiBearerAuth()
@Controller('hr-shifts')
export class HrShiftController {
  constructor(private readonly service: HrShiftService) {}

  /**
   * The company's shifts. With a branch in context, the ones that branch can
   * see — its own, plus the company-wide ones.
   */
  @Get()
  findAll(
    @CompanyId() companyId?: number,
    @Query('branchId') branchId?: string,
    @BranchId() activeBranchId?: number,
  ) {
    const n = Number(branchId);
    const scope = Number.isFinite(n) && n > 0 ? n : activeBranchId;
    return this.service.findAll(companyId, scope);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(@Body() dto: CreateHrShiftDto, @CompanyId() companyId?: number) {
    return this.service.create(companyId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHrShiftDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.remove(companyId, id);
  }

  @UseGuards(LockPrivilegeGuard('/hr/shifts'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}

/**
 * The roster — one person's dated series of shifts.
 *
 * Under the employee it belongs to, as the postings and salary series are: it
 * is read and written from that person's record.
 */
@ApiTags('hr-shifts')
@ApiBearerAuth()
@Controller('hr-employees/:employeeId/shifts')
export class HrRosterController {
  constructor(private readonly service: HrRosterService) {}

  @Get()
  findAll(@Param('employeeId', ParseIntPipe) employeeId: number) {
    return this.service.findAll(employeeId);
  }

  @Post()
  create(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SaveShiftAssignmentDto,
  ) {
    return this.service.create(employeeId, dto);
  }

  @Put(':assignmentId')
  update(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Param('assignmentId', ParseIntPipe) assignmentId: number,
    @Body() dto: SaveShiftAssignmentDto,
  ) {
    return this.service.update(employeeId, assignmentId, dto);
  }

  @Delete(':assignmentId')
  remove(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Param('assignmentId', ParseIntPipe) assignmentId: number,
  ) {
    return this.service.remove(employeeId, assignmentId);
  }
}

/**
 * Who is on what across the company, as at a date — and the screen that sets
 * it for a list of people at once.
 */
@ApiTags('hr-reports')
@ApiBearerAuth()
@Controller('hr-rosters')
export class HrRosterRegisterController {
  constructor(private readonly service: HrRosterService) {}

  /**
   * `branchId=all` reads every branch; a number reads that one; absent falls
   * back to the branch in context. The roster screen filters by branch itself,
   * so it needs to be able to ask for more than the one the header names.
   */
  @Get()
  register(
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
    @Query('on') on?: string,
    @Query('branchId') branchFilter?: string,
  ) {
    const scope =
      branchFilter === undefined
        ? (branchId ?? null)
        : branchFilter === 'all'
          ? null
          : Number(branchFilter) || null;
    return this.service.register(companyId, scope, on);
  }

  /** Move and/or roster a whole list of people, from one day. */
  @Post('assign')
  assign(@Body() dto: BulkAssignDto, @CompanyId() companyId?: number) {
    return this.service.assignMany(companyId, dto);
  }
}
