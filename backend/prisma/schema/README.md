# Prisma schema (multi-file, per domain)

The schema is split across this folder using Prisma's `prismaSchemaFolder`
feature. Prisma concatenates every `*.prisma` file here, so relations may
*technically* cross files — **but the ownership rule below forbids that across
domains**. The split mirrors the NestJS module boundaries and is what makes a
module's tables extractable into their own database later.

## Files

| File             | Owns                                              |
| ---------------- | ------------------------------------------------- |
| `schema.prisma`  | datasource + generator (shared base)              |
| `enums.prisma`   | shared enums                                      |
| `cpanel.prisma`  | the Cpanel module's tables (everything, for now)  |
| `crm.prisma`     | *(future)* CRM module tables                      |
| `accounts.prisma`| *(future)* Accounts module tables                 |

## The ownership rule

1. **Each model belongs to exactly one domain file** — the module that owns it.
2. **A `@relation` (real FK) may only point to a model in the SAME domain file.**
   Across domains, store a **plain id column** (e.g. `assignedUserId Int`) with
   **no `@relation`**. A cross-domain FK cannot survive when a module moves to
   its own database, so we don't create one.

### Why is everything in `cpanel.prisma` today?

Because every current table is FK-connected to the rest of Cpanel — so it is,
correctly, a single domain. When CRM/Accounts/Inventory/HR arrive, each gets its
own file here and references Cpanel data (users, companies, modules) **by id**,
never by FK. That keeps the new module's tables a clean, liftable unit.

## Commands

`package.json` points Prisma at this folder (`"prisma": { "schema":
"prisma/schema" }`), so the usual commands just work:

```bash
npx prisma validate
npx prisma db push
npx prisma generate
```
