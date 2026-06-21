import { Module } from '@nestjs/common';
import { ModuleMasterService } from './module-master.service';
import { ModuleMasterController } from './module-master.controller';

@Module({
  controllers: [ModuleMasterController],
  providers: [ModuleMasterService],
})
export class ModuleMasterModule {}
