import { Module } from '@nestjs/common';
import { BatchNumberingController } from './batch-numbering.controller';
import { BatchNumberingService } from './batch-numbering.service';

@Module({
  controllers: [BatchNumberingController],
  providers: [BatchNumberingService],
})
export class BatchNumberingModule {}
