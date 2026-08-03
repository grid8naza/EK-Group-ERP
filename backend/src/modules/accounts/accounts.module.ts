import { Module } from '@nestjs/common';
import { CoaController } from './coa.controller';
import { CoaService } from './coa.service';
import { CoaSeedService } from './coa-seed.service';

/**
 * The accounting master data from Annexure D. Separate from the supplier module,
 * which happens to sit in the same Accounts menu but is procurement data.
 */
@Module({
  controllers: [CoaController],
  providers: [CoaService, CoaSeedService],
})
export class AccountsModule {}
