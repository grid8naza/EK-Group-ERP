import { Module } from '@nestjs/common';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';
import { MetricRegistryService } from './metric-registry.service';

@Module({
  controllers: [WidgetController],
  providers: [WidgetService, MetricRegistryService],
})
export class WidgetModule {}
