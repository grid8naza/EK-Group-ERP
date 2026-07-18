import { Module } from '@nestjs/common';
import { RackController } from './rack.controller';
import { RackService } from './rack.service';

@Module({
  controllers: [RackController],
  providers: [RackService],
})
export class RackModule {}
