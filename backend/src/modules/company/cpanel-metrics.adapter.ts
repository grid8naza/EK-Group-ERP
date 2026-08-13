import { Injectable } from '@nestjs/common';
import { ObjectType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MetricContext,
  MetricDef,
  MetricProviderPort,
} from '../../contracts/metric-provider.port';

/**
 * The Cpanel module's metric provider. These are the configuration counts that
 * used to be the fixed "Stat" widget sources; they now live in the registry so
 * they appear ONLY under the Cpanel module (not on every module's dashboard).
 * Company-scoped where the underlying table is per-company. Registered in
 * contracts/contracts.module.ts.
 */
@Injectable()
export class CpanelMetricsAdapter implements MetricProviderPort {
  constructor(private readonly prisma: PrismaService) {}

  private objects(objectType: ObjectType) {
    return () => this.prisma.objectMaster.count({ where: { objectType } });
  }

  metrics(): MetricDef[] {
    const M = (
      key: string,
      label: string,
      compute: MetricDef['compute'],
    ): MetricDef => ({
      key,
      label,
      moduleCode: 'CPANEL',
      compute,
    });

    return [
      M('cpanel.users', 'Users', () => this.prisma.user.count()),
      M('cpanel.groups', 'User Groups', (ctx: MetricContext) =>
        this.prisma.userGroup.count({ where: { companyId: ctx.companyId } }),
      ),
      M('cpanel.modules', 'Enabled Modules', (ctx: MetricContext) =>
        this.prisma.companyModule.count({
          where: { companyId: ctx.companyId, isActive: true },
        }),
      ),
      M('cpanel.companies', 'Companies', () => this.prisma.company.count()),
      M('cpanel.forms', 'Forms', this.objects(ObjectType.FORM)),
      M('cpanel.reports', 'Reports', this.objects(ObjectType.REPORT)),
      M('cpanel.tables', 'Tables', this.objects(ObjectType.TABLE)),
      M('cpanel.dashboards', 'Dashboards', (ctx: MetricContext) =>
        this.prisma.dashboard.count({ where: { companyId: ctx.companyId } }),
      ),
    ];
  }
}
