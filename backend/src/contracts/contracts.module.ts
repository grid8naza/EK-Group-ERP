import { Global, Module } from '@nestjs/common';
import { USER_LOOKUP } from './user-lookup.port';
import { UserLookupAdapter } from '../modules/user/user-lookup.adapter';
import { WORKFLOW } from './workflow.port';
import { WorkflowRuntimeAdapter } from '../modules/workflow/workflow-runtime.adapter';
import { WorkflowRuntimeService } from '../modules/workflow/workflow-runtime.service';
import { METRIC_PROVIDER } from './metric-provider.port';
import { CpanelMetricsAdapter } from '../modules/company/cpanel-metrics.adapter';
import { ProductionMetricsAdapter } from '../modules/production/production-metrics.adapter';
import { InventoryMetricsAdapter } from '../modules/item/inventory-metrics.adapter';
import { NUMBERING } from './numbering.port';
import { DocumentNumberingService } from '../modules/document-numbering/document-numbering.service';

/**
 * Composition root for cross-module contracts (ports & adapters).
 *
 * Each port token is bound here to the in-process adapter owned by the module
 * that implements it. This module is @Global, so ANY feature module can inject
 * a port token WITHOUT importing the providing module. That import-level
 * isolation is exactly what keeps modules independently extractable, and it is
 * enforced by `npm run lint:boundaries`.
 *
 * To extract a module later: change only the binding below (point the token at
 * a remote client) — consumers are untouched.
 *
 * Adding a new contract:
 *   1. Define the port + token in contracts/<name>.port.ts
 *   2. Implement it as an adapter inside the OWNING module's folder
 *   3. Bind the token to the adapter here and add the token to `exports`
 *
 * METRIC_PROVIDER resolves to the ARRAY of every module's metric adapter, built
 * by a factory (NestJS has no Angular-style multi-providers). MetricRegistryService
 * injects that array. Add a module's metrics by registering its adapter below
 * and adding it to the factory's inject list + returned array.
 */
@Global()
@Module({
  providers: [
    { provide: USER_LOOKUP, useClass: UserLookupAdapter },
    // Workflow runtime bound here (with its service) so any business module can
    // start/cancel an approval via the WORKFLOW port without importing the
    // Workflow module. Its own instance for the port; the REST controller keeps
    // WorkflowModule's instance (both stateless).
    WorkflowRuntimeService,
    { provide: WORKFLOW, useClass: WorkflowRuntimeAdapter },
    // Central per-company document numbering, exposed so any document module can
    // fetch its next number via the NUMBERING port (no cross-module import).
    DocumentNumberingService,
    { provide: NUMBERING, useExisting: DocumentNumberingService },
    CpanelMetricsAdapter,
    ProductionMetricsAdapter,
    InventoryMetricsAdapter,
    {
      provide: METRIC_PROVIDER,
      useFactory: (
        cpanel: CpanelMetricsAdapter,
        production: ProductionMetricsAdapter,
        inventory: InventoryMetricsAdapter,
      ) => [cpanel, production, inventory],
      inject: [
        CpanelMetricsAdapter,
        ProductionMetricsAdapter,
        InventoryMetricsAdapter,
      ],
    },
  ],
  exports: [USER_LOOKUP, METRIC_PROVIDER, WORKFLOW, NUMBERING],
})
export class ContractsModule {}
