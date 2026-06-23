import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

// USER_LOOKUP is injected from the @Global ContractsModule, so no import of the
// User module is needed here — that keeps Production independently extractable.
@Module({
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
