import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { ContractsModule } from './contracts/contracts.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ModuleMasterModule } from './modules/module-master/module-master.module';
import { LookupModule } from './modules/lookup/lookup.module';
import { CompanyModule } from './modules/company/company.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { ObjectMasterModule } from './modules/object-master/object-master.module';
import { MenuModule } from './modules/menu/menu.module';
import { UserGroupModule } from './modules/user-group/user-group.module';
import { UserModule } from './modules/user/user.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { GadgetModule } from './modules/gadget/gadget.module';
import { ProductionModule } from './modules/production/production.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ContractsModule,
    AuthModule,
    ModuleMasterModule,
    LookupModule,
    CompanyModule,
    CurrencyModule,
    ObjectMasterModule,
    MenuModule,
    UserGroupModule,
    UserModule,
    DashboardModule,
    GadgetModule,
    ProductionModule,
  ],
  providers: [
    // JWT required everywhere except routes marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
