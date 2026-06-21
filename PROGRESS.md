# Erp Grid8 — Build Progress / Resume Notes

_Last updated: 2026-06-20. This file tracks what's built so we can resume after
the desktop restart (Docker virtualization settings change)._

## What Erp Grid8 is

A **modular ERP**. Modules can be enabled/disabled wholesale (disabling hides a
module's menus + revokes its privileges without deleting data). The first module
is **Cpanel** (control panel) — configures the whole app: dynamic menus &
submenus, user groups & privileges, an Object Master registry, company master,
lookups, and users / data security.

### Decisions locked in
- **Backend:** NestJS (TypeScript), separate container.
- **Scope:** Full Cpanel (Object Master, Menu Setup, User Groups & Privileges,
  Company Master, Lookup Master/Child, Module Master, Users & Data Security).
  **Workflow Engine intentionally excluded.**
- **Auth:** Layer-1 password + JWT, privilege-gated. User table carries
  MAC/OTP/security-type columns for later; Layer-2 enforcement deferred.
- **DB/ORM:** PostgreSQL + Prisma. **Frontend:** Next.js 14 (App Router) +
  Tailwind. **Theme:** neutral slate + blue, light **and** dark mode.
- Forms open in **side drawers** (never modals).
- **PHP → route migration:** the old app stored a `.php` filename as the object
  path; Erp Grid8 stores an app **`route`** instead (field `route` on
  `ObjectMaster` and `SubMenu`).

### Default login (seeded)
```
username: superadmin
password: Admin@123
```

---

## Status by area

| Area | Status | Notes |
| --- | --- | --- |
| Repo scaffold (compose, .env, .gitignore, README) | ✅ Done | `.env` created so `docker compose up` works out of the box |
| Prisma schema | ✅ Done | `backend/prisma/schema.prisma` |
| Backend foundation (main, app.module, PrismaService, Swagger, global JWT guard) | ✅ Done | |
| Auth + privilege/navigation builder | ✅ Done | `/auth/login`, `/auth/me` |
| Backend feature modules (Company, Module Master, Lookup, Object Master, Menu, User Groups+privileges, Users) | ✅ Done & **build-verified** | `npm run build` passes; `dist/main.js` + all 7 modules emit correctly |
| Prisma seed (super admin, modules, menus, sample data) | ✅ Written | **Not yet run** against a DB (Docker was down) |
| Docker (Dockerfiles + compose w/ healthcheck, auto db push + seed) | ✅ Written | **Not yet validated** — Docker engine was returning HTTP 500 |
| Frontend shell + components + providers | ✅ Written by agent | **Deps not installed, not built yet** |
| Frontend Cpanel pages | ✅ Done & build-verified | objects, menus, companies, lookups, users, modules, **user-groups (privilege matrix)** all present; `next build` passes (10 routes). |
| Full-stack `docker compose up` smoke test | ✅ **PASSED (2026-06-20)** | Docker healthy after restart. db push + seed ran; login → token+navigation; protected `/objects`, `/user-groups` OK; frontend serves :3000 (login + root → 200). |

---

## ✅ RESOLVED — the project is up

After the virtualization-settings restart, Docker is healthy and the full stack
runs. `docker compose up --build -d` brings up **db (healthy) → backend (db push
+ seed + API on :4000) → frontend (:3000)**. Verified login, protected
endpoints, and page serving. See the status table above. Original blocker notes
kept below for history.

## ⚠️ The blocker (why we restarted)

`docker version` shows the client OK but every engine call returns:
```
request returned 500 Internal Server Error ... /dockerDesktopLinuxEngine/v1.52/...
check if the server supports the requested API version
```
Docker Desktop's Linux engine was unhealthy. You're changing **virtualization
settings (WSL2 / Hyper-V)** and restarting to fix it. After reboot, confirm with:
```
docker run --rm hello-world
```

---

## Verified facts (already tested this session)
- `node v25.2.1`, `npm 11.7.0`, `docker 29.1.3` present.
- Backend `npm install` + `npx prisma generate` + `npm run build` → **clean**.
- Fixed: added `"prisma"` to `tsconfig.json` `exclude` so Nest emits
  `dist/main.js` (was emitting `dist/src/main.js` because `seed.ts` shifted the
  compile root). The seed still runs via `ts-node` (`npm run seed`).
- No local Postgres on :5432 (so DB validation needs Docker or a local PG).

---

## Resume checklist (after restart)

### 1. Confirm Docker is healthy
```bash
docker run --rm hello-world
```

### 2. Finish + verify the frontend
The background agent that was building the frontend will have been killed by the
restart. Pick up where it left off:
- **Create the missing page** `frontend/src/app/(app)/cpanel/user-groups/page.tsx`
  — the User Groups list + **privilege matrix** (per main menu: a "Menu"
  visibility checkbox; per sub-menu rows: Menu / View / Add / Edit / Delete
  checkboxes). API: `GET /user-groups/:id/privileges`, `PUT /user-groups/:id/privileges`.
- Then verify the build:
```bash
cd "C:/Projects/ERP DEMO/frontend"
npm install
npm run build       # must pass; fix any TS/build errors
```

### 3. Full stack up (the real smoke test)
```bash
cd "C:/Projects/ERP DEMO"
docker compose up --build
```
Expected: Postgres healthy → backend runs `prisma db push` + seed + starts →
frontend serves.
- Web:  http://localhost:3000  (login superadmin / Admin@123)
- API:  http://localhost:4000/api
- Docs: http://localhost:4000/api/docs

### 4. If you want to validate backend without the full stack
```bash
cd "C:/Projects/ERP DEMO"
docker compose up -d db
cd backend
npx prisma db push        # backend/.env points DATABASE_URL at localhost:5432
npm run seed
node dist/main.js         # API on :4000
# smoke test login:
curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"superadmin\",\"password\":\"Admin@123\"}"
```

---

## Project layout
```
ERP DEMO/
├── docker-compose.yml        postgres + backend + frontend
├── .env / .env.example
├── README.md
├── PROGRESS.md               (this file)
├── reference images/         original PHP screens + Cpanel design PDF (context)
├── backend/                  NestJS API
│   ├── Dockerfile
│   ├── prisma/schema.prisma  full Cpanel data model
│   ├── prisma/seed.ts        super admin + modules + menus + sample data
│   └── src/
│       ├── main.ts  app.module.ts
│       ├── auth/             JWT login, guard, nav+permission builder
│       ├── prisma/           PrismaService (global)
│       └── modules/          company, module-master, lookup, object-master,
│                             menu, user-group, user
└── frontend/                 Next.js 14 app (slate/blue, dark mode, drawers)
    └── src/
        ├── app/(app)/cpanel/{objects,menus,companies,lookups,users,modules,
        │                      user-groups[TODO]}/page.tsx
        ├── app/login/page.tsx  app/(app)/page.tsx (dashboard)
        ├── components/{layout,ui}/   AppShell, Sidebar, Topbar, Drawer,
        │                             DataTable, ThemeToggle, Tabs, ...
        ├── providers/        Auth, Theme, Toast, Confirm
        └── lib/              api client, types, hooks, icons, utils
```

## API contract (for the frontend)
All under `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`); all except
`/auth/login` need `Authorization: Bearer <token>`.
- `POST /auth/login` → `{ token, user, navigation, permissions }`
- `GET /auth/me` → `{ user, navigation, permissions }`
  - `navigation: [{ id, code, name, icon, menus:[{ id, name, icon, objectType, items:[{ id, name, route, icon, objectType }] }] }]`
  - `permissions: { "<route>": { view, add, edit, delete } }`
- `GET/POST /modules`, `GET/PATCH/DELETE /modules/:id`
- `GET/POST /lookups`, `GET/PATCH/DELETE /lookups/:id`, `GET/POST /lookups/:id/values`, `PATCH/DELETE /lookup-values/:id`
- `GET/POST /companies`, `GET/PATCH/DELETE /companies/:id`
- `GET /objects?search=&moduleId=&objectType=&page=&pageSize=` → `{ data,total,page,pageSize,counts:{forms,reports,tables} }`; `GET /objects/:id`; `POST/PATCH/DELETE /objects/:id`; `GET/POST /objects/:id/revisions`
- `GET/POST /main-menus (?moduleId=)`, `PATCH/DELETE /main-menus/:id`; `GET/POST /sub-menus (?mainMenuId=)`, `PATCH/DELETE /sub-menus/:id`; `GET /menus/tree?moduleId=`
- `GET/POST /user-groups (?moduleId=)`, `GET/PATCH/DELETE /user-groups/:id`; `GET /user-groups/:id/privileges`; `PUT /user-groups/:id/privileges`
- `GET/POST /users (?search=)`, `GET/PATCH/DELETE /users/:id`
