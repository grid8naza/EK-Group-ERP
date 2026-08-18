import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceSettingsService } from './attendance-settings.service';
import { AttendanceReportService } from './attendance-report.service';
import {
  AttendanceController,
  AttendanceHolidayController,
  AttendanceReportController,
  AttendanceSettingsController,
} from './attendance.controller';

/**
 * Attendance — the daily sheet, the rules it is filled in from, and the two
 * reports read back off it.
 *
 * Its own module rather than another few files under hr-employee: this is a
 * TRANSACTION (a document per branch per day, with an approval behind it) where
 * that one is a master, and it is the piece a punching machine will one day
 * write into. It reads the employee table directly, as every module here reads
 * the tables of the domains it works with, but imports nothing from hr-employee
 * — the workflow it needs comes through the contracts port.
 */
@Module({
  controllers: [
    AttendanceController,
    AttendanceSettingsController,
    AttendanceHolidayController,
    AttendanceReportController,
  ],
  providers: [
    AttendanceService,
    AttendanceSettingsService,
    AttendanceReportService,
  ],
})
export class HrAttendanceModule {}
