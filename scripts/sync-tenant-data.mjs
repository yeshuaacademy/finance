#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import dotenv from "dotenv";
import pgPkg from "pg";

const { Client } = pgPkg;

const rootDir = process.cwd();
const defaultEnvPath = process.env.ENV_FILE || path.join(rootDir, ".env");
if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath });
} else {
  dotenv.config();
}

const localDbUrl = requireEnv("DATABASE_URL");
const mcpApiUrl = process.env.MCP_API_URL || "https://mcp.prochat.tools/query";
const mcpSecret = requireEnv("MCP_SECRET");

const schemaName =
  getSchemaFromUrl(localDbUrl) ||
  process.env.TENANT_SLUG ||
  (() => {
    throw new Error(
      "Unable to determine target schema; set ?schema=... on DATABASE_URL or TENANT_SLUG."
    );
  })();

const schemaIdent = quoteIdent(schemaName);

const main = async () => {
  console.log(`🔁 Syncing schema "${schemaName}" data from local → production`);
  const localClient = new Client({
    connectionString: normalizeUrl(localDbUrl),
  });
  await localClient.connect();
  try {
    const tables = await listTables(localClient, schemaName);
    if (!tables.length) {
      console.log("ℹ️  No tables discovered; nothing to sync.");
      return;
    }
    const orderedTables = await orderTablesByDependencies(
      localClient,
      schemaName,
      tables
    );

    await truncateRemoteTables(orderedTables);

    for (const table of orderedTables) {
      const jsonArray = await fetchTableJson(localClient, schemaName, table);
      if (jsonArray === "[]" || jsonArray === "null") {
        console.log(`   • ${table}: no rows, skipping`);
        continue;
      }
      const rows = safeJsonParse(jsonArray);
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`   • ${table}: no rows, skipping`);
        continue;
      }
      await insertRemoteTableData(table, rows);
      console.log(`   • ${table}: synced ${rows.length} row(s)`);
    }

    console.log("✅ Data sync completed via MCP bridge.");
    // Ensure production tenant user has rights over the schema
    await grantSchemaPrivileges(schemaName);
  } finally {
    await localClient.end();
  }
};

main().catch((err) => {
  console.error("❌ Sync failed:", err.message);
  process.exit(1);
});

async function listTables(client, schema) {
  const res = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name
    `,
    [schema]
  );
  return res.rows.map((row) => row.table_name);
}

async function orderTablesByDependencies(client, schema, tables) {
  const tableSet = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));

  const fkRes = await client.query(
    `
      SELECT tc.table_name AS child_table,
             ccu.table_name AS parent_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
    `,
    [schema]
  );

  for (const row of fkRes.rows) {
    if (
      tableSet.has(row.child_table) &&
      tableSet.has(row.parent_table) &&
      row.child_table !== row.parent_table
    ) {
      deps.get(row.child_table)?.add(row.parent_table);
    }
  }

  const ordered = [];
  const remaining = new Set(tables);

  while (remaining.size) {
    const ready = [...remaining].filter((table) => {
      const tableDeps = deps.get(table) ?? new Set();
      for (const dep of tableDeps) {
        if (remaining.has(dep)) return false;
      }
      return true;
    });

    if (!ready.length) {
      // Cycle detected; append rest alphabetically
      for (const table of [...remaining].sort()) {
        ordered.push(table);
        remaining.delete(table);
      }
      break;
    }

    ready.sort();
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  return ordered;
}

async function truncateRemoteTables(tables) {
  const qualified = tables
    .map((table) => `${schemaIdent}.${quoteIdent(table)}`)
    .join(", ");
  if (!qualified.length) return;
  const sql = `
SET search_path TO ${schemaIdent};
TRUNCATE ${qualified} RESTART IDENTITY CASCADE;
`;
  await executeSqlViaMcp(sql, { label: "truncate production tables" });
}

async function fetchTableJson(client, schema, table) {
  const res = await client.query(
    `
      SELECT COALESCE(json_agg(t)::text, '[]') AS data
      FROM ${schemaIdent}.${quoteIdent(table)} t
    `
  );
  const value = res.rows[0]?.data ?? "[]";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function insertRemoteTableData(table, rows, chunkSize = 50) {
  const tableIdent = quoteIdent(table);
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const payload = JSON.stringify(chunk);
    const sql = `
SET search_path TO ${schemaIdent};
INSERT INTO ${schemaIdent}.${tableIdent}
SELECT *
FROM json_populate_recordset(
  NULL::${schemaIdent}.${tableIdent},
  ${quoteLiteral(payload)}::json
);
`;
    await executeSqlViaMcp(sql, {
      label: `insert data for ${table} (batch ${Math.floor(i / chunkSize) + 1})`,
    });
  }
}

async function executeSqlViaMcp(sql, { label }) {
  console.log(`🛰️  MCP executing: ${label}`);
  const response = await fetch(mcpApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mcpSecret}`,
    },
    body: JSON.stringify({ sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `MCP request failed (${response.status} ${response.statusText}): ${text}`
    );
  }
  const payload = safeJsonParse(text);
  if (payload?.error) {
    throw new Error(`MCP error: ${JSON.stringify(payload.error)}`);
  }
  return payload;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getSchemaFromUrl(url) {
  try {
    const normalized = normalizeUrl(url);
    const parsed = new URL(normalized);
    return parsed.searchParams.get("schema");
  } catch {
    return null;
  }
}

function normalizeUrl(url) {
  if (!url) return url;
  const trimmed = url.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed.startsWith("postgres://")) {
    return "postgresql://" + trimmed.slice("postgres://".length);
  }
  return trimmed;
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function grantSchemaPrivileges(schema) {
  console.log(`🛰️  Granting privileges on schema "${schema}" to tenant_openfund_user`);

  const sql = `
GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO tenant_openfund_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} TO tenant_openfund_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schema)}
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_openfund_user;
`;

  await executeSqlViaMcp(sql, { label: `grant privileges for ${schema}` });
}
