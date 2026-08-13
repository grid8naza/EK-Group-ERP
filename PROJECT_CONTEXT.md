# EK-Group-ERP ("Erp Grid8") — Project Context

_Authoritative current-state snapshot. Rewritten **2026-07-12** after a full
code study; supersedes the 2026-06-27 version, which described only Cpanel +
Inventory and wrongly said the Workflow Engine was excluded._

> ⚠️ **Branch note:** `main` is **stale** — it sits at the merge-base. All real
> work (≈183 commits) lives on **`control-panel-setup`**, which is the working
> trunk. Read/verify against that branch, not `main`.

## What it is

A **modular ERP platform** (multi-company, multi-branch). Modules are
enabled/disabled per company — disabling one hides its menus and revokes its
privileges without deleting data. Two categories of module:

- **Core** — `Cpanel` (Control Panel): universal, super-admin only, configures
  the whole app.
- **User modules** — company-scoped, chosen per company: **Inventory**,
  **Production**, **Asset**, **HR**, **CRM**, **Accounts**, **Workflow**.

Migrated from an older PHP app. Key change: the old app stored a `.php` filename
as an object's path; this app stores an application **route** (e.g.
`/inventory/items`) on `ObjectMaster`/`SubMenu`. Unlike the original spec, a full
**Workflow/approval engine _is_ built** (see below).

## Stack

| Layer    | Tech                                             |
| -------- | ------------------------------------------------ |
| Frontend | Next.js 14 (App Router) + Tailwind CSS           |
| Backend  | NestJS (TypeScript) — modular monolith           |
| ORM      | Prisma (multi-file schema, `prismaSchemaFolder`) |
| Database | PostgreSQL 16                                    |
| Runtime  | Docker + docker-compose                          |

Design: warm tan/brown brand palette in light, slate in dark; full light+dark.
Data entry opens in **right-side drawers** (never modals); modals are only for
confirms/info. Auth: Layer-1 password + JWT, privilege-gated.

## Architecture rules (the guardrails)

1. **No feature module imports another feature module.** Cross-module use goes
   through a **port** in `backend/src/contracts/` (DI token + interface;
   implementing module owns the adapter; `contracts.module.ts` binds them).
   Enforced by `npm run lint:boundaries`.
2. **No cross-domain FKs in Prisma.** Each domain has its own
   `prisma/schema/<domain>.prisma`; a `@relation` may only point within the same
   file. Across domains, store a plain id column (`companyId Int`, `productId
Int`) with no `@relation`. Keeps a module extractable into its own DB later.

Defined ports today: `user-lookup`, `numbering` (document numbering),
`batch-numbering`, `workflow`, `metric-provider` (dashboard metrics).

## Multi-tenant model

- Each **Company** is an isolated tenant; cpanel config (objects, menus, groups,
  widgets, dashboards) and most masters carry `companyId`. Global catalogs:
  Module list, some masters via `*Company` join tables.
- **Branch** is a context selector for branch-applicable companies; scopes
  dashboards and batch numbering, partitions some stock data.
- Context flows client→server via **`X-Company-Id`** / **`X-Branch-Id`** headers
  (+ `Authorization: Bearer`). Switching company/branch re-fetches `/auth/me` and
  recomputes nav + permissions + dashboards.

## Modules & what they own

### Cpanel (core)

Company, Branch, Currency, Cost Center, Cost Object, Module Master, Object Master
(+revisions), Menu (main/sub) setup, Users, User Groups & Privileges (per-route
action flags: view/add/edit/delete/lock/print/pdf/excel), Lookups, Dashboards &
Widgets builders, Login-screen branding, Software Info, Document Master,
**Document Numbering** (per company), **Batch Numbering** (per company+branch),
Backup/Restore (gated by high-security password).

### Inventory

Unit (simple/compound/chaining), Category, Group (multilayer), HSN/GST, Item (raw
material), Product (packed/unpacked; recipe + packing BOM), Store, **Opening
Stock** (4 screens by material type → `StockLedger`+`StockBatch`), **Stock
Transactions / Inventory Vouchers**: GRN (purchase in), Delivery Note (sale out),
Goods Issue Note (consumption out), Purchase Return, Sales Return. Universal
`StockLedger` (one row per movement) + `StockBatch` lots.

