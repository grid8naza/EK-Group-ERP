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
import { ProductModule } from './modules/product/product.module';
import { StoreModule } from './modules/store/store.module';
import { RackModule } from './modules/rack/rack.module';
import { OpeningStockModule } from './modules/opening-stock/opening-stock.module';
import { StockTransactionModule } from './modules/stock-transaction/stock-transaction.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { CustomerModule } from './modules/customer/customer.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AssetCategoryModule } from './modules/asset-category/asset-category.module';
import { AssetGroupModule } from './modules/asset-group/asset-group.module';
import { AssetModule } from './modules/asset/asset.module';
import { HrCategoryModule } from './modules/hr-category/hr-category.module';
import { HrGroupModule } from './modules/hr-group/hr-group.module';
import { HrDesignationModule } from './modules/hr-designation/hr-designation.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { ChatModule } from './modules/chat/chat.module';
import { MailModule } from './modules/mail/mail.module';
import { CrmModule } from './modules/crm/crm.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { LoginScreenModule } from './modules/login-screen/login-screen.module';
import { SoftwareInfoModule } from './modules/software-info/software-info.module';
import { DocumentModule } from './modules/document/document.module';
import { DocumentNumberingModule } from './modules/document-numbering/document-numbering.module';
import { BatchNumberingModule } from './modules/batch-numbering/batch-numbering.module';
import { ScaffoldModule } from './scaffold/scaffold.module';
import { MasterDataModule } from './master-data/master-data.module';

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
    ProductModule,
    StoreModule,
    RackModule,
    OpeningStockModule,
    StockTransactionModule,
    SupplierModule,
    CustomerModule,
    AccountsModule,
    AssetCategoryModule,
    AssetGroupModule,
    AssetModule,
    HrCategoryModule,
    HrGroupModule,
    HrDesignationModule,
    WorkflowModule,
    ChatModule,
    MailModule,
    CrmModule,
    PurchaseModule,
    VoucherModule,
    LoginScreenModule,
    SoftwareInfoModule,
    DocumentModule,
    DocumentNumberingModule,
    BatchNumberingModule,
    ScaffoldModule,

    MasterDataModule,
  ],
  providers: [
    // JWT required everywhere except routes marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
