# Erp Grid8 — Build Progress / Resume Notes

_Tracks what's built so work can resume across sessions._

---

## ⚡ Update 2026-07-12 (corrections to the 2026-06-27 notes below)

The detailed status further down is a **2026-06-27** snapshot and is now
partly out of date. Current reality (see `PROJECT_CONTEXT.md` for the full map):

- **Branch:** all work lives on **`control-panel-setup`** (≈183 commits ahead of
  `main`; `main` is stale at the merge-base). Work/verify against that branch.
- **Workflow Engine is BUILT** (the earlier "intentionally excluded" note is
  obsolete): configurable per-document approval chains, runtime tasks/inbox,
  immutable action log, in-app notifications, reusable status vocabulary. UI in
  Cpanel (`workflows`, `approval-statuses`) + user inbox `/workflow/approvals`.
- **New user modules since June 27:** **Production** (Recipe Master, Packing
  Master, Production Orders), **Asset** (categories/groups/assets + bookings),
  **HR** (categories/groups/designations w/ hourly rate), **CRM** (inter-company
  Purchase Orders + Sales Orders), **Accounts** (Supplier master), **Workflow**.
- **Inventory grew:** Product master (recipe/packing BOM), Store master, Opening
  Stock (4 screens by material type), Stock Transactions / Inventory Vouchers
  (GRN, Delivery Note, Goods Issue, Purchase/Sales Return), `StockLedger` +
  `StockBatch` lots, per-branch product stock.
- **New Cpanel:** Document Master + **Document Numbering** (per company) and
  **Batch Numbering** (per company+branch), Software Info singleton, Login-screen
  branding, per-company logo.
- **New contract ports:** `numbering`, `batch-numbering`, `workflow`,
  `metric-provider` (in addition to `user-lookup`).
- **Prisma schema split** now spans: `cpanel, inventory, production, asset, hr,
  crm, accounts, workflow, enums, schema`.

The section below is retained as historical context; treat conflicts in its
favour of this block.

---

## What Erp Grid8 is

A **modular ERP**. Modules can be enabled/disabled wholesale per company
(disabling hides a module's menus + revokes its privileges without deleting
data). Two modules are live today:

- **Cpanel** (control panel, core) — configures the whole app: Object Master,
  Menu Setup, User Groups & Privileges, Company Master, Currency Master,
  Lookups, Module Master, Users & Data Security, Backup & Restore, and the
  **Dashboards** + **Widgets** builders.
- **Inventory** (user module) — Unit Master, Category Master, Group Master,
  HSN Code Master, Item Master.

### Decisions locked in
- **Backend:** NestJS (TypeScript), separate container. **DB/ORM:** PostgreSQL +
  Prisma (schema split under `prisma/schema/`: `cpanel`, `inventory`,
  `production`, `enums`). **Frontend:** Next.js 14 (App Router) + Tailwind.
- **Theme:** neutral slate + blue, light **and** dark. Forms open in **side
  drawers** (never modals).
- **Multi-company:** each Company is an isolated tenant; cpanel config tables
  (objects, menus, groups, widgets, dashboards) carry a `companyId`. The Module
  catalog, Lookups, Units, HSN, Categories/Groups/Items masters are global;
  which modules are enabled is per company via `CompanyModule`.
- **Core vs user modules:** core (Cpanel) is universal + super-admin-only; user
  modules are company-scoped and chosen per company.
- **Branches:** a branch is a context selector (flows via `X-Branch-Id` like
  `X-Company-Id`); it partitions no business data yet but does scope dashboards.
- **Module isolation:** no cross-module imports (use `src/contracts` ports), no
  cross-domain Prisma FKs — enforced by `npm run lint:boundaries`.
- **PHP → route migration:** objects store an app `route`, not a `.php` file.
  **Workflow Engine intentionally excluded.**
- **Auth:** Layer-1 password + JWT, privilege-gated. Backup/restore is gated by
  a separate "high security password".

### Default login (seeded)
```
username: superadmin
password: Admin@123
```

---

## Dashboards & Widgets model (reworked 2026-06-27)

Fully admin-configured; nothing is auto-seeded. The chain is:

**user group → (dashboards, per module & branch) → (widgets on each dashboard)**

- **Widget** (`widgets` table, per company + module) — a dashboard tile. Types
  are data-driven (`WidgetType`: `STAT` / `LINKS` / `NOTE` / `EMBED`), each with
  a `config` JSON. Created from **Cpanel → Widgets**; blank to start, any number
  per module. (The old `Gadget`/`GadgetType`/`BUILTIN` naming is gone — it is
  "widget" everywhere now.)
- **Dashboard** (`dashboards`, per company + module, optional `branchId`) — a
  named board. Created from **Cpanel → Dashboards**; widgets are placed on it
  via `DashboardWidget` (drag-ordered, with a width hint).
- **GroupDashboard** (M:N) — which dashboards a user group sees. Set from the
  **User Groups → Privileges** drawer's per-module **Dashboards** checklist.
  Selecting two or more dashboards in a module makes all of them appear in that
  module's dashboard menu. (Replaced the old single `Dashboard.userGroupId` and
  the dropped per-group widget gating `GroupGadget`.)
- **UserDashboardLayout** — a user's personal drag-and-drop arrangement of a
  dashboard's widgets.

`auth.service.buildProfile` returns, per visible module, the dashboards filtered
by company + active branch + the user's `GroupDashboard` selection (super admins
see all). Switching company / branch / module recomputes the payload, so
dashboards change with context automatically. New companies/modules are
provisioned with **zero** dashboards/widgets — admins build them.

