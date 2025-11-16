#!/usr/bin/env node
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";
import xlsx from "xlsx";
import pkg from "@prisma/client";
const {
  PrismaClient,
  TransactionDirection,
  TransactionClassificationSource,
} = pkg;

// ✅ Load environment (.env.local by default)
const envPath = process.env.ENV_FILE || ".env.local";
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

// ✅ CLI arguments
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.split("=");
    return [k.replace(/^--/, ""), rest.join("=") || ""];
  })
);

// ✅ File, range, and sheet
const file =
  args.get("file") ||
  "/Users/Steve/Documents/Development/Code/Projects/Private/openfund/sheets/Overzicht_Yeshua_Academy_Jun_2025.xlsx";
const fromRow = Number(args.get("fromRow") || 2);
const toRow = Number(args.get("toRow") || 225);
const sheetName = "transacties 2025"; // ✅ fixed correct sheet name

// 🧮 Utilities
function parseYyyyMmDd(s) {
  const v = String(s).trim();
  if (!/^\d{8}$/.test(v)) throw new Error(`Bad date: ${s}`);
  const yyyy = Number(v.slice(0, 4));
  const mm = Number(v.slice(4, 6));
  const dd = Number(v.slice(6, 8));
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function num(n) {
  if (n == null || n === "") return 0;
  const v = typeof n === "number" ? n : Number(String(n).replace(",", "."));
  if (Number.isNaN(v)) throw new Error(`Bad number: ${n}`);
  return v;
}

function hashString(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

const normalizeDescriptionOnly = (value) =>
  normalizeWhitespace(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeWhitespace = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeAccountIdentifier = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();

const buildImportFingerprint = ({
  accountIdentifier,
  date,
  amountMinor,
  description,
  counterparty,
  notifications,
}) => {
  const sanitize = (value) => normalizeWhitespace(value ?? "").toLowerCase();
  const parts = [
    normalizeAccountIdentifier(accountIdentifier),
    date.toISOString(),
    amountMinor.toString(),
    sanitize(description),
    sanitize(counterparty),
    sanitize(notifications),
  ];
  return hashString(parts.join("|"));
};

const trimOrNull = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const buildCategoryLabel = (main, sub) => {
  const safeMain = trimOrNull(main);
  const safeSub = trimOrNull(sub);
  if (safeMain && safeSub && safeMain !== safeSub) {
    return `${safeMain} — ${safeSub}`;
  }
  return safeMain ?? safeSub ?? null;
};

const DEFAULT_ACCOUNT_IDENTIFIER = "NL89INGB0006369960";

const ACCOUNT_LABEL_ENTRIES = [
  {
    keys: ["NL89INGB0006369960"],
    name: "Yeshua Academy",
    identifier: "NL89INGB0006369960",
  },
  {
    keys: ["R 951-98945", "R95198945"],
    name: "Fellowship Renswoude",
    identifier: "R 951-98945",
  },
  {
    keys: ["K 577-97642", "K57797642"],
    name: "Fellowship Veluwe",
    identifier: "K 577-97642",
  },
  {
    keys: ["C 951-98936", "C95198936"],
    name: "Fellowship Barneveld",
    identifier: "C 951-98936",
  },
  {
    keys: ["F 951-98948", "F95198948"],
    name: "Yeshua Academy Savings",
    identifier: "F 951-98948",
  },
];

const normalizeAccountKey = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();

const ACCOUNT_LOOKUP = ACCOUNT_LABEL_ENTRIES.reduce((acc, entry) => {
  entry.keys.forEach((key) => acc.set(normalizeAccountKey(key), entry));
  return acc;
}, new Map());

const resolveAccountInfo = (rawValue) => {
  const identifier = trimOrNull(rawValue);
  if (!identifier) return null;
  const normalized = normalizeAccountKey(identifier);
  const entry = ACCOUNT_LOOKUP.get(normalized);
  if (!entry) {
    return { identifier, name: identifier };
  }
  return {
    identifier: entry.identifier ?? identifier,
    name: entry.name ?? identifier,
  };
};

function deriveDirectionFromRaw(rawDebitCredit, amount) {
  const raw = String(rawDebitCredit ?? "").trim().toLowerCase();

  // Tokens treated as debit (money going out)
  const debitTokens = [
    "debit",
    "deb",
    "db",
    "d",
    "af",
    "afschrift",
    "afschrijving",
    "uit",
    "out",
  ];

  // Tokens treated as credit (money coming in)
  const creditTokens = [
    "credit",
    "cred",
    "cr",
    "c",
    "bij",
    "bijschrijving",
    "in",
  ];

  if (debitTokens.some((token) => raw.startsWith(token))) {
    return TransactionDirection.debit;
  }
  if (creditTokens.some((token) => raw.startsWith(token))) {
    return TransactionDirection.credit;
  }

  // Fallback: use amount sign if raw indicator is missing/unknown
  if (amount < 0) {
    return TransactionDirection.debit;
  }
  return TransactionDirection.credit;
}

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("❌ DATABASE_URL missing from env");
  if (!fs.existsSync(file)) throw new Error(`❌ File not found: ${file}`);

  const wb = xlsx.readFile(file);
  if (!wb.Sheets[sheetName])
    throw new Error(`❌ Sheet "${sheetName}" not found in workbook`);
  const ws = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });

  const header = rows[0].map((h) => (h ? String(h).trim() : ""));
  const dataRows = rows.slice(fromRow - 1, toRow);
  const expected = toRow - fromRow + 1;
  if (dataRows.length !== expected)
    throw new Error(
      `Row count mismatch: got ${dataRows.length}, expected ${expected}`
    );

  const findColumn = (...names) => {
    for (const name of names) {
      const idx = header.indexOf(name);
      if (idx >= 0) return idx;
    }
    throw new Error(
      `Missing required columns. Header: ${JSON.stringify(header)}`
    );
  };

  const iDate = findColumn("Datum", "Date");
  const iDesc = findColumn("Omschrijving", "Name / Description");
  const iAmt = findColumn("Bedrag", "Amount (EUR)");
  const iCat = findColumn("Categorie");
  const iSub = findColumn("bestemming");
  const iAccount = header.indexOf("Account");

const userId =
  process.env.MOCK_USER_ID ||
  process.env.DEFAULT_USER_ID ||
  "demo-user";

  // ✅ Prepare 224 transaction records
  const records = dataRows.map((r, idx) => {
    const rowData = header.reduce((acc, columnName, columnIdx) => {
      const key =
        (columnName && columnName.trim().length ? columnName : `Column ${columnIdx + 1}`);
      acc[key] = r[columnIdx] ?? null;
      return acc;
    }, /** @type {Record<string, unknown>} */ ({}));
    const rawAmountCell = r[iAmt];
    const rawDebitCreditCellIndex = header.indexOf("Debit/credit");
    const rawDebitCreditCell =
      rawDebitCreditCellIndex >= 0 ? r[rawDebitCreditCellIndex] : null;

    // Amount in Excel is always positive; keep it as absolute value
    const amount = Math.abs(num(rawAmountCell));
    const date = parseYyyyMmDd(r[iDate]);
    const description = String(r[iDesc] ?? "");
    const mainCategoryName = trimOrNull(r[iCat]);
    const categoryName = trimOrNull(r[iSub]);
    const categoryLabel = buildCategoryLabel(mainCategoryName, categoryName);
    const accountRaw =
      iAccount >= 0 ? r[iAccount] ?? null : DEFAULT_ACCOUNT_IDENTIFIER;
    const accountInfo = resolveAccountInfo(accountRaw);

    const direction = deriveDirectionFromRaw(rawDebitCreditCell, amount);

    const canonicalColumns = {
      "Name / Description": description,
      Account: accountInfo?.identifier ?? DEFAULT_ACCOUNT_IDENTIFIER,
      Counterparty: trimOrNull(rowData["Counterparty"] ?? rowData["counterparty"]),
      Code: trimOrNull(rowData["Code"] ?? rowData["code"]),
      "Debit/credit":
        rawDebitCreditCell ??
        (direction === TransactionDirection.credit ? "Credit" : "Debit"),
      "Amount (EUR)": amount,
      "Transaction type": rowData["Transaction type"] ?? "Excel Import",
      Notifications:
        rowData["Notifications"] ??
        rowData["Notification"] ??
        `Source: Excel Import`,
    };
    Object.entries(canonicalColumns).forEach(([key, value]) => {
      if (value != null) {
        rowData[key] = value;
      }
    });

    const normalizedKey = normalizeDescriptionOnly(description);

    // ✅ Include row index in hash to avoid duplicate constraint
    const hashInput = [
      idx,
      date.toISOString(),
      description,
      amount,
      mainCategoryName,
      categoryName,
      "NL89INGB0006369960",
    ].join("|");
    const hash = hashString(hashInput);
    const amountMinor = BigInt(Math.round(Math.abs(amount) * 100));
    const counterparty = trimOrNull(rowData["Counterparty"] ?? rowData["counterparty"]);
    const notifications = trimOrNull(rowData["Notifications"] ?? rowData["Notification"]);
    const importFingerprint = buildImportFingerprint({
      accountIdentifier: accountInfo?.identifier ?? DEFAULT_ACCOUNT_IDENTIFIER,
      date,
      amountMinor,
      description,
      counterparty,
      notifications,
    });

    return {
      base: {
        userId,
        date,
        description,
        normalizedKey,
        // Store amountMinor as positive minor units; direction holds the sign semantics
        amountMinor, // Prisma BigInt
        currency: "EUR",
        direction,
        source: "Excel Import",
        hash,
        importFingerprint,
        sourceFile: path.basename(file),
        counterparty,
        reference: trimOrNull(rowData["Reference"]),
        classificationSource: TransactionClassificationSource.manual,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      categoryLabel,
      mainCategoryName,
      categoryName,
      accountInfo,
      rowData,
    };
  });

  if (records.length !== 224)
    throw new Error(`Expected 224 prepared records, got ${records.length}`);

  const prisma = new PrismaClient();
  try {
    // ✅ Ensure user exists before importing
    console.log(`👤 Ensuring ${userId} user exists...`);
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: "local@test.com",
      },
    });

    console.log("🧹 Deleting all existing transactions...");
    await prisma.transaction.deleteMany({});

    const categoryLabels = Array.from(
      new Set(
        records
          .map((record) => record.categoryLabel)
          .filter((value) => value != null)
      )
    );

    const categoryIds = new Map();
    if (categoryLabels.length) {
      const existing = await prisma.category.findMany({
        where: { name: { in: categoryLabels } },
      });
      existing.forEach((category) => categoryIds.set(category.name, category.id));
      for (const label of categoryLabels) {
        if (categoryIds.has(label)) continue;
        const created = await prisma.category.create({
          data: { name: label },
        });
        categoryIds.set(label, created.id);
      }
    }

    const accountIdentifiers = Array.from(
      new Set(
        records
          .map((record) => record.accountInfo?.identifier ?? null)
          .filter((value) => value != null)
      )
    );

    const accountIds = new Map();
    if (accountIdentifiers.length) {
      const existingAccounts = await prisma.account.findMany({
        where: {
          userId,
          identifier: { in: accountIdentifiers },
        },
      });
      for (const account of existingAccounts) {
        accountIds.set(account.identifier, account.id);
        const exampleName = records.find(
          (record) => record.accountInfo?.identifier === account.identifier
        )?.accountInfo?.name;
        if (exampleName && account.name !== exampleName) {
          await prisma.account.update({
            where: { id: account.id },
            data: { name: exampleName },
          });
        }
      }
      for (const identifier of accountIdentifiers) {
        if (accountIds.has(identifier)) continue;
        const example = records.find(
          (record) => record.accountInfo?.identifier === identifier
        )?.accountInfo;
        const created = await prisma.account.create({
          data: {
            userId,
            identifier,
            name: example?.name ?? identifier,
          },
        });
        accountIds.set(identifier, created.id);
      }
    }

    const preparedRecords = records.map((record) => ({
      ...record.base,
      categoryId: record.categoryLabel
        ? categoryIds.get(record.categoryLabel) ?? null
        : null,
      accountId: record.accountInfo
        ? accountIds.get(record.accountInfo.identifier) ?? null
        : null,
      rawRow: {
        columns: record.rowData,
        mainCategoryName: record.mainCategoryName,
        categoryName: record.categoryName,
        accountIdentifier: record.accountInfo?.identifier ?? null,
      },
    }));

    console.log("🧾 First record preview:", preparedRecords[0]);

    console.log(`📥 Importing ${preparedRecords.length} transactions...`);
    const res = await prisma.transaction.createMany({ data: preparedRecords });
    console.log(`✅ Imported ${res.count}`);

    const verify = await prisma.transaction.count();
    if (verify !== 224)
      throw new Error(`❌ Verification failed: got ${verify}, expected 224`);

    const total = await prisma.transaction.aggregate({
      _sum: { amountMinor: true },
    });
    console.log(`📊 Total EUR (minor units): ${total._sum.amountMinor ?? 0}`);
    console.log("🎉 Import complete!");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Import failed:", err.message);
  process.exit(1);
});
