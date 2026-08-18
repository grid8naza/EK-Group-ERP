import { Module } from '@nestjs/common';
import { HrShiftService } from './hr-shift.service';
import { HrRosterService } from './hr-roster.service';
import {
  HrRosterController,
  HrRosterRegisterController,
  HrShiftController,
} from './hr-shift.controller';

/**
 * Shifts and the roster (SRS §8.9, FR-HRP-01).
 *
 * The master and the series that puts people on it, together: they are one
 * subject, and a shift with nobody on it answers no question. Attendance reads
 * the roster for itself rather than importing this module — the rule every
 * module here follows about the tables of the domains it works with.
 */
@Module({
  controllers: [
    HrShiftController,
    HrRosterController,
    HrRosterRegisterController,
  ],
  providers: [HrShiftService, HrRosterService],
})
export class HrShiftModule {}
