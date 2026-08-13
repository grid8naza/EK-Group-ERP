# Contracts (ports & adapters)

This folder is the **only sanctioned way for one module to use another module's
data or behaviour**. Direct imports between feature modules are forbidden and
fail `npm run lint:boundaries`.

## Why

The whole backend ships as a single NestJS deployment (a modular monolith), but
every module must stay **independently extractable** into its own service later
_without rewriting its internal logic_. The thing that makes that possible is
keeping modules decoupled at the import level: a module never reaches into
another module's services or entities — it depends on a small, stable
**interface** (a "port") instead.

```
consumer module ──depends on──▶ contracts/<x>.port.ts  (interface + token)
                                          ▲
owning module ──implements──────  modules/<x>/<x>.adapter.ts
                                          ▲
                                contracts/contracts.module.ts  (binds token → adapter, @Global)
```

When a module is extracted, only the **binding** in `contracts.module.ts`
changes (token now points at a remote/HTTP client that implements the same
port). Consumers don't change at all.

## Files

- `*.port.ts` — an interface + a DI token + the small serializable types that
  cross the boundary. No Prisma types, no full entities.
- `contracts.module.ts` — `@Global` composition root binding each token to the
  in-process adapter owned by the implementing module.
- The **adapter** lives in the owning module's folder (e.g.
  `modules/user/user-lookup.adapter.ts`), because the implementation is that
  module's responsibility.

## Consuming a port (example: a future CRM module)

```ts
import { Inject, Injectable } from '@nestjs/common';
import { USER_LOOKUP, UserLookupPort } from '../../contracts/user-lookup.port';

@Injectable()
export class EnquiryService {
  // No import of the User module anywhere — only the port + token.
  constructor(@Inject(USER_LOOKUP) private readonly users: UserLookupPort) {}

  async assign(enquiryId: number, userId: number, companyId: number) {
    if (!(await this.users.canAccessCompany(userId, companyId))) {
      throw new Error('User cannot access this company');
    }
    // ...store enquiry.assignedUserId = userId (a plain id, NOT a FK to users)
  }
}
```

Because `ContractsModule` is `@Global`, the CRM module injects `USER_LOOKUP`
without importing anything from `modules/user`.

## Adding a new contract

1. Create `contracts/<name>.port.ts` with the interface + a `Symbol` token.
2. Implement it as `modules/<owner>/<name>.adapter.ts` (imports allowed there:
   `prisma` and `contracts` only).
3. Bind the token to the adapter in `contracts.module.ts` and add it to
   `exports`.
4. Run `npm run lint:boundaries` — it stays green.
