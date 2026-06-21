# Erp Grid8

A modular ERP platform. Modules can be added or removed independently. The first
module is **Cpanel** (Control Panel) — used to configure the whole application:
dynamic menus & submenus, user groups & privileges, an Object Master registry,
company master, lookups, and users / data security.

## Stack

| Layer     | Tech                                  |
| --------- | ------------------------------------- |
| Frontend  | Next.js 14 (App Router) + Tailwind CSS |
| Backend   | NestJS (TypeScript)                   |
| ORM       | Prisma                                |
| Database  | PostgreSQL 16                         |
| Runtime   | Docker + docker-compose               |

Design: modern / minimalistic, neutral **slate + blue** accent, light **and**
dark mode. Forms open in **side drawers** (never modals).

## Project layout

```
.
├── backend/            NestJS API + Prisma schema/seed
├── frontend/           Next.js app
├── docker-compose.yml  postgres + backend + frontend
├── .env.example        copy to .env
└── reference images/   original PHP screens + design spec (context only)
```

## Quick start (Docker — recommended)

```bash
cp .env.example .env          # tweak secrets if you like
docker compose up --build
```

This starts Postgres, runs Prisma migrations, seeds the database (super admin +
sample Cpanel menus), then launches the API and the web app.

- Web:  http://localhost:3000
- API:  http://localhost:4000/api
- API docs (Swagger): http://localhost:4000/api/docs

### Default login

```
Username: superadmin
Password: Admin@123
```

## Local development (without Docker)

You need Node 20+ and a local Postgres.

```bash
# backend
cd backend
npm install
npx prisma migrate dev
npm run seed
npm run start:dev          # http://localhost:4000

# frontend (new terminal)
cd frontend
npm install
npm run dev                # http://localhost:3000
```

## How "modules" work

Every menu, object, and user group belongs to a **Module** (`Module Master`).
Disabling a module hides all its menus and revokes its privileges without
deleting any data — that is the "add / remove module" mechanism. `Cpanel` is a
core module and cannot be removed.

## Notes on the migration from the old PHP app

The reference screens come from an existing PHP application. The biggest
structural change: where the old app stored a **PHP file name** as the object
path/URL (e.g. `newleadheadlist.php?ps=1&pr=D,I,U`), Erp Grid8 stores an
application **route** instead (e.g. `/crm/enquiry/amc`). The Workflow Engine
from the original spec is intentionally **not** included in this build.
