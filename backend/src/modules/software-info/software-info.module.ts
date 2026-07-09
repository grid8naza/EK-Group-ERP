import { Module } from '@nestjs/common';
import { SoftwareInfoController } from './software-info.controller';
import { SoftwareInfoService } from './software-info.service';

@Module({
  controllers: [SoftwareInfoController],
  providers: [SoftwareInfoService],
})
export class SoftwareInfoModule {}
