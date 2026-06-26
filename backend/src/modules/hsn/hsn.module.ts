import { Module } from '@nestjs/common';
import { HsnService } from './hsn.service';
import { HsnController } from './hsn.controller';

@Module({
  controllers: [HsnController],
  providers: [HsnService],
})
export class HsnModule {}
