import { Module } from '@nestjs/common';
import { HrEmployeeService } from './hr-employee.service';
import { HrEmployeeController } from './hr-employee.controller';
import { HrSalaryService } from './hr-salary.service';
import { HrSalaryController } from './hr-salary.controller';
import { HrPostingService } from './hr-posting.service';
import { HrPostingController } from './hr-posting.controller';
import { HrRegisterService } from './hr-register.service';
import {
  HrPostingRegisterController,
  HrSalaryRegisterController,
} from './hr-register.controller';

@Module({
  controllers: [
    HrEmployeeController,
    HrSalaryController,
    HrPostingController,
    HrPostingRegisterController,
    HrSalaryRegisterController,
  ],
  providers: [
    HrEmployeeService,
    HrSalaryService,
    HrPostingService,
    HrRegisterService,
  ],
})
export class HrEmployeeModule {}
