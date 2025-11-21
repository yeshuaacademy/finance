# ProChat MicroSaaS Fast Boilerplate — Universal README

This repository is the official **ProChat MicroSaaS Fast Boilerplate**, designed to let developers build, deploy, and iterate microSaaS products in under 48 hours.  
It integrates Clerk, Stripe, Prisma, Supabase, n8n/Make, SEO tooling, a full dashboard, multi-tenant architecture, and Codex automation — all preconfigured and production-ready.

This README provides the higher‑level architecture overview, while the `/instructions` folder defines strict Codex 5.1 rules for how AI tooling should update and extend this boilerplate safely, without hallucinations or architectural drift.

Below this introduction, the original database automation documentation remains unchanged, because database automation is a first‑class feature of this boilerplate.

## 🚨 Required Step: Database Provisioning (Mandatory for All Projects)

Every project built with the **ProChat MicroSaaS Fast Boilerplate** must provision a tenant database before running locally or deploying to production.

This boilerplate **cannot function without a valid PostgreSQL database**, because Clerk authentication, Stripe subscription gating, the dashboard, and Prisma’s multi‑tenant routing all depend on it.

### ✔ How to provision the database (Local or Production)

Run the provisioning script:

```
./scripts/provision-saas.sh <project-slug>
```

This command:

- Creates the tenant schema: `tenant_<slug>`
- Creates the database user: `tenant_<slug>_user`
- Grants required permissions
- Writes the correct `DATABASE_URL` and `SYSTEM_DATABASE_URL` into:
  - `.env` (development)
  - `.env.production` (deployment)
- Syncs Prisma system schema using:
  ```
  npx prisma migrate deploy --schema=prisma/system.prisma
  ```

### ✔ Codex Behavior

Codex 5.1 must **always** run the provisioning script when initializing a new project based on this boilerplate.

Codex must never:
- skip database provisioning,
- generate placeholder or invalid DATABASE_URL values,
- switch the database provider,
- use SQLite or in‑memory databases,
- modify Postgres connection structure.

For a complete walkthrough, see:

```
/instructions/database-provisioning.md
```

## How Codex 5.1 Should Use This Boilerplate

Codex must follow the rules defined in `/instructions` to ensure:
- minimal diffs,
- no hallucinated files,
- no duplication of existing libs,
- no modification of protected systems (Clerk, Stripe, Prisma, SEO, automation),
- consistent architecture aligned with the folder tree in the Appendix.

Codex should treat this boilerplate as **app‑agnostic**:  
every new microSaaS built on top of it should reuse the same routing, dashboard, libs, and multi‑tenant structure unless explicitly changed by the user.

### ⚙️ Codex Database Automation

This boilerplate integrates **OpenAI Codex** to automate database provisioning, migrations, and environment management for both local development and production environments.

#### 🧠 Architecture Overview

- There is a single shared Postgres database named `postgres` used in both development and production.
- Each SaaS app gets its own dedicated schema within this shared database (e.g., `tenant_<slug>`).
- Codex automates provisioning by creating new schemas, users, running migrations, and registering tenants centrally.
- In production, Codex connects **through the MCP bridge** to Supabase for provisioning because Supabase is private.
- The SaaS app itself connects **directly** to Supabase in production, not through the MCP bridge.

| Environment | Connection Method                  | Target Database                  | Environment File       |
|-------------|----------------------------------|---------------------------------|-----------------------|
| Development | Direct Postgres connection (Docker Desktop on port 5433) | Local Postgres instance          | `.env`                |
| Production  | MCP bridge HTTP API proxy (inside Dokploy) for provisioning | Supabase Postgres (`10.0.2.4:5433`) | `.env.production`     |

#### 🧩 Automation Details

Codex automates the following steps seamlessly in both environments, using the appropriate connection strategy:

- Creates a dedicated schema for each tenant or project (e.g., `tenant_<slug>`).
- Creates a corresponding database user with appropriate permissions (e.g., `tenant_<slug>_user`).
- Runs `npx prisma migrate deploy --schema=prisma/system.prisma` during provisioning for each new SaaS project to apply all Prisma migrations.
- Registers the tenant in a central registry table (e.g., `public.tenants`) to enable multi-tenant support.

