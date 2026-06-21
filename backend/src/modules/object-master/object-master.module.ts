import { Module } from '@nestjs/common';
import { ObjectMasterService } from './object-master.service';
import { ObjectMasterController } from './object-master.controller';

@Module({
  controllers: [ObjectMasterController],
  providers: [ObjectMasterService],
})
export class ObjectMasterModule {}
