import { Module } from '@nestjs/common';
import { HrEmployeeService } from './hr-employee.service';
import { HrEmployeeController } from './hr-employee.controller';
import { HrSalaryService } from './hr-salary.service';
import { HrSalaryController } from './hr-salary.controller';

@Module({
  controllers: [HrEmployeeController, HrSalaryController],
  providers: [HrEmployeeService, HrSalaryService],
})
export class HrEmployeeModule {}
