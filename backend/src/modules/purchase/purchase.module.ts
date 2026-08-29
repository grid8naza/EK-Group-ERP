import { Module } from '@nestjs/common';
import { LpoController } from './lpo.controller';
import { LpoService } from './lpo.service';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

// The STOCK port the catalogue reads through is provided by the @Global
// ContractsModule, so there is nothing to import for it here.
@Module({
  controllers: [LpoController, CatalogueController],
  providers: [LpoService, CatalogueService],
})
export class PurchaseModule {}
