import { Module } from '@nestjs/common';
import { LookupService } from './lookup.service';
import {
  LookupController,
  LookupValueController,
} from './lookup.controller';

@Module({
  controllers: [LookupController, LookupValueController],
  providers: [LookupService],
})
export class LookupModule {}
