import { Module } from '@nestjs/common';
import { HrEmployeeService } from './hr-employee.service';
import { HrEmployeeController } from './hr-employee.controller';

@Module({
  controllers: [HrEmployeeController],
  providers: [HrEmployeeService],
})
export class HrEmployeeModule {}
