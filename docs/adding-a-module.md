# Adding a module to the ERP

The backend is a **modular monolith**: one NestJS deployment, internally split
into isolated modules so any module can later be lifted into its own service
without rewriting its logic. Follow this checklist and every guardrail
(`lint:boundaries`, build, CI boot smoke test) stays green.

> The rules exist so dependencies between modules can never silently break. If
> you skip a step, CI tells you exactly where.

## The two hard rules

1. **No feature module imports another feature module.** A module in
   `src/modules/<x>` must never import from `src/modules/<y>`. To use another
   module's data/behaviour, depend on a **port** in `src/contracts/`.
   _Enforced by `npm run lint:boundaries`._
2. **No foreign keys across domains in Prisma.** Your module's tables go in
   their own `prisma/schema/<x>.prisma` file. A `@relation` may only point to a
   model in the **same** file. To reference another domain (e.g. a user), store
   a plain id column (`assignedUserId Int`) — never a `@relation`.
   _A cross-domain FK can't survive when the module moves to its own database._

## Steps

### 1. Create the NestJS module

```
src/modules/crm/
  crm.module.ts
  enquiry.controller.ts
  enquiry.service.ts
  enquiry.dto.ts
```

`enquiry.service.ts` may import only: its own files, `src/prisma`,
`src/common`, `src/auth`, and `src/contracts`. **Nothing from another
`src/modules/*`.**

### 2. Register it in `app.module.ts`

Add `CrmModule` to the `imports` array. That's the only wiring needed — the
`@Global ContractsModule` makes every port injectable without extra imports.

### 3. Need another module's data? Use a port (don't import it)

Inject the existing port:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { USER_LOOKUP, UserLookupPort } from '../../contracts/user-lookup.port';

@Injectable()
export class EnquiryService {
  constructor(@Inject(USER_LOOKUP) private readonly users: UserLookupPort) {}
  // ...
}
```

If you need data no port exposes yet, **add a port** (see
`src/contracts/README.md`): define `contracts/<thing>.port.ts`, implement an
adapter inside the **owning** module, and bind it in `contracts/contracts.module.ts`.

### 4. Add your tables in a new domain file

Create `prisma/schema/crm.prisma`:

```prisma
model Enquiry {
  id             Int      @id @default(autoincrement())
  companyId      Int      // -> Cpanel Company, by id (NO @relation)
  assignedUserId Int?     // -> Cpanel User, by id (NO @relation)
  subject        String
  createdAt      DateTime @default(now())

  @@map("crm_enquiries")
}
```

Then sync + regenerate the client:

```bash
docker compose -f docker-compose.dev.yml exec backend npx prisma db push
docker compose -f docker-compose.dev.yml exec backend npx prisma generate
```

### 5. Verify locally before pushing

```bash
docker compose -f docker-compose.dev.yml exec backend npm run lint:boundaries
docker compose -f docker-compose.dev.yml exec backend npm run build
docker compose -f docker-compose.dev.yml restart backend   # confirms DI resolves at boot
```

Then hit one of your new routes to confirm it works end to end.

## What CI checks for you

`.github/workflows/ci.yml` runs on every PR:

- **Module boundaries** — fails if you added a cross-module import.
- **Build** — TypeScript + the boundary check again (via the `prebuild` hook).
- **Boot smoke test** — actually starts the API against Postgres and logs in.
  This is what catches a **dependency-injection error** (an unresolved provider
  in your module): it compiles fine but the server won't boot, so CI goes red
  with a clear message instead of failing in production.

## Extracting a module later (the payoff)

Because the module only ever talked to others through ports:

1. Move `src/modules/crm` + `prisma/schema/crm.prisma` into a new service.
2. In the old monolith, repoint the ports it consumed at remote clients (only
   the bindings in `contracts.module.ts` change).
3. The module's internal code is untouched.
