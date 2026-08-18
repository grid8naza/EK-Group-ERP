import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceSettingsService } from './attendance-settings.service';
import { AttendanceReportService } from './attendance-report.service';
import {
  ActAttendanceDto,
  SaveAttendanceSettingDto,
  SaveAttendanceSheetDto,
  SaveHolidayDto,
} from './attendance.dto';

/**
 * Optional numbers off the query string are parsed by hand.
 *
 * ParseIntPipe with `optional: true` rejects an ABSENT parameter with a 400
 * instead of passing undefined through, which is the opposite of optional.
 */
const num = (v?: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The day's sheet: opening it, marking it, and sending it for approval. */
@ApiTags('hr-attendance')
@ApiBearerAuth()
@Controller('hr-attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  /**
   * The sheet for one day — pre-filled from the branch's working day where it
   * has never been marked, so the incharge corrects rather than enters.
   */
  @Get('sheet')
  sheet(
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.sheet(
      user.id,
      companyId!,
      branchId ?? null,
      date || new Date().toISOString().slice(0, 10),
      user.isSuperAdmin,
    );
  }

  /** Which days of a month are marked, and how far each has got. */
  @Get('month')
  month(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    const now = new Date();
    return this.service.month(
      companyId!,
      branchId ?? null,
      num(year) ?? now.getUTCFullYear(),
      num(month) ?? now.getUTCMonth() + 1,
    );
  }

  @Post('sheet')
  save(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveAttendanceSheetDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service
      .save(user.id, companyId!, branchId ?? null, dto, user.isSuperAdmin)
      .then(() =>
        this.service.sheet(
          user.id,
          companyId!,
          branchId ?? null,
          dto.date,
          user.isSuperAdmin,
        ),
      );
  }

  @Post('sheet/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Body('date') date: string,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.submit(
      user.id,
      companyId!,
      branchId ?? null,
      date,
      user.isSuperAdmin,
    );
  }

  @Post('sheet/act')
  act(
    @CurrentUser() user: AuthUser,
    @Body('date') date: string,
    @Body() dto: ActAttendanceDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.act(
      user.id,
      companyId!,
      branchId ?? null,
      date,
      dto,
      user.isSuperAdmin,
    );
  }
}

/** The rules a sheet is filled in from: the working day and the holidays. */
@ApiTags('hr-attendance')
@ApiBearerAuth()
@Controller('hr-attendance-settings')
export class AttendanceSettingsController {
  constructor(private readonly service: AttendanceSettingsService) {}

  @Get()
  findAll(@CompanyId() companyId?: number) {
    return this.service.findAll(companyId);
  }

  @Put()
  save(@Body() dto: SaveAttendanceSettingDto, @CompanyId() companyId?: number) {
    return this.service.save(companyId!, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.remove(companyId!, id);
  }
}

@ApiTags('hr-attendance')
@ApiBearerAuth()
@Controller('hr-holidays')
export class AttendanceHolidayController {
  constructor(private readonly service: AttendanceSettingsService) {}

  @Get()
  findAll(@Query('year') year?: string, @CompanyId() companyId?: number) {
    return this.service.holidays(companyId, num(year));
  }

  @Post()
  create(@Body() dto: SaveHolidayDto, @CompanyId() companyId?: number) {
    return this.service.saveHoliday(companyId!, null, dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveHolidayDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.saveHoliday(companyId!, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.removeHoliday(companyId!, id);
  }
}

/** What is read back out — the month's register and one person's time card. */
@ApiTags('hr-reports')
@ApiBearerAuth()
@Controller('hr-attendance-reports')
export class AttendanceReportController {
  constructor(private readonly service: AttendanceReportService) {}

  @Get('register')
  register(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.register(
      companyId,
      branchId ?? null,
      num(year),
      num(month),
    );
  }

  @Get('time-card')
  timeCard(
    @Query('employeeId') employeeId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @CompanyId() companyId?: number,
  ) {
    return this.service.timeCard(
      companyId,
      num(employeeId)!,
      num(year),
      num(month),
    );
  }
}