### Production

**Recipe Master** — for products flagged `hasRecipe`: ingredient BOM + ordered
process flow (steps, time, machine→Asset) + manpower (designation→HR × workers) +
material/labour/overhead costing. **Packing Master** — for `hasPacking` products:
how a packed product is assembled from unpacked source products, with
Inter-Co/Wholesale/Retail pricing + GST + MRP. Plus Production Orders
(planned→in-progress→completed).

### Asset

Asset Category, Asset Group (multilayer ≤5), Asset (machine, cost/hour), Asset
Bookings (machine time-slots during production planning).

### HR / Manpower

Manpower Category, Group (multilayer), Designation (has `ratePerHour`, feeds
recipe costing).

### CRM

Inter-company Purchase Orders (PO-IC) and Sales Orders, driven by the workflow
engine.

### Accounts

Supplier/vendor master (`SUP-####`), referenced by GRNs.

### Workflow

Configurable document-approval engine: per (company+branch+module+form) an
ordered chain of steps (approver users/group, form- or numeric-field-gated,
cross-company/branch routing). Runtime instances raise inbox tasks, write an
immutable action log, push in-app notifications; a reusable status vocabulary
drives listing icons. Admin UI in Cpanel (`workflows`, `approval-statuses`);
user inbox at `/workflow/approvals`.

## Repo layout

```
.
├── backend/                         NestJS API + Prisma
│   ├── prisma/schema/               schema, enums, cpanel, inventory, production,
│   │                                asset, hr, crm, accounts, workflow (+README)
│   ├── prisma/seed.ts               super admin + modules + menus + sample data
│   └── src/
│       ├── main.ts  app.module.ts
│       ├── auth/                    JWT login, guards, buildProfile (nav+perms)
│       ├── contracts/               cross-module ports + adapters
│       ├── common/                  prisma exception filter, lock helpers, codes
│       ├── prisma/                  PrismaService (global)
│       └── modules/                 one folder per feature area (see above)
├── frontend/                        Next.js 14 app
│   └── src/
│       ├── app/(app)/{cpanel,inventory,production,asset,hr,crm,accounts,
│       │              workflow,dashboard}/…/page.tsx
│       ├── components/{layout,ui,dashboard,inventory,crm,lookups}/
│       ├── providers/               Auth, Theme, Toast, Confirm, SoftwareInfo
│       └── lib/                     api client, types, hooks, useLock, nav, icons
├── docker-compose.yml / .dev.yml
├── docs/                            adding-a-module.md, user manuals
└── reference images/               original PHP screens + design spec
```

### Key shared frontend pieces

- `ui/DataTable.tsx` — every listing (sort, search, paginate, column drag/toggle,
  row actions View→Edit→Delete→Lock, bulk-lock).
- `ui/Drawer.tsx` + `DrawerFooter` — right-side entry drawer; standard
  Save / Save&New / Save&Close / Cancel with Ctrl+S / Ctrl+Shift+S / Ctrl+Enter.
- `ui/Field.tsx`, `ReadOnlyFieldset.tsx` — form controls + view-mode disabling.
- `lib/api.ts` — fetch wrapper injecting auth + company/branch headers; global 401.
- `providers/AuthProvider.tsx` — session/nav/permissions source of truth; `can()`.

## How to run (Docker — recommended)

```bash
cp .env.example .env
docker compose up --build      # db → backend (prisma db push + seed) → frontend
# fresh slate: docker compose down -v first
```

- Web: http://localhost:3000
- API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- Hot-reload dev: `docker-compose.dev.yml`

### Default login (seeded)

```
Username: superadmin
Password: Admin@123
```

### Validate without full stack

```bash
cd backend && npm install && npx prisma generate && npm run build   # nest build + lint:boundaries
cd ../frontend && npm install && npm run build
```

## CI (`.github/workflows/ci.yml`, per PR)

Module-boundary check → build (TS + boundaries via prebuild) → **boot smoke
test** (starts API against Postgres and logs in — catches DI errors).