---

## Status by area

| Area | Status | Notes |
| --- | --- | --- |
| Repo scaffold (compose, .env, .gitignore, README) | ✅ Done | `.env` present; `docker compose up` works out of the box |
| Prisma schema (cpanel + inventory + production + enums) | ✅ Done | `backend/prisma/schema/` |
| Backend foundation (main, app.module, PrismaService, Swagger, global JWT guard) | ✅ Done | |
| Auth + privilege/navigation builder | ✅ Done | `/auth/login`, `/auth/me`; company + branch context |
| Cpanel backend modules (company, module, lookup, object, menu, user-group, user, currency, branch, cost-center, cost-object, backup) | ✅ Done & build-verified | |
| Dashboards & Widgets (reworked) | ✅ Done & **smoke-tested** | M:N group→dashboard, widget rename, blank provisioning |
| Inventory backend (unit, category, group, hsn, item) + provisioning | ✅ Done | menus per company; masters global |
| Prisma seed (super admin, modules, menus, sample companies/data) | ✅ Done | idempotent-ish; run on boot |
| Docker (Dockerfiles + compose, db push + seed on boot) | ✅ Done | `prisma db push --accept-data-loss` then `npm run seed` |
| Frontend shell + Cpanel + Inventory pages | ✅ Done & build-verified | `next build` passes (21 routes) |
| Full-stack `docker compose up` smoke test | ✅ **PASSED (2026-06-27)** | Fresh volume → login, empty dashboards/widgets, routes correct |

---

## Run it

```bash
docker compose up --build -d        # postgres → backend (db push + seed) → frontend
# fresh slate (drops the DB volume): docker compose down -v first
```
- Web:  http://localhost:3000  (login superadmin / Admin@123)
- API:  http://localhost:4000/api
- Docs: http://localhost:4000/api/docs

Hot-reload dev: use `docker-compose.dev.yml` (the default compose is a no-reload
prod build).

### Validate without the full stack
```bash
cd backend
npm install
npx prisma generate
npm run build            # nest build + lint:boundaries
cd ../frontend && npm install && npm run build
```

---

## Project layout
```
EK-Group-ERP/
├── docker-compose.yml / docker-compose.dev.yml
├── .env / .env.example
├── README.md / PROGRESS.md (this file)
├── docs/                       adding-a-module.md, user manuals
├── reference images/           original PHP screens + design spec (context)
├── backend/                    NestJS API
│   ├── Dockerfile
│   ├── prisma/schema/          cpanel.prisma, inventory.prisma, production.prisma, enums.prisma
│   ├── prisma/seed.ts          super admin + modules + menus + sample companies
│   └── src/
│       ├── main.ts  app.module.ts
│       ├── auth/               JWT login, guards, nav+permission builder
│       ├── contracts/          cross-module ports (no direct cross-module imports)
│       ├── prisma/             PrismaService (global)
│       └── modules/            company, module-master, lookup, object-master, menu,
│                               user-group, user, currency, branch, cost-center,
│                               cost-object, dashboard, widget, backup, production,
│                               unit, category, group, hsn, item
└── frontend/                   Next.js 14 app (slate/blue, dark mode, drawers)
    └── src/
        ├── app/(app)/cpanel/{objects,modules,menus,user-groups,dashboards,widgets,
        │                      companies,currencies,lookups,users,backup}/page.tsx
        ├── app/(app)/inventory/{units,categories,groups,hsn-codes,items}/page.tsx
        ├── app/(app)/dashboard/[id]/page.tsx   (renders a dashboard's widgets)
        ├── app/login/page.tsx  app/(app)/page.tsx (landing)
        ├── components/{layout,ui,dashboard}/
        ├── providers/          Auth, Theme, Toast, Confirm
        └── lib/                api client, types, hooks, icons, nav, utils
```

## API contract (highlights)
All under `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`); all except
`/auth/login` need `Authorization: Bearer <token>`. Company/branch context flow
via `X-Company-Id` / `X-Branch-Id` headers.
- `POST /auth/login`, `GET /auth/me` → `{ user, companies, activeCompanyId,
  branchApplicable, branches, activeBranchId, navigation, permissions }`
  - `navigation: [{ id, code, name, icon, menus:[…], dashboards:[{ id, name, icon,
    route, isDefault, branchId }] }]`  (no `gadgets`)
- `GET/POST /widgets (?moduleId=)`, `PATCH/DELETE /widgets/:id`, `PATCH /widgets/:id/lock`
- `GET/POST /dashboards (?moduleId=&branchId=)`, `GET/PATCH/DELETE /dashboards/:id`,
  `GET /dashboards/widgets?moduleId=` (catalog), `PUT /dashboards/:id/widgets`
  (`{ widgets:[{ widgetId, width }] }`), `PUT|DELETE /dashboards/:id/my-layout`
- `GET /user-groups/:id/privileges` → per-module tree + `dashboards[]` checklist;
  `PUT /user-groups/:id/privileges` (`{ mainMenuAccess, subMenuPrivileges, dashboardIds }`)
- Cpanel masters: `/companies`, `/modules`, `/lookups` + `/lookup-values`,
  `/currencies`, `/branches`, `/cost-centers`, `/cost-objects`, `/objects`,
  `/main-menus`, `/sub-menus`, `/menus/tree`, `/user-groups`, `/users`, `/backup`
- Inventory: `/units`, `/categories`, `/groups`, `/hsn-codes`, `/items`
```
