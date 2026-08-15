import { Module } from '@nestjs/common';
import { HrEmployeeService } from './hr-employee.service';
import { HrEmployeeController } from './hr-employee.controller';
import { HrSalaryService } from './hr-salary.service';
import { HrSalaryController } from './hr-salary.controller';
import { HrPostingService } from './hr-posting.service';
import { HrPostingController } from './hr-posting.controller';

@Module({
  controllers: [HrEmployeeController, HrSalaryController, HrPostingController],
  providers: [HrEmployeeService, HrSalaryService, HrPostingService],
})
export class HrEmployeeModule {}
