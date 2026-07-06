import { Module } from '@nestjs/common';
import { HrDesignationService } from './hr-designation.service';
import { HrDesignationController } from './hr-designation.controller';

@Module({
  controllers: [HrDesignationController],
  providers: [HrDesignationService],
})
export class HrDesignationModule {}
