# Codex Database Automation for Boilerplate

Codex connects to a single Postgres database named `postgres` to automatically provision schemas and users for each new SaaS project. For each tenant, Codex creates a dedicated schema and a corresponding user (`tenant_<slug>_user`) within the shared database.

---

## 1️⃣ Initialize a new project database

Codex will perform the following actions when provisioning `<slug>`:

1. Generate a random password for the new tenant user (`tenant_<slug>_user`).
2. Create the schema and user within the shared `postgres` database locally:
   ```sql
   CREATE SCHEMA IF NOT EXISTS tenant_<slug>;
   CREATE USER tenant_<slug>_user WITH PASSWORD '<password>';
   GRANT USAGE ON SCHEMA tenant_<slug> TO tenant_<slug>_user;
   ALTER ROLE tenant_<slug>_user SET search_path = tenant_<slug>;
   GRANT ALL PRIVILEGES ON SCHEMA tenant_<slug> TO tenant_<slug>_user;
   ```
3. Automatically sync the schema and user creation to the production database by sending the SQL commands to the public MCP Bridge endpoint `https://mcp.prochat.tools`. This step is **mandatory** because the production Supabase instance is only reachable through the MCP Bridge.

---

## 2️⃣ Database Provisioning: Development vs Production

Both development and production environments connect to the **same single Postgres database** named `postgres`, but each tenant is isolated via its own schema.

- In **development**, Codex connects **directly** to the local Postgres instance running on `localhost:5433` using the `DATABASE_URL` defined in the `.env` file.
- In **production**, Codex provisions and migrates **via the MCP bridge** at `https://mcp.prochat.tools/query` using the `mcp_manager` user because Supabase (10.0.2.4:5433) is only reachable from within Dokploy. The app in production still connects directly to `10.0.2.4:5433` at runtime with the tenant’s own credentials (not `mcp_manager`).

Codex provisions new schemas and users within this shared database, ensuring tenant isolation through schema-based multi-tenancy.

### Connection Details

| Environment  | Provisioning/Migrations                 | Runtime DB connection          |
|--------------|-----------------------------------------|--------------------------------|
| Development  | Direct SQL to `localhost:5433`          | Direct SQL to `localhost:5433` |
| Production   | MCP bridge `https://mcp.prochat.tools/query` (user `mcp_manager`) | Direct SQL to `10.0.2.4:5433` with tenant creds |

### Example Provisioning Logic (Pseudocode)

```js
// Generate password for tenant user
const password = generateRandomPassword();

const sql = `
  CREATE SCHEMA IF NOT EXISTS tenant_${slug};
  CREATE USER tenant_${slug}_user WITH PASSWORD '${password}';
  GRANT USAGE ON SCHEMA tenant_${slug} TO tenant_${slug}_user;
  ALTER ROLE tenant_${slug}_user SET search_path = tenant_${slug};
  GRANT ALL PRIVILEGES ON SCHEMA tenant_${slug} TO tenant_${slug}_user;
`;

if (process.env.NODE_ENV === 'production') {
  const bridgeUrl = process.env.MCP_API_URL || 'https://mcp.prochat.tools/query';
  const headers = {
    'Content-Type': 'application/json',
    ...(process.env.MCP_SECRET ? { Authorization: `Bearer ${process.env.MCP_SECRET}` } : {}),
  };

  // Call MCP bridge (Supabase is not directly reachable from dev)
  await fetch(bridgeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ user: 'mcp_manager', sql }),
  });

  // MCP must also re-grant privileges to tenant user after migrations
  await fetch(bridgeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user: 'mcp_manager',
      sql: `GRANT ALL PRIVILEGES ON SCHEMA tenant_${slug} TO tenant_${slug}_user;`,
    }),
  });
} else {
  // Connect directly to local Postgres on localhost:5433
  await execShellCommand(`
    psql ${process.env.DATABASE_URL} -c "${sql}"
  `);
}
```

This approach ensures that Codex can provision tenant databases consistently in both local development and production environments, using a shared Postgres database with schema-based isolation.
