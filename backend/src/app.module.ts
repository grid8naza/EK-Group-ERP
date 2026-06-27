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
import { BranchModule } from './modules/branch/branch.module';
import { CostCenterModule } from './modules/cost-center/cost-center.module';
import { CostObjectModule } from './modules/cost-object/cost-object.module';
import { ObjectMasterModule } from './modules/object-master/object-master.module';
import { MenuModule } from './modules/menu/menu.module';
import { UserGroupModule } from './modules/user-group/user-group.module';
import { UserModule } from './modules/user/user.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WidgetModule } from './modules/widget/widget.module';
import { ProductionModule } from './modules/production/production.module';
import { BackupModule } from './modules/backup/backup.module';
import { UnitModule } from './modules/unit/unit.module';
import { CategoryModule } from './modules/category/category.module';
import { GroupModule } from './modules/group/group.module';
import { HsnModule } from './modules/hsn/hsn.module';
import { ItemModule } from './modules/item/item.module';

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
    BranchModule,
    CostCenterModule,
    CostObjectModule,
    ObjectMasterModule,
    MenuModule,
    UserGroupModule,
    UserModule,
    DashboardModule,
    WidgetModule,
    ProductionModule,
    BackupModule,
    UnitModule,
    CategoryModule,
    GroupModule,
    HsnModule,
    ItemModule,
  ],
  providers: [
    // JWT required everywhere except routes marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