#### 🧱 Prerequisites

- **Docker Desktop** must be running during development to provide the local Postgres instance on port `5433`.
- You have an `.env` file for local development and an `.env.production` file for production deployments, each including the appropriate connection strings, for example:

  ```bash
  # .env (development)
  DATABASE_URL=postgresql://tenant_demo_user:***@localhost:5433/postgres?schema=tenant_demo
  SYSTEM_DATABASE_URL=postgresql://postgres:devpass@localhost:5433/postgres?schema=public

  # .env.production (production)
  DATABASE_URL=postgresql://tenant_demo_user:***@10.0.2.4:5433/postgres?schema=tenant_demo
  SYSTEM_DATABASE_URL=postgresql://postgres:prodpass@10.0.2.4:5433/postgres?schema=public
  ```

#### ⚙️ Starting a New Project

1. **Bootstrap the app**

   ```bash
   git clone https://github.com/prochattools/boilerplate.git my-new-app
   cd my-new-app
   ```

2. **Initialize the tenant database**

   Run Codex with instructions to set up the database:

   ```bash
   codex "initialize database for project <slug> using instructions from codex-db-automation.md"
   ```

   This command works seamlessly in both development and production environments by using the correct connection method based on your environment:

   - In development, Codex connects directly to the local Postgres instance via Docker.
   - In production, Codex connects through the MCP bridge HTTP API proxy to your Supabase database for provisioning.

   Codex will:

   - Create the schema `tenant_<slug>`
   - Create the user `tenant_<slug>_user`
   - Run `npx prisma migrate deploy --schema=prisma/system.prisma` to apply all Prisma migrations
   - Register the tenant in the `public.tenants` table

3. **Run the app**

   ```bash
   npm install
   npm run dev
   ```

4. **Access locally**

   Open your browser at:

   ```
   http://mynewapp.localhost:3000
   ```

   The app detects the subdomain, fetches credentials from the tenant registry, and connects to the correct database schema directly.

#### ✅ Summary

With Docker running locally, any new project based on this boilerplate will:

1. Spin up a new schema and user automatically.
2. Run all Prisma migrations via `npx prisma migrate deploy --schema=prisma/system.prisma`.
3. Register itself in the global tenant registry.
4. Be ready to run locally or on Supabase in production without manual database setup.

In production deployments, the `.env.production` file is used automatically, and Codex connects through the MCP bridge to provision and manage your database securely. The SaaS app connects directly to Supabase for runtime database access.

#### 🔄 Keeping Schemas in Sync

Once a tenant is provisioned, Codex reuses the existing `DATABASE_URL` from `.env` and `.env.production` for all future schema updates. This ensures smooth and consistent management of database schemas across environments.

The typical workflow for making schema changes is:

- Run `npx prisma migrate dev` locally to create and test migrations during development.
- Push your changes to production; Codex then automatically runs `npx prisma migrate deploy` on Supabase through the MCP bridge to apply the migrations.

This process keeps database schemas (structure) in sync between development and production, but note that data itself is not synchronized.

##### Under the hood

Codex automatically detects the current environment (development or production) and reuses existing tenant URLs without recreating tenants. This avoids redundant provisioning and ensures efficient schema management across deployments.

---

## Boilerplate Architecture Reference

This boilerplate uses:

- Next.js App Router  
- Clerk authentication  
- Stripe billing  
- Multi‑tenant Postgres via Prisma  
- Supabase in production  
- Codex‑driven provisioning  
- n8n/Make automation support  
- Tailwind + shadcn UI  
- A full dashboard and marketing system

**Codex and all AI tools must always reference the folder tree stored in:**

```
GPT5_SaaS_Builder_Reference_Document_v2.md → Appendix: Boilerplate File Structure Snapshot
```

This ensures correct file placement, prevents architectural drift, and keeps the ProChat MicroSaaS Fast Boilerplate consistent across apps.
