import { Prisma, PrismaClient, TransactionClassificationSource } from '@prisma/client';
import { prisma } from '../prismaClient';
import { parseIngCsv } from '../../lib/import/csv_ING';
import { parseInitialWorkbook } from '../../lib/import/xlsx';
import { attachHashes, partitionDuplicates } from '../../lib/import/dedupe';
import { deriveDirection, normalizeWhitespace } from '../../lib/import/normalizers';
import type { ImportSummary, ImportSummaryRowError, ImportFormat, ParsedRowSuccess } from '../../lib/import/types';
import { categorizeTransaction } from './categorizationService';
import { fetchActiveRules } from './ruleEngine';
import {
  LedgerMismatchError,
  MissingOpeningBalanceError,
  validateLedgerBalance,
} from './reconciliationService';
import {
  buildExactMatchIndex as buildLedgerExactMatchIndex,
  buildLedgerMatchCandidates,
  buildFuzzyMatchIndex,
  findExactLedgerMatch,
  findFuzzyLedgerMatch,
  normalizeMatchableTransaction,
  type LedgerMatchSource,
} from './transactionMatching';

interface ProcessImportOptions {
  buffer: Buffer;
  filename: string;
  userId: string;
}

type Direction = 'credit' | 'debit';

type TxClient = Prisma.TransactionClient;

const LOCKS_ENABLED = process.env.RECONCILIATION_LOCKS_ENABLED !== 'false';

const HISTORY_MATCH_FIELD_GROUPS: Array<string[]> = [
  ['Name / Description'],
  ['Account'],
  ['Counterparty'],
  ['Code'],
  ['Debit/credit'],
  ['Amount (EUR)'],
  ['Transaction type'],
  ['Notifications', 'Notification'],
];

const normalizeHistoryFieldValue = (value: unknown): string => {
  if (value == null) return '';
  return normalizeWhitespace(String(value)).toLowerCase();
};

const extractRawRecord = (rawRow: Prisma.JsonValue | null | undefined): Record<string, unknown> | null => {
  if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
    return null;
  }
  return rawRow as Record<string, unknown>;
};

const extractRawColumns = (rawRecord: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!rawRecord) return null;
  const columns = rawRecord.columns;
  if (columns && typeof columns === 'object' && !Array.isArray(columns)) {
    return columns as Record<string, unknown>;
  }
  return null;
};

const readRawValue = (
  rawRecord: Record<string, unknown> | null,
  columns: Record<string, unknown> | null,
  key: string,
): unknown => {
  if (rawRecord && key in rawRecord && rawRecord[key] != null) {
    return rawRecord[key];
  }
  if (columns && key in columns && columns[key] != null) {
    return columns[key];
  }
  return null;
};

type HistoryKeyFallback = {
  description?: string | null;
  accountIdentifier?: string | null;
  counterparty?: string | null;
  code?: string | null;
  debitCredit?: string | null;
  amountMinor?: bigint | null;
  transactionType?: string | null;
  notifications?: string | null;
};

const buildHistoryMatchKey = (
  rawRow: Prisma.JsonValue | null | undefined,
  fallback?: HistoryKeyFallback,
): string | null => {
  const rawRecord = extractRawRecord(rawRow);
  if (!rawRecord) return null;
  const columns = extractRawColumns(rawRecord);
  const values = HISTORY_MATCH_FIELD_GROUPS.map((fieldKeys) => {
    for (const key of fieldKeys) {
      const value = readRawValue(rawRecord, columns, key);
      if (value != null && String(value).trim().length > 0) {
        return normalizeHistoryFieldValue(value);
      }
    }
    if (fallback) {
      const fallbackMap: Record<string, unknown> = {
        'Name / Description': fallback.description,
        Account: fallback.accountIdentifier,
        Counterparty: fallback.counterparty,
        Code: fallback.code,
        'Debit/credit': fallback.debitCredit,
        'Amount (EUR)': fallback.amountMinor != null ? Number(fallback.amountMinor) / 100 : null,
        'Transaction type': fallback.transactionType,
        Notifications: fallback.notifications,
      };
      for (const key of fieldKeys) {
        if (fallbackMap[key] != null) {
          return normalizeHistoryFieldValue(fallbackMap[key]);
        }
      }
    }
    return '';
  });
  if (!values.some((value) => value.length > 0)) {
    return null;
  }
  return values.join('|');
};

