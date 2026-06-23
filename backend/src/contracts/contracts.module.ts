import { Global, Module } from '@nestjs/common';
import { USER_LOOKUP } from './user-lookup.port';
import { UserLookupAdapter } from '../modules/user/user-lookup.adapter';

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
 */
@Global()
@Module({
  providers: [{ provide: USER_LOOKUP, useClass: UserLookupAdapter }],
  exports: [USER_LOOKUP],
})
export class ContractsModule {}
