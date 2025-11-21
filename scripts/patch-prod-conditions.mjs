#!/usr/bin/env node
import fs from "fs";
import path from "path";
import url from "url";
import dotenv from "dotenv";

const rootDir = process.cwd();
const defaultEnvPath = process.env.ENV_FILE || path.join(rootDir, ".env");
const envFiles = [defaultEnvPath, ".env.local", ".env.production"].filter((p, idx, arr) => arr.indexOf(p) === idx);
envFiles.forEach((file) => {
  const fullPath = path.isAbsolute(file) ? file : path.join(rootDir, file);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
  }
});

const normalizeUrl = (value) => {
  try {
    return new url.URL(value);
  } catch (error) {
    throw new Error(`Invalid URL: ${value}`);
  }
};

const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const getSchemaFromUrl = (connectionString) => {
  const parsed = normalizeUrl(connectionString);
  const schema = parsed.searchParams.get("schema");
  return schema || null;
};

const quoteIdent = (ident) => `"${ident.replace(/"/g, '""')}"`;
const quoteLiteral = (literal) => `'${literal.replace(/'/g, "''")}'`;

const safeJsonParse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const mcpApiUrl = process.env.MCP_API_URL || "https://mcp.prochat.tools/query";
const mcpSecret = requireEnv("MCP_SECRET");
const localDbUrl = requireEnv("DATABASE_URL");

const schemaName =
  getSchemaFromUrl(localDbUrl) ||
  process.env.TENANT_SLUG ||
  (() => {
    throw new Error(
      "Unable to determine target schema; set ?schema=... on DATABASE_URL or TENANT_SLUG.",
    );
  })();
const schemaIdent = quoteIdent(schemaName);

const executeSqlViaMcp = async (sql, { label }) => {
  const response = await fetch(mcpApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mcpSecret}`,
    },
    body: JSON.stringify({ sql, label }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP request failed (${response.status}): ${text}`);
  }

  const payloadText = await response.text();
  const payload = safeJsonParse(payloadText);
  if (!payload) {
    throw new Error(`Unexpected MCP response: ${payloadText}`);
  }
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload;
};

async function main() {
  console.log(`🛠 Patching schema "${schemaName}" to ensure CategorizationRule.conditions exists in production`);

  const alterSql = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = ${quoteLiteral(schemaName)}
      AND table_name = 'CategorizationRule'
      AND column_name = 'conditions'
  ) THEN
    ALTER TABLE ${schemaIdent}."CategorizationRule"
      ADD COLUMN "conditions" JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END;
$$;
`;

  await executeSqlViaMcp(alterSql, {
    label: `ensure ${schemaName}.CategorizationRule.conditions exists`,
  });

  console.log(`✅ Ensured ${schemaName}.CategorizationRule.conditions exists in production`);
}

main().catch((err) => {
  console.error("❌ Patch failed:", err);
  process.exit(1);
});