const toJsonValue = (value: unknown): Prisma.JsonValue => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item)) as Prisma.JsonArray;
  }
  if (typeof value === 'object') {
    const obj: Prisma.JsonObject = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      const jsonValue = toJsonValue(val);
      if (jsonValue !== undefined) {
        obj[key] = jsonValue;
      }
    });
    return obj;
  }
  return String(value);
};

const toJsonObject = (source: Record<string, unknown>): Prisma.JsonObject => {
  const result: Prisma.JsonObject = {};
  Object.entries(source).forEach(([key, value]) => {
    const jsonValue = toJsonValue(value);
    if (jsonValue !== undefined) {
      result[key] = jsonValue;
    }
  });
  return result;
};

const ledgerCacheKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${month}`;
};

const normalizeAccountName = (value: string | null): string => {
  if (!value) return 'Unknown account';
  return normalizeWhitespace(value);
};

const splitCategoryLabel = (value: string | null | undefined): { main: string | null; sub: string | null } => {
  if (!value) {
    return { main: null, sub: null };
  }
  const segments = value.split(' — ');
  if (segments.length === 1) {
    const label = segments[0]!.trim();
    return {
      main: label || null,
      sub: label || null,
    };
  }

  const main = segments[0]!.trim() || null;
  const sub = segments.slice(1).join(' — ').trim() || main;

  return {
    main,
    sub,
  };
};

export class LockedPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockedPeriodError';
  }
}

const autoLockLedger = async (tx: TxClient, ledgerId: string, userId: string) => {
  if (!LOCKS_ENABLED) {
    return;
  }

  const existing = await tx.ledger.findUnique({
    where: { id: ledgerId },
    select: {
      lockedAt: true,
    },
  });

  if (!existing || existing.lockedAt) {
    return;
  }

  const now = new Date();

  await tx.ledger.update({
    where: { id: ledgerId },
    data: {
      lockedAt: now,
      lockedBy: userId,
      lockNote: 'Auto-locked after reconciliation',
    },
  });

  await tx.ledgerLock.upsert({
    where: {
      ledgerId,
    },
    create: {
      ledgerId,
      lockedAt: now,
      lockedBy: userId,
      note: 'Auto-locked after reconciliation',
    },
    update: {
      lockedAt: now,
      lockedBy: userId,
      note: 'Auto-locked after reconciliation',
    },
  });
};

const ensureLedger = async (tx: TxClient, userId: string, date: Date): Promise<string> => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const uniqueWhere = {
    userId_month_year: {
      userId,
      month,
      year,
    },
  } as const;

  const existing = await tx.ledger.findUnique({
    where: uniqueWhere,
    select: {
      id: true,
      lockedAt: true,
    },
  });

  if (existing) {
    if (LOCKS_ENABLED && existing.lockedAt) {
      throw new LockedPeriodError(`Ledger ${year}-${month} is locked`);
    }
    return existing.id;
  }

  const created = await tx.ledger.create({
    data: {
      userId,
      month,
      year,
    },
  });
  return created.id;
};

const detectFormat = (filename: string): ImportFormat => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) {
    return 'xlsx_initial';
  }
  return 'csv_ing';
};

const parseBuffer = async (format: ImportFormat, buffer: Buffer) => {
  if (format === 'xlsx_initial') {
    return parseInitialWorkbook(buffer);
  }
  return parseIngCsv(buffer);
};

const ensureAccounts = async (
  tx: TxClient,
  userId: string,
  rows: ParsedRowSuccess[],
): Promise<Map<string, string>> => {
  const cache = new Map<string, string>();
  const seen = new Set<string>();

  for (const row of rows) {
    const identifier = row.accountIdentifier;
    if (seen.has(identifier)) {
      continue;
    }

    seen.add(identifier);

    const account = await tx.account.upsert({
      where: {
        userId_identifier: {
          userId,
          identifier,
        },
      },
      update: {
        name: normalizeAccountName(row.accountName ?? identifier),
      },
      create: {
        userId,
        identifier,
        name: normalizeAccountName(row.accountName ?? identifier),
        currency: row.currency,
      },
    });

    cache.set(identifier, account.id);
  }

  return cache;
};

const CHUNK_SIZE = 250;

const chunk = <T>(items: T[], size: number): T[][] => {
  if (items.length <= size) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const REVIEW_CATEGORY_NAME = 'Needs Review';

type SuggestionConfidence =
  | 'exact'
  | 'description'
  | 'account'
  | 'overall'
  | 'rule'
  | 'review'
  | 'fuzzy';

type SuggestionIndex = Map<string, Map<string, number>>;

const sanitizeIdentifier = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

const incrementCounter = (map: SuggestionIndex, key: string, categoryId: string) => {
  if (!key) return;
  let bucket = map.get(key);
  if (!bucket) {
    bucket = new Map<string, number>();
    map.set(key, bucket);
  }
  bucket.set(categoryId, (bucket.get(categoryId) ?? 0) + 1);
};

const pickDominant = (bucket?: Map<string, number>): { categoryId: string | null; count: number } => {
  if (!bucket) return { categoryId: null, count: 0 };
  let bestCategory: string | null = null;
  let bestCount = 0;
  bucket.forEach((count, categoryId) => {
    if (count > bestCount) {
      bestCategory = categoryId;
      bestCount = count;
    }
  });
  return { categoryId: bestCategory, count: bestCount };
};

const buildSuggestionIndex = (
  history: Array<{ accountIdentifier: string | null; normalizedKey: string; amountMinor: bigint; categoryId: string }>,
): SuggestionIndex => {
  const index: SuggestionIndex = new Map();

  history.forEach((entry) => {
    if (!entry.categoryId) return;
    const accountKey = sanitizeIdentifier(entry.accountIdentifier ?? '');
    const normalizedKey = entry.normalizedKey ?? '';
    const amountKey = entry.amountMinor.toString();
    incrementCounter(index, `${accountKey}|${amountKey}|${normalizedKey}`, entry.categoryId);
  });

  return index;
};

const registerSuggestion = (
  index: SuggestionIndex,
  accountIdentifier: string | null,
  normalizedKey: string,
  amountMinor: bigint,
  categoryId: string,
) => {
  const accountKey = sanitizeIdentifier(accountIdentifier ?? '');
  const amountKey = amountMinor.toString();
  incrementCounter(index, `${accountKey}|${amountKey}|${normalizedKey}`, categoryId);
};

const suggestCategoryFromIndex = (
  index: SuggestionIndex,
  accountIdentifier: string | null,
  normalizedKey: string,
  amountMinor: bigint,
): { categoryId: string | null; confidence: SuggestionConfidence } | null => {
  const accountKey = sanitizeIdentifier(accountIdentifier ?? '');
  const amountKey = amountMinor.toString();
  const exactBucket = index.get(`${accountKey}|${amountKey}|${normalizedKey}`);
  const exact = pickDominant(exactBucket);
  if (exact.categoryId) {
    return { categoryId: exact.categoryId, confidence: 'exact' };
  }
  return null;
};

const ensureReviewCategory = async (tx: TxClient): Promise<string> => {
  const category = await tx.category.upsert({
    where: { name: REVIEW_CATEGORY_NAME },
    update: {},
    create: { name: REVIEW_CATEGORY_NAME },
  });

  return category.id;
};

export const processImportBufferWithClient = async (
  client: PrismaClient,
  {
    buffer,
    filename,
    userId,
  }: ProcessImportOptions,
): Promise<ImportSummary> => {
  const format = detectFormat(filename);
  const parsed = await parseBuffer(format, buffer);
  const totalRows = parsed.successes.length + parsed.errors.length;

  return client.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        userId,
        filename,
        fileType: format,
        status: 'pending',
        totalRows,
        errorRows: parsed.errors.length,
      },
    });

    const errors: ImportSummaryRowError[] = parsed.errors.map((error) => ({
      rowNumber: error.rowNumber,
      message: error.message,
    }));

    if (!parsed.successes.length) {
      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: 'completed',
          importedRows: 0,
          duplicateRows: 0,
          completedAt: new Date(),
        },
      });

      return {
        filename,
        format,
        totalRows,
        importedCount: 0,
        duplicateCount: 0,
        errorCount: parsed.errors.length,
        autoCategorizedCount: 0,
        pendingReviewCount: 0,
        batchId: batch.id,
        errors,
      };
    }

    const hashedRows = attachHashes(userId, parsed.successes);
    const enrichedRows = format === 'xlsx_initial'
      ? hashedRows.map((row) => ({ ...row, hash: `${row.hash}|${row.rowNumber}` }))
      : hashedRows;

    const existing = await tx.transaction.findMany({
      where: {
        hash: {
          in: enrichedRows.map((row) => row.hash),
        },
      },
      select: {
        hash: true,
      },
    });

    const existingHashes = new Set(existing.map((entry) => entry.hash));
    const { uniques, duplicates } = partitionDuplicates(enrichedRows, existingHashes);

    const accountMap = await ensureAccounts(tx, userId, uniques);
    const activeRules = await fetchActiveRules(tx, userId);
    const categoriesLookup = await tx.category.findMany({
      select: {
        id: true,
        name: true,
      },
    });
    const categoryNameLookup = new Map<string, string>();
    categoriesLookup.forEach((category) => {
      categoryNameLookup.set(category.id, category.name);
    });

    const ledgerIds = new Map<string, string>();
    const ensureLedgerCached = async (date: Date) => {
      const key = ledgerCacheKey(date);
      const cached = ledgerIds.get(key);
      if (cached) {
        return cached;
      }
      const ledgerId = await ensureLedger(tx, userId, date);
      ledgerIds.set(key, ledgerId);
      return ledgerId;
    };

    const reviewCategoryId = await ensureReviewCategory(tx);

    const historyForSuggestionsRaw = await tx.transaction.findMany({
      where: {
        userId,
        categoryId: {
          not: null,
        },
        classificationSource: 'manual',
      },
      select: {
        categoryId: true,
        amountMinor: true,
        normalizedKey: true,
        account: {
          select: {
            identifier: true,
          },
        },
      },
    });

    const suggestionIndex = buildSuggestionIndex(
      historyForSuggestionsRaw.map((entry) => ({
        categoryId: entry.categoryId!,
        amountMinor: entry.amountMinor,
        normalizedKey: entry.normalizedKey ?? '',
        accountIdentifier: entry.account?.identifier ?? null,
      })),
    );

    const historyMatchCandidates = await tx.transaction.findMany({
      where: {
        userId,
        categoryId: {
          not: null,
        },
      },
      select: {
        categoryId: true,
        description: true,
        counterparty: true,
        reference: true,
        rawRow: true,
        amountMinor: true,
        account: {
          select: {
            identifier: true,
          },
        },
        source: true,
      },
    });

    const historyMatchIndex = new Map<string, string>();
    historyMatchCandidates.forEach((entry) => {
      if (!entry.categoryId) return;
      const fallback: HistoryKeyFallback = {
        description: entry.description,
        accountIdentifier: entry.account?.identifier ?? null,
        counterparty: entry.counterparty,
        debitCredit: entry.amountMinor >= 0n ? 'Credit' : 'Debit',
        amountMinor: entry.amountMinor < 0n ? entry.amountMinor * -1n : entry.amountMinor,
        transactionType: entry.source,
      };
      const key = buildHistoryMatchKey(entry.rawRow, fallback);
      if (!key) return;
      if (!historyMatchIndex.has(key)) {
        historyMatchIndex.set(key, entry.categoryId);
      }
    });

    const manualLedgerTransactions = await tx.transaction.findMany({
      where: {
        userId,
        categoryId: {
          not: null,
        },
        classificationSource: 'manual',
      },
      select: {
        id: true,
        categoryId: true,
        description: true,
        amountMinor: true,
        direction: true,
        account: {
          select: {
            identifier: true,
          },
        },
        counterparty: true,
        rawRow: true,
        createdAt: true,
      },
    });

    const ledgerMatchSources: LedgerMatchSource[] = manualLedgerTransactions.map((entry) => ({
      transactionId: entry.id,
      categoryId: entry.categoryId!,
      description: entry.description,
      amountMinor: entry.amountMinor,
      direction: entry.direction,
      accountIdentifier: entry.account?.identifier ?? null,
      counterparty: entry.counterparty,
      raw: entry.rawRow,
      createdAt: entry.createdAt,
    }));

    const ledgerMatchCandidates = buildLedgerMatchCandidates(ledgerMatchSources);
    const ledgerExactMatchIndex = buildLedgerExactMatchIndex(ledgerMatchCandidates);
    const ledgerFuzzyMatchIndex = buildFuzzyMatchIndex(ledgerMatchCandidates);
    let autoCategorized = 0;
    let imported = 0;
    const reconciliationTargets = new Map<string, { accountId: string; month: number; year: number; ledgerId: string }>();

    const now = new Date();

    const chunkedRecords: Array<typeof uniques> = chunk(uniques, CHUNK_SIZE);

    for (const group of chunkedRecords) {
      const records: Array<{
        userId: string;
        accountId: string | null;
        ledgerId: string;
        importBatchId: string;
        date: Date;
        description: string;
        normalizedKey: string;
        amountMinor: bigint;
        currency: string;
        direction: Direction;
        source: string;
        counterparty: string | null | undefined;
        reference: string | null | undefined;
        hash: string;
        sourceFile: string;
        rawRow: Prisma.InputJsonValue;
        categoryId: string;
        classificationSource: TransactionClassificationSource;
        classificationRuleId: string | null;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      for (const row of group) {
        const ledgerId = await ensureLedgerCached(row.date);
        const accountId = accountMap.get(row.accountIdentifier) ?? null;

        const direction = deriveDirection(row.amountMinor);
        const accountIdentifierForMatch = row.accountIdentifier ?? null;
        const historyMatchKey = buildHistoryMatchKey(row.raw as Prisma.JsonValue, {
          description: row.description,
          accountIdentifier: row.accountIdentifier,
          counterparty: row.counterparty,
          debitCredit: direction === 'credit' ? 'Credit' : 'Debit',
          amountMinor: row.amountMinor < 0n ? row.amountMinor * -1n : row.amountMinor,
          transactionType: (row.raw && (row.raw as Record<string, unknown>)['Transaction type']) as
            | string
            | null,
          code: (row.raw && (row.raw as Record<string, unknown>)['Code']) as string | null,
          notifications: (row.raw &&
            ((row.raw as Record<string, unknown>)['Notifications'] ??
              (row.raw as Record<string, unknown>)['Notification'])) as string | null,
        });

        let categoryId: string | null = null;
        let classificationSource: TransactionClassificationSource = 'import';
        let classificationRuleId: string | null = null;
        let suggestionConfidence: SuggestionConfidence = 'review';

        const normalizedLedgerMatchInput = normalizeMatchableTransaction({
          description: row.description,
          amountMinor: row.amountMinor,
          direction,
          accountIdentifier: row.accountIdentifier,
          counterparty: row.counterparty ?? null,
          raw: row.raw,
        });

        if (historyMatchKey && historyMatchIndex.has(historyMatchKey)) {
          categoryId = historyMatchIndex.get(historyMatchKey)!;
          classificationSource = 'history';
          suggestionConfidence = 'exact';
        } else if (normalizedLedgerMatchInput) {
          const exactLedgerMatch = findExactLedgerMatch(normalizedLedgerMatchInput, ledgerExactMatchIndex);
          if (exactLedgerMatch) {
            categoryId = exactLedgerMatch.categoryId;
            classificationSource = 'history';
            suggestionConfidence = 'exact';
          } else {
            const fuzzyLedgerMatch = findFuzzyLedgerMatch(
              normalizedLedgerMatchInput,
              ledgerFuzzyMatchIndex,
            );
            if (fuzzyLedgerMatch) {
              categoryId = fuzzyLedgerMatch.categoryId;
              classificationSource = 'import';
              suggestionConfidence = 'fuzzy';
            }
          }
        }

        if (!categoryId) {
          const categorization = await categorizeTransaction(
            tx,
            {
              userId,
              source: row.source,
              normalizedDescription: row.normalizedDescription,
              description: row.description,
              amountMinor: row.amountMinor,
              accountIdentifier: row.accountIdentifier,
              counterparty: row.counterparty,
              reference: row.reference,
            },
            { rules: activeRules },
          );

          if (categorization.classificationSource === 'rule' && categorization.categoryId) {
            categoryId = categorization.categoryId;
            classificationSource = 'rule';
            classificationRuleId = categorization.ruleId;
            suggestionConfidence = 'rule';
          } else if (categorization.classificationSource === 'history' && categorization.categoryId) {
            categoryId = categorization.categoryId;
            classificationSource = 'import';
            suggestionConfidence = 'description';
          } else if (categorization.categoryId) {
            categoryId = categorization.categoryId;
            classificationSource = categorization.classificationSource;
          }
        }

        if (!categoryId) {
          const suggestion = suggestCategoryFromIndex(
            suggestionIndex,
            accountIdentifierForMatch,
            row.normalizedDescription,
            row.amountMinor,
          );

          if (suggestion && suggestion.categoryId) {
            categoryId = suggestion.categoryId;
            suggestionConfidence =
              suggestion.confidence === 'exact' ? 'description' : suggestion.confidence;
            classificationSource = 'import';
          } else {
            categoryId = reviewCategoryId;
            suggestionConfidence = 'review';
            classificationSource = 'import';
          }
        }

        const isAutoCategorized = classificationSource === 'history' || classificationSource === 'rule';
        if (isAutoCategorized) {
          autoCategorized += 1;
        }

          if (categoryId && categoryId !== reviewCategoryId) {
            registerSuggestion(
              suggestionIndex,
              accountIdentifierForMatch,
              row.normalizedDescription,
              row.amountMinor,
              categoryId,
            );
            if (historyMatchKey) {
              historyMatchIndex.set(historyMatchKey, categoryId);
            }
          }

          if (accountId) {
            const month = row.date.getUTCMonth() + 1;
            const year = row.date.getUTCFullYear();
            const key = `${accountId}|${year}|${month}`;
            if (!reconciliationTargets.has(key)) {
              reconciliationTargets.set(key, {
                accountId,
                month,
                year,
                ledgerId,
              });
            }
          }

        let suggestedMainName: string | null = null;
        let suggestedSubName: string | null = null;

        if (categoryId === reviewCategoryId) {
          const reviewLabel = categoryNameLookup.get(reviewCategoryId) ?? 'Needs manual categorization';
          const split = splitCategoryLabel(reviewLabel);
          suggestedMainName = split.main ?? 'Review';
          suggestedSubName = split.sub ?? reviewLabel;
        } else if (categoryId) {
          const categoryLabel = categoryNameLookup.get(categoryId) ?? null;
          const split = splitCategoryLabel(categoryLabel);
          suggestedMainName = split.main ?? categoryLabel;
          suggestedSubName = split.sub ?? categoryLabel;
        }

        const baseRaw = (row.raw ?? {}) as Record<string, unknown>;
        const canonicalColumns: Record<string, unknown> = {
          'Name / Description': row.description,
          Account: row.accountIdentifier,
          Counterparty: row.counterparty ?? baseRaw['Counterparty'] ?? null,
          Code: baseRaw['Code'] ?? null,
          'Debit/credit': baseRaw['Debit/credit'] ?? (direction === 'credit' ? 'Credit' : 'Debit'),
          'Amount (EUR)': Number(row.amountMinor) / 100,
          'Transaction type': baseRaw['Transaction type'] ?? row.source,
          Notifications: baseRaw['Notifications'] ?? baseRaw['Notification'] ?? null,
        };

        const existingColumns =
          typeof baseRaw.columns === 'object' && baseRaw.columns && !Array.isArray(baseRaw.columns)
            ? (baseRaw.columns as Record<string, unknown>)
            : {};

        const flattenedRaw = toJsonObject(
          Object.fromEntries(
            Object.entries(baseRaw).filter(([key]) => key !== 'columns' && key !== 'suggestion'),
          ),
        );

        const rawColumns = toJsonObject({
          ...existingColumns,
          ...flattenedRaw,
          ...canonicalColumns,
        });

        const rawPayload: Prisma.InputJsonValue = {
          ...flattenedRaw,
          columns: rawColumns,
          suggestion: {
            confidence: suggestionConfidence,
            matchedCategoryId: categoryId,
            matchedBy: classificationSource,
            mainCategoryName: suggestedMainName,
            categoryName: suggestedSubName,
          },
        };

        records.push({
          userId,
          accountId,
          ledgerId,
          importBatchId: batch.id,
          date: row.date,
          description: row.description,
          normalizedKey: row.normalizedDescription,
          amountMinor: row.amountMinor,
          currency: row.currency,
          direction,
          source: row.source,
          counterparty: row.counterparty,
          reference: row.reference,
          hash: row.hash,
          sourceFile: filename,
          rawRow: rawPayload,
          categoryId,
          classificationSource,
          classificationRuleId,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (!records.length) {
        continue;
      }

      const created = await tx.transaction.createMany({
        data: records,
        skipDuplicates: true,
      });

      imported += created.count;
    }

    const duplicateCount = duplicates.length + (uniques.length - imported);
    const pendingReview = imported;

    for (const target of reconciliationTargets.values()) {
      try {
        const validation = await validateLedgerBalance(tx, {
          userId,
          accountId: target.accountId,
          month: target.month,
          year: target.year,
        });

        if (validation.status === 'reconciled') {
          await autoLockLedger(tx, target.ledgerId, userId);
        }
      } catch (error) {
        if (error instanceof MissingOpeningBalanceError) {
          // Skip auto-lock when an opening balance has not been captured yet; imports still succeed.
          continue;
        }
        throw error;
      }
    }

    await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'completed',
        importedRows: imported,
        duplicateRows: duplicateCount,
        autoCategorizedRows: autoCategorized,
        errorRows: parsed.errors.length,
        completedAt: new Date(),
      },
    }).catch((): undefined => undefined);

    return {
      filename,
      format,
      totalRows,
      importedCount: imported,
      duplicateCount,
      errorCount: parsed.errors.length,
      autoCategorizedCount: autoCategorized,
      pendingReviewCount: pendingReview,
      batchId: batch.id,
      errors,
    };
  });
};

export const processImportBuffer = (options: ProcessImportOptions) =>
  processImportBufferWithClient(prisma, options);
