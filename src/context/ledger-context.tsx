'use client';

import Papa, { ParseResult } from 'papaparse';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchLedger,
  uploadImportFile,
  fetchCategorizationRules,
  createCategorizationRule,
  updateCategorizationRule,
  deleteCategorizationRule,
} from '@/libs/api';

type AccountLabelEntry = {
  keys: string[];
  label: string;
  altLabel?: string;
  altPattern?: RegExp;
  identifier?: string;
};

const ACCOUNT_LABEL_ENTRIES: AccountLabelEntry[] = [
  {
    keys: ['NL89INGB0006369960'],
    label: 'Yeshua Academy',
    identifier: 'NL89INGB0006369960',
    altLabel: 'Vila Solidária',
    altPattern: /VILA|SOLIDARIA/i,
  },
  {
    keys: ['R 951-98945', 'R95198945'],
    label: 'Fellowship Renswoude',
    identifier: 'R 951-98945',
  },
  {
    keys: ['K 577-97642', 'K57797642'],
    label: 'Fellowship Veluwe',
    identifier: 'K 577-97642',
  },
  {
    keys: ['C 951-98936', 'C95198936'],
    label: 'Fellowship Barneveld',
    identifier: 'C 951-98936',
  },
  {
    keys: ['F 951-98948', 'F95198948'],
    label: 'Yeshua Academy Savings',
    identifier: 'F 951-98948',
  },
];

const normalizeAccountKey = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();

const ACCOUNT_LABEL_LOOKUP: Map<string, AccountLabelEntry> = ACCOUNT_LABEL_ENTRIES.reduce(
  (acc, entry) => {
    entry.keys.forEach((key) => acc.set(normalizeAccountKey(key), entry));
    return acc;
  },
  new Map<string, AccountLabelEntry>(),
);

const normalizeRuleResponse = (rule: any): RuleSummary => ({
  id: rule.id,
  label: rule.label,
  pattern: rule.pattern,
  matchType: rule.matchType,
  matchField: rule.matchField,
  categoryId: rule.categoryId,
  categoryName: rule.category?.name ?? null,
  priority: rule.priority,
  isActive: rule.isActive,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

const sortRules = (a: RuleSummary, b: RuleSummary) => {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
};

const resolveAccountMetadata = (
  rawValue: string | null | undefined,
): { label: string | null; identifier: string | null } => {
  if (!rawValue) {
    return { label: null, identifier: null };
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { label: null, identifier: null };
  }

  const normalized = normalizeAccountKey(trimmed);
  let entry = ACCOUNT_LABEL_LOOKUP.get(normalized);
  if (!entry) {
    for (const candidate of ACCOUNT_LABEL_ENTRIES) {
      if (candidate.keys.some((key) => normalized.includes(normalizeAccountKey(key)))) {
        entry = candidate;
        break;
      }
    }
  }
  if (!entry) {
    return { label: null, identifier: null };
  }

  let label = entry.label;
  if (
    entry.altLabel &&
    entry.altPattern &&
    (entry.altPattern.test(trimmed) || entry.altPattern.test(normalized))
  ) {
    label = entry.altLabel;
  }

  return {
    label,
    identifier: entry.identifier ?? trimmed,
  };
};

type UUID = string;

type RuleSummary = {
  id: string;
  label: string;
  pattern: string;
  matchType: string;
  matchField: string;
  categoryId: string;
  categoryName?: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type RuleInput = {
  label: string;
  pattern: string;
  categoryId: string;
  matchType?: string;
  matchField?: string;
  priority?: number;
  isActive?: boolean;
};

type LedgerMeta = {
  id: string;
  month: number;
  year: number;
  lockedAt: string | null;
  lockedBy: string | null;
  lockNote: string | null;
};

type ApiLedgerTransaction = {
  id: string;
  date: string | Date;
  description: string;
  amount: number;
  amountMinor?: string;
  currency?: string;
  direction?: 'credit' | 'debit';
  source: string;
  counterparty?: string | null;
  reference?: string | null;
  accountLabel?: string | null;
  accountIdentifier?: string | null;
  sourceFile?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  mainCategoryName?: string | null;
  ledgerMonth?: number | null;
  ledgerYear?: number | null;
  createdAt?: string | Date | null;
  runningBalance?: number | null;
  runningBalanceMinor?: string | null;
  classificationSource?: string | null;
  classificationRuleId?: string | null;
  classificationRuleLabel?: string | null;
  ledgerLockedAt?: string | Date | null;
  suggestionConfidence?: 'exact' | 'description' | 'account' | 'overall' | 'rule' | 'review' | null;
  suggestedMainCategoryName?: string | null;
  suggestedSubCategoryName?: string | null;
  rawMainCategoryName?: string | null;
  rawCategoryName?: string | null;
};

type ApiLedgerSummary = {
  total: number;
  reviewCount: number;
  autoCategorized: number;
  totalAmount: number;
};

type ApiLedgerResponse = {
  transactions: ApiLedgerTransaction[];
  summary: ApiLedgerSummary;
  ledgers?: Array<{
    id: string;
    month: number;
    year: number;
    lockedAt: string | null;
    lockedBy: string | null;
    lockNote: string | null;
  }>;
};

export interface Category {
  id: UUID;
  name: string;
  parentId: UUID | null;
  color?: string | null;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export const deriveMainCategoryId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const slug = slugify(value);
  if (!slug) return null;
  return `main:${slug}`;
};

const splitCategoryLabel = (
  value?: string | null,
): { main: string | null; sub: string | null } => {
  if (!value) {
    return { main: null, sub: null };
  }

  const parts = value.split(' — ');
  if (parts.length === 1) {
    const trimmed = parts[0]!.trim();
    const safe = trimmed.length ? trimmed : null;
    return { main: safe, sub: safe };
  }

  const main = parts[0]!.trim();
  const sub = parts.slice(1).join(' — ').trim();
  return {
    main: main.length ? main : null,
    sub: sub.length ? sub : (main.length ? main : null),
  };
};

const firstNonEmpty = (values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (trimmed.length) return trimmed;
  }
  return null;
};

const distinctFrom = (value: string | null, other: string | null): string | null => {
  if (!value) return null;
  if (!other) return value;
  return value.trim() === other.trim() ? null : value;
};

const deriveCategoryNames = (
  tx: Pick<
    ApiLedgerTransaction,
    | 'mainCategoryName'
    | 'categoryName'
    | 'suggestedMainCategoryName'
    | 'suggestedSubCategoryName'
    | 'rawMainCategoryName'
    | 'rawCategoryName'
  >,
) => {
  const fromCategory = splitCategoryLabel(tx.categoryName ?? null);
  const fromSuggestedSub = splitCategoryLabel(tx.suggestedSubCategoryName ?? null);
  const fromSuggestedMain = splitCategoryLabel(tx.suggestedMainCategoryName ?? null);
  const fromRawSub = splitCategoryLabel(tx.rawCategoryName ?? null);
  const fromRawMain = splitCategoryLabel(tx.rawMainCategoryName ?? null);

  const mainCandidates = [
    tx.mainCategoryName,
    fromSuggestedMain.main,
    fromRawMain.main,
    fromCategory.main,
    fromSuggestedSub.main,
    fromRawSub.main,
  ];

  const mainName = firstNonEmpty(mainCandidates);

  const subCandidatesPrimary = [
    distinctFrom(fromCategory.sub, mainName),
    distinctFrom(fromSuggestedSub.sub, mainName),
    distinctFrom(fromRawSub.sub, mainName),
  ];

  const subName =
    firstNonEmpty(subCandidatesPrimary) ??
    firstNonEmpty([fromCategory.sub, fromSuggestedSub.sub, fromRawSub.sub]) ??
    mainName ??
    null;

  const suggestedMainName = firstNonEmpty([
    fromSuggestedMain.main,
    fromRawMain.main,
    mainName,
  ]);

  const suggestedSubName =
    firstNonEmpty([
      distinctFrom(fromSuggestedSub.sub, mainName),
      distinctFrom(fromRawSub.sub, mainName),
      subName,
    ]) ?? subName ?? null;

  const rawMainName = fromRawMain.main;
  const rawSubName = distinctFrom(fromRawSub.sub, rawMainName) ?? fromRawSub.sub ?? rawMainName;

  return {
    mainName: mainName ?? null,
    subName: subName ?? null,
    suggestedMainName: suggestedMainName ?? null,
    suggestedSubName: suggestedSubName ?? null,
    rawMainName: rawMainName ?? null,
    rawSubName: rawSubName ?? null,
  };
};

export interface LedgerTransaction {
  id: UUID;
  date: string; // ISO
  description: string;
  amount: number;
  direction?: 'credit' | 'debit';
  source: string;
  accountLabel: string | null;
  accountIdentifier: string | null;
  normalizedKey: string;
  notificationDetail: string | null;
  categoryId: UUID | null;
  categoryName: string | null;
  mainCategoryId: UUID | null;
  mainCategoryName: string | null;
  ledgerMonth: number;
  ledgerYear: number;
  createdAt: string;
  autoCategorized: boolean;
  needsManualCategory: boolean;
  runningBalance?: number | null;
  runningBalanceMinor?: string | null;
  classificationSource?: string;
  classificationRuleId?: string | null;
  classificationRuleLabel?: string | null;
  ledgerLockedAt?: string | null;
  suggestionConfidence?: 'exact' | 'description' | 'account' | 'overall' | 'rule' | 'review' | null;
  suggestedMainCategoryName?: string | null;
  suggestedSubCategoryName?: string | null;
  rawMainCategoryName?: string | null;
  rawCategoryName?: string | null;
}

interface ImportSummary {
  importedCount: number;
  autoCategorized: number;
  reviewCount: number;
  duplicateCount?: number;
  errorCount?: number;
  totalRows?: number;
  format?: string;
  batchId?: string;
  errors?: Array<{ rowNumber: number; message: string }>;
}

interface LedgerState {
  transactions: LedgerTransaction[];
  categories: Category[];
}

export interface CategoryTree {
  main: Category[];
  byParent: Record<string, Category[]>;
}

interface LedgerContextValue {
  transactions: LedgerTransaction[];
  categories: Category[];
  categoryTree: CategoryTree;
  summary: {
    total: number;
    reviewCount: number;
    autoCategorized: number;
    totalAmount: number;
  };
  reviewTransactions: LedgerTransaction[];
  importCsv: (file: File) => Promise<ImportSummary>;
  assignCategory: (
    transactionId: UUID,
    options: { categoryId?: UUID | null; mainCategoryId?: UUID | null; categoryName?: string }
  ) => Promise<void>;
  clearAll: () => void;
  serverPipelineEnabled: boolean;
  rules: RuleSummary[];
  refreshRules: () => Promise<void>;
  createRule: (payload: RuleInput) => Promise<void>;
  updateRule: (id: string, payload: Partial<RuleInput>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  ledgerMeta: LedgerMeta[];
}

const LedgerContext = createContext<LedgerContextValue | undefined>(undefined);

const COLOR_PALETTE = ['#4C6EF5', '#15AABF', '#40C057', '#FCC419', '#FF6B6B', '#7950F2', '#F06595', '#20C997'];

const PIPELINE_MODE = process.env.NEXT_PUBLIC_IMPORT_PIPELINE_MODE ?? 'server';
const USE_SERVER_PIPELINE = PIPELINE_MODE !== 'client';

const REVIEW_MAIN_CATEGORY: Category = {
  id: 'cat-review',
  name: 'Review',
  parentId: null,
  color: '#FF922B',
};

const REVIEW_SUB_CATEGORY: Category = {
  id: 'sub-review-needs-category',
  name: 'Needs manual categorization',
  parentId: REVIEW_MAIN_CATEGORY.id,
  color: '#FFA94D',
};

const normaliseDescription = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const mapApiTransaction = (tx: ApiLedgerTransaction): LedgerTransaction => {
  const parsedDate = tx.date instanceof Date ? tx.date : new Date(tx.date);
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const isoDate = safeDate.toISOString();
  const normalizedKey = normaliseDescription(tx.description);
  const ledgerMonth = tx.ledgerMonth ?? safeDate.getUTCMonth() + 1;
  const ledgerYear = tx.ledgerYear ?? safeDate.getUTCFullYear();
  const createdAtSource = tx.createdAt ? new Date(tx.createdAt) : safeDate;
  const createdAt = Number.isNaN(createdAtSource.getTime()) ? isoDate : createdAtSource.toISOString();
  const runningMinor = tx.runningBalanceMinor ?? (typeof tx.runningBalance === 'number' ? String(Math.round(tx.runningBalance * 100)) : null);
  const runningBalance = typeof tx.runningBalance === 'number'
    ? tx.runningBalance
    : runningMinor
    ? Number(runningMinor) / 100
    : null;
  const ledgerLockedAt = tx.ledgerLockedAt
    ? new Date(tx.ledgerLockedAt).toISOString()
    : null;
  const classification = tx.classificationSource ?? 'none';
  const autoCategorized = classification === 'history' || classification === 'rule';
  const needsManualCategory = classification !== 'manual';

  const {
    mainName,
    subName,
    suggestedMainName,
    suggestedSubName,
    rawMainName,
    rawSubName,
  } = deriveCategoryNames(tx);
  const mainCategoryId = deriveMainCategoryId(mainName);

  const baseAmount =
    typeof tx.amount === 'number'
      ? tx.amount
      : tx.amountMinor
      ? Number(tx.amountMinor) / 100
      : 0;
  const derivedDirection =
    tx.direction ?? (baseAmount < 0 ? 'debit' : 'credit');
  const signedAmount =
    derivedDirection === 'debit' ? -Math.abs(baseAmount) : Math.abs(baseAmount);

  return {
    id: tx.id,
    date: isoDate,
    description: tx.description,
    amount: signedAmount,
    direction: derivedDirection,
    source: tx.source,
    accountLabel: tx.accountLabel ?? tx.accountIdentifier ?? null,
    accountIdentifier: tx.accountIdentifier ?? null,
    normalizedKey,
    notificationDetail: tx.reference ?? null,
    categoryId: tx.categoryId ?? null,
    categoryName: subName,
    mainCategoryId,
    mainCategoryName: mainName,
    ledgerMonth,
    ledgerYear,
    createdAt,
    autoCategorized,
    needsManualCategory,
    runningBalance,
    runningBalanceMinor: runningMinor,
    classificationSource: tx.classificationSource ?? 'none',
    classificationRuleId: tx.classificationRuleId ?? null,
    classificationRuleLabel: tx.classificationRuleLabel ?? null,
    ledgerLockedAt,
    suggestionConfidence: tx.suggestionConfidence ?? null,
    suggestedMainCategoryName: suggestedMainName,
    suggestedSubCategoryName: suggestedSubName,
    rawMainCategoryName: rawMainName,
    rawCategoryName: rawSubName,
  };
};

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `gen-${Date.now()}-${Math.random()}`;

const parseDateString = (value: string): Date | null => {
  const trimmed = value.trim();

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6)) - 1;
    const day = Number(trimmed.slice(6, 8));
    return new Date(Date.UTC(year, month, day));
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.replace(/-/g, '/').split('/');
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseAmount = (value: string, debitCredit?: string): number | null => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/\u00A0/g, '').replace(/[^0-9.,-]/g, '');
  if (!cleaned) return null;

  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;

  if (commaCount > 0 && (dotCount === 0 || lastComma > lastDot)) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (dotCount > 0 && commaCount === 0) {
    if (dotCount > 1) {
      normalized = cleaned.replace(/\./g, '');
    } else {
      const decimals = cleaned.length - lastDot - 1;
      normalized = decimals === 3 ? cleaned.replace(/\./g, '') : cleaned;
    }
  } else if (dotCount > 0 && commaCount > 0 && lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned.replace(/[.,]/g, '');
  }

  normalized = normalized.replace(/(?!^)-/g, '');

  if (!normalized || normalized === '-' || normalized === '.') return null;

  const amount = Number(normalized);
  if (Number.isNaN(amount)) return null;

  const indicator = debitCredit?.trim().toLowerCase();
  if (indicator && (indicator.startsWith('debit') || indicator === 'af' || indicator === 'd')) {
    return amount * -1;
  }

  return amount;
};

const sanitizeNotification = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^Name:\s*/i, '').trim();
  return withoutPrefix.length ? withoutPrefix : null;
};

type ParsedRow = {
  [key: string]: string | undefined;
  date?: string;
  Date?: string;
  transactionDate?: string;
  description?: string;
  Description?: string;
  memo?: string;
  amount?: string;
  Amount?: string;
  transactionAmount?: string;
  source?: string;
  Source?: string;
  merchant?: string;
  'Name / Description'?: string;
  Counterparty?: string;
  'Counter Party'?: string;
  'Debit/credit'?: string;
  'Debit Credit'?: string;
  'Amount (EUR)'?: string;
  'Booking date'?: string;
  Notifications?: string;
  notifications?: string;
};

type CategorySuggestion = {
  categoryId: UUID | null;
  categoryName: string | null;
  mainCategoryId: UUID | null;
  mainCategoryName: string | null;
};

type SuggestionRecord = {
  suggestion: CategorySuggestion;
  count: number;
  lastSeen: number;
};

type SuggestionHistory = Map<string, Map<string, SuggestionRecord>>;

const parseCsvFile = (file: File): Promise<ParsedRow[]> =>
  new Promise((resolve, reject) => {
    const runParse = (delimiter?: string) => {
      Papa.parse<ParsedRow>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
        delimiter,
        complete: (results: ParseResult<ParsedRow>) => {
          const rows = results.data ?? [];
          if (!rows.length && delimiter === undefined) {
            runParse(';');
          } else {
            resolve(rows);
          }
        },
        error: (error) => reject(error),
      });
    };

    runParse();
  });

const buildTransactionFromRow = (row: ParsedRow): Omit<LedgerTransaction, 'categoryId' | 'categoryName' | 'mainCategoryId' | 'mainCategoryName' | 'autoCategorized' | 'needsManualCategory'> | null => {
  const rawDate = row.date ?? row.Date ?? row.transactionDate ?? row['Booking date'] ?? row['Date'];
  const rawDescription =
    row['Name / Description'] ?? row.description ?? row.Description ?? row.memo ?? row['Description'];
  const rawAmount = row['Amount (EUR)'] ?? row.amount ?? row.Amount ?? row.transactionAmount ?? row['Amount'];
  const rawSource =
    row.Counterparty ?? row['Counter Party'] ?? row.source ?? row.Source ?? row.merchant ?? rawDescription;
  const rawDebitCredit = row['Debit/credit'] ?? row['Debit Credit'];
  const notificationDetail = sanitizeNotification(row.Notifications ?? row.notifications);

  if (!rawDate || !rawDescription || !rawAmount) {
    return null;
  }

  const parsedDate = parseDateString(String(rawDate));
  const amount = parseAmount(String(rawAmount), rawDebitCredit);

  if (!parsedDate || amount === null) {
    return null;
  }

  const normalizedKey = normaliseDescription(String(rawDescription));
  const sourceValue = (rawSource ?? rawDescription).trim();
  const { label: accountLabel, identifier: accountIdentifier } = resolveAccountMetadata(rawSource ?? rawDescription);

  return {
    id: createId(),
    date: parsedDate.toISOString(),
    description: String(rawDescription).trim(),
    amount,
    direction: amount >= 0 ? 'credit' : 'debit',
    source: sourceValue,
    accountLabel: accountLabel ?? null,
    accountIdentifier: accountLabel ? accountIdentifier ?? sourceValue : null,
    normalizedKey,
    notificationDetail,
    ledgerMonth: parsedDate.getUTCMonth() + 1,
    ledgerYear: parsedDate.getUTCFullYear(),
    createdAt: new Date().toISOString(),
  };
};

const ensureCategoryIndex = (categories: Category[]): { map: Map<string, Category>; tree: CategoryTree } => {
  const map = new Map<string, Category>();
  const byParent: Record<string, Category[]> = {};

  categories.forEach((category) => {
    map.set(category.id, category);
    if (category.parentId) {
      if (!byParent[category.parentId]) {
        byParent[category.parentId] = [];
      }
      byParent[category.parentId].push(category);
    }
  });

  const main = categories.filter((cat) => !cat.parentId).sort((a, b) => a.name.localeCompare(b.name));
  Object.values(byParent).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

  return {
    map,
    tree: {
      main,
      byParent,
    },
  };
};

const DEFAULT_STATE: LedgerState = {
  categories: [REVIEW_MAIN_CATEGORY, REVIEW_SUB_CATEGORY],
  transactions: [],
};

const mergeCategoriesWithServer = (current: Category[], apiTransactions: ApiLedgerTransaction[]): Category[] => {
  if (!apiTransactions.length) return current;

  const next = current.map((category) => ({ ...category }));
  const byId = new Map(next.map((category) => [category.id, category] as const));

  const ensureCategory = (id: string | null, name: string | null, parentId: string | null) => {
    if (!id || !name) return;
    const existing = byId.get(id);
    if (existing) {
      const updated: Category = {
        ...existing,
        name: existing.name || name,
        parentId: parentId ?? existing.parentId ?? null,
      };
      const index = next.findIndex((category) => category.id === id);
      if (index >= 0) {
        next[index] = updated;
      }
      byId.set(id, updated);
      return;
    }

    const color = COLOR_PALETTE[(next.length) % COLOR_PALETTE.length];
    const created: Category = {
      id,
      name,
      parentId,
      color,
    };
    next.push(created);
    byId.set(id, created);
  };

  apiTransactions.forEach((tx) => {
    const {
      mainName,
      subName,
      suggestedMainName,
      suggestedSubName,
      rawMainName,
      rawSubName,
    } = deriveCategoryNames(tx);

    const mainLabel = firstNonEmpty([mainName, suggestedMainName, rawMainName]);
    const subLabel = firstNonEmpty([subName, suggestedSubName, rawSubName]);
    const mainId = deriveMainCategoryId(mainLabel);

    if (mainId && mainLabel) {
      ensureCategory(mainId, mainLabel, null);
    }

    if (tx.categoryId && subLabel) {
      ensureCategory(tx.categoryId, subLabel, mainId ?? null);
    }
  });

  return next;
};

const sanitizeKey = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

const makeDirectHistoryKey = (source: string | null | undefined, amount: number): string | null => {
  if (!source && source !== '') return null;
  const normalizedSource = sanitizeKey(source ?? '');
  if (!normalizedSource) return null;
  return `${normalizedSource}|${amount}`;
};

const suggestionIdentifier = (suggestion: CategorySuggestion): string =>
  `${suggestion.mainCategoryId ?? 'null'}::${suggestion.categoryId ?? 'null'}`;

const ensureSuggestionNames = (
  suggestion: CategorySuggestion,
  categoryIndex: Map<string, Category>,
): CategorySuggestion => {
  let { categoryId, categoryName, mainCategoryId, mainCategoryName } = suggestion;

  if (categoryId) {
    const category = categoryIndex.get(categoryId);
    categoryName = categoryName ?? category?.name ?? null;
    if (!mainCategoryId && category?.parentId) {
      mainCategoryId = category.parentId;
    }
  }

  if (mainCategoryId) {
    const mainCategory = categoryIndex.get(mainCategoryId);
    mainCategoryName = mainCategoryName ?? mainCategory?.name ?? null;
  }

  if (!categoryId && !mainCategoryId) {
    return {
      categoryId: null,
      categoryName: null,
      mainCategoryId: null,
      mainCategoryName: null,
    };
  }

  return {
    categoryId,
    categoryName: categoryName ?? null,
    mainCategoryId,
    mainCategoryName: mainCategoryName ?? null,
  };
};

const registerSuggestion = (
  history: SuggestionHistory,
  key: string | null,
  suggestion: CategorySuggestion,
  order: number,
) => {
  if (!key) return;
  const bucket = history.get(key) ?? new Map<string, SuggestionRecord>();
  const recordKey = suggestionIdentifier(suggestion);
  const record = bucket.get(recordKey);
  if (record) {
    record.count += 1;
    record.lastSeen = order;
  } else {
    bucket.set(recordKey, {
      suggestion,
      count: 1,
      lastSeen: order,
    });
  }
  history.set(key, bucket);
};

const pickBestSuggestion = (history: SuggestionHistory, key: string | null): CategorySuggestion | null => {
  if (!key) return null;
  const bucket = history.get(key);
  if (!bucket) return null;

  let best: SuggestionRecord | null = null;
  bucket.forEach((record) => {
    if (!best) {
      best = record;
      return;
    }
    if (record.count > best.count) {
      best = record;
      return;
    }
    if (record.count === best.count && record.lastSeen > best.lastSeen) {
      best = record;
    }
  });

  if (!best) return null;
  const { suggestion } = best;
  return {
    categoryId: suggestion.categoryId,
    categoryName: suggestion.categoryName,
    mainCategoryId: suggestion.mainCategoryId,
    mainCategoryName: suggestion.mainCategoryName,
  };
};

const buildSuggestionFromTransaction = (
  tx: LedgerTransaction,
  categoryIndex: Map<string, Category>,
): CategorySuggestion | null => {
  const suggestion = ensureSuggestionNames(
    {
      categoryId: tx.categoryId,
      categoryName: tx.categoryName,
      mainCategoryId: tx.mainCategoryId,
      mainCategoryName: tx.mainCategoryName,
    },
    categoryIndex,
  );

  if (!suggestion.categoryId && !suggestion.mainCategoryId) {
    return null;
  }

  return suggestion;
};

const categorizeTransactions = (
  incoming: LedgerTransaction[],
  history: LedgerTransaction[],
  categoryIndex: Map<string, Category>,
): { transactions: LedgerTransaction[]; autoCategorized: number } => {
  let autoCategorized = 0;
  let sequence = 0;

  const nextOrder = () => {
    sequence += 1;
    return sequence;
  };

  const sourceHistory: SuggestionHistory = new Map();
  const descriptionHistory: SuggestionHistory = new Map();
  const directHistory: SuggestionHistory = new Map();
  const overallHistory: SuggestionHistory = new Map();

  const recordTransaction = (tx: LedgerTransaction) => {
    const suggestion = buildSuggestionFromTransaction(tx, categoryIndex);
    if (!suggestion) {
      return;
    }

    const normalizedSuggestion = ensureSuggestionNames(suggestion, categoryIndex);

    if (normalizedSuggestion.mainCategoryId === REVIEW_MAIN_CATEGORY.id) {
      return;
    }

    const order = nextOrder();

    registerSuggestion(
      directHistory,
      makeDirectHistoryKey(tx.source, tx.amount),
      normalizedSuggestion,
      order,
    );
    registerSuggestion(sourceHistory, sanitizeKey(tx.source), normalizedSuggestion, order);
    registerSuggestion(descriptionHistory, sanitizeKey(tx.normalizedKey), normalizedSuggestion, order);
    registerSuggestion(overallHistory, '__overall__', normalizedSuggestion, order);
  };

  history.forEach(recordTransaction);

  const results = incoming.map((tx) => {
    const directKey = makeDirectHistoryKey(tx.source, tx.amount);
    const directSuggestion = pickBestSuggestion(directHistory, directKey);

    if (directSuggestion) {
      const normalized = ensureSuggestionNames(directSuggestion, categoryIndex);
      const enriched: LedgerTransaction = {
        ...tx,
        categoryId: normalized.categoryId,
        categoryName: normalized.categoryName,
        mainCategoryId: normalized.mainCategoryId,
        mainCategoryName: normalized.mainCategoryName,
        autoCategorized: true,
        needsManualCategory: false,
      };
      autoCategorized += 1;
      recordTransaction(enriched);
      return enriched;
    }

    const fallbackSuggestion =
      pickBestSuggestion(sourceHistory, sanitizeKey(tx.source)) ??
      pickBestSuggestion(descriptionHistory, sanitizeKey(tx.normalizedKey)) ??
      pickBestSuggestion(overallHistory, '__overall__');

    if (fallbackSuggestion) {
      const normalized = ensureSuggestionNames(fallbackSuggestion, categoryIndex);
      return {
        ...tx,
        categoryId: normalized.categoryId,
        categoryName: normalized.categoryName,
        mainCategoryId: normalized.mainCategoryId,
        mainCategoryName: normalized.mainCategoryName,
        autoCategorized: false,
        needsManualCategory: true,
      };
    }

    return {
      ...tx,
      categoryId: REVIEW_SUB_CATEGORY.id,
      categoryName: REVIEW_SUB_CATEGORY.name,
      mainCategoryId: REVIEW_MAIN_CATEGORY.id,
      mainCategoryName: REVIEW_MAIN_CATEGORY.name,
      autoCategorized: false,
      needsManualCategory: true,
    };
  });

  return { transactions: results, autoCategorized };
};

export const LedgerProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<LedgerState>(DEFAULT_STATE);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [ledgerMeta, setLedgerMeta] = useState<LedgerMeta[]>([]);

  const refreshRules = useCallback(async () => {
    if (!USE_SERVER_PIPELINE) return;
    try {
      const response = await fetchCategorizationRules();
      if (!Array.isArray(response)) {
        return;
      }
      const normalized = response.map(normalizeRuleResponse).sort(sortRules);
      setRules(normalized);
    } catch (error) {
      console.error('Failed to load categorization rules', error);
    }
  }, []);

  const refreshFromServer = useCallback(async () => {
    if (!USE_SERVER_PIPELINE) {
      return;
    }

    try {
      const payload: ApiLedgerResponse = await fetchLedger();
      const mapped = payload.transactions.map(mapApiTransaction);

      setState((current) => ({
        categories: mergeCategoriesWithServer(current.categories, payload.transactions),
        transactions: mapped,
      }));
      if (Array.isArray(payload.ledgers)) {
        setLedgerMeta(
          payload.ledgers.map((ledger) => ({
            id: ledger.id,
            month: ledger.month,
            year: ledger.year,
            lockedAt: ledger.lockedAt,
            lockedBy: ledger.lockedBy,
            lockNote: ledger.lockNote,
          })),
        );
      }
      await refreshRules();
    } catch (error) {
      console.error('Failed to refresh ledger from API', error);
    }
  }, [refreshRules]);

  const createRule = useCallback(async (payload: RuleInput) => {
    if (!USE_SERVER_PIPELINE) {
      throw new Error('Rule management unavailable in offline mode');
    }
    const result = await createCategorizationRule(payload);
    const normalized = normalizeRuleResponse(result);
    setRules((current) => [normalized, ...current.filter((rule) => rule.id !== normalized.id)].sort(sortRules));
  }, []);

  const updateRule = useCallback(async (id: string, payload: Partial<RuleInput>) => {
    if (!USE_SERVER_PIPELINE) {
      throw new Error('Rule management unavailable in offline mode');
    }
    const result = await updateCategorizationRule(id, payload);
    const normalized = normalizeRuleResponse(result);
    setRules((current) => [normalized, ...current.filter((rule) => rule.id !== id)].sort(sortRules));
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    if (!USE_SERVER_PIPELINE) {
      throw new Error('Rule management unavailable in offline mode');
    }
    await deleteCategorizationRule(id);
    setRules((current) => current.filter((rule) => rule.id !== id));
  }, []);

  useEffect(() => {
    if (USE_SERVER_PIPELINE) {
      refreshFromServer();
    }
  }, [refreshFromServer]);

  const { map: categoryIndex, tree: categoryTree } = useMemo(
    () => ensureCategoryIndex(state.categories),
    [state.categories],
  );

  const summary = useMemo(() => {
    const approved = state.transactions.filter((tx) => tx.classificationSource === 'manual');
    const reviewCount = state.transactions.length - approved.length;
    const autoCategorized = state.transactions.filter(
      (tx) => tx.classificationSource === 'history' || tx.classificationSource === 'rule',
    ).length;
    const totalAmount = approved.reduce((acc, tx) => acc + tx.amount, 0);

    return {
      total: approved.length,
      reviewCount,
      autoCategorized,
      totalAmount,
    };
  }, [state.transactions]);

  const reviewTransactions = useMemo(
    () => state.transactions.filter((tx) => tx.needsManualCategory),
    [state.transactions],
  );

  const importCsv = useCallback(
    async (file: File): Promise<ImportSummary> => {
      if (USE_SERVER_PIPELINE) {
        const formData = new FormData();
        formData.append('file', file);

        const summary = await uploadImportFile(formData);
        await refreshFromServer();

        return {
          importedCount: summary.importedCount,
          autoCategorized: summary.autoCategorizedCount,
          reviewCount: summary.pendingReviewCount,
          duplicateCount: summary.duplicateCount,
          errorCount: summary.errorCount,
          totalRows: summary.totalRows,
          format: summary.format,
          batchId: summary.batchId,
          errors: summary.errors,
        };
      }

      const rows = await parseCsvFile(file);
      const prepared = rows
        .map(buildTransactionFromRow)
        .filter((tx): tx is NonNullable<ReturnType<typeof buildTransactionFromRow>> => Boolean(tx));

      if (!prepared.length) {
        return { importedCount: 0, autoCategorized: 0, reviewCount: 0 };
      }

      const existingKeys = new Set(
        state.transactions.map((tx) => `${tx.date}|${tx.amount}|${tx.normalizedKey}`),
      );

      const uniqueIncoming = prepared.filter((tx) => {
        const key = `${tx.date}|${tx.amount}|${tx.normalizedKey}`;
        if (existingKeys.has(key)) {
          return false;
        }
        existingKeys.add(key);
        return true;
      });

      if (!uniqueIncoming.length) {
        return { importedCount: 0, autoCategorized: 0, reviewCount: 0 };
      }

      const normalized = uniqueIncoming.map<LedgerTransaction>((tx) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        direction: tx.direction,
        source: tx.source,
        accountLabel: tx.accountLabel,
        accountIdentifier: tx.accountIdentifier,
        normalizedKey: tx.normalizedKey,
        notificationDetail: tx.notificationDetail ?? null,
        ledgerMonth: tx.ledgerMonth,
        ledgerYear: tx.ledgerYear,
        createdAt: tx.createdAt,
        categoryId: null,
        categoryName: null,
        mainCategoryId: null,
        mainCategoryName: null,
        autoCategorized: false,
        needsManualCategory: true,
      }));

      const { transactions: categorized, autoCategorized } = categorizeTransactions(
        normalized,
        state.transactions,
        categoryIndex,
      );

      setState((current) => ({
        ...current,
        transactions: [...categorized, ...current.transactions],
      }));

      const reviewCount = categorized.filter((tx) => tx.needsManualCategory).length;

      return {
        importedCount: categorized.length,
        autoCategorized,
        reviewCount,
      };
    },
    [refreshFromServer, state.transactions, categoryIndex],
  );

  const assignCategory = useCallback(
    async (
      transactionId: UUID,
      { categoryId, mainCategoryId, categoryName }: { categoryId?: UUID | null; mainCategoryId?: UUID | null; categoryName?: string },
    ) => {
      setState((current) => {
        const tx = current.transactions.find((item) => item.id === transactionId);
        if (!tx) {
          return current;
        }

        let nextCategories = [...current.categories];
        let { map: categoryIndexLocal, tree: treeLocal } = ensureCategoryIndex(nextCategories);

        const rebuildIndexes = () => {
          const refreshed = ensureCategoryIndex(nextCategories);
          categoryIndexLocal = refreshed.map;
          treeLocal = refreshed.tree;
        };

        let resolvedCategoryId = categoryId ?? null;
        let resolvedCategoryName: string | null = null;
        let resolvedMainId = mainCategoryId ?? null;
        let resolvedMainName: string | null = null;

        const ensureMainCategory = (id: string | null): Category | null => {
          if (!id) return null;
          return categoryIndexLocal.get(id) ?? null;
        };

        if (categoryName && categoryName.trim().length) {
          const trimmed = categoryName.trim();
          const siblingLookup = resolvedMainId
            ? (treeLocal.byParent[resolvedMainId] ?? []).find(
                (cat) => cat.name.toLowerCase() === trimmed.toLowerCase(),
              )
            : nextCategories.find(
                (cat) => !cat.parentId && cat.name.toLowerCase() === trimmed.toLowerCase(),
              );

          if (siblingLookup) {
            resolvedCategoryId = siblingLookup.id;
            resolvedCategoryName = siblingLookup.name;
            resolvedMainId = siblingLookup.parentId ?? resolvedMainId;
          } else {
            const newCategory: Category = {
              id: createId(),
              name: trimmed,
              parentId: resolvedMainId ?? null,
            };
            nextCategories = [...nextCategories, newCategory];
            rebuildIndexes();
            resolvedCategoryId = newCategory.id;
            resolvedCategoryName = newCategory.name;
            if (newCategory.parentId) {
              const parent = ensureMainCategory(newCategory.parentId);
              resolvedMainId = parent?.id ?? null;
              resolvedMainName = parent?.name ?? null;
            } else {
              resolvedMainId = newCategory.id;
              resolvedMainName = newCategory.name;
            }
          }
        }

        if (resolvedCategoryId && !resolvedCategoryName) {
          const category = categoryIndexLocal.get(resolvedCategoryId);
          resolvedCategoryName = category?.name ?? null;
          resolvedMainId = category?.parentId ?? resolvedMainId;
        }

        if (resolvedMainId && !resolvedMainName) {
          const main = ensureMainCategory(resolvedMainId);
          resolvedMainName = main?.name ?? null;
        }

        if (resolvedCategoryId && !resolvedMainId) {
          const category = categoryIndexLocal.get(resolvedCategoryId);
          if (category?.parentId) {
            const main = ensureMainCategory(category.parentId);
            resolvedMainId = main?.id ?? null;
            resolvedMainName = main?.name ?? null;
          }
        }

        const updatedTransactions = current.transactions.map((item) =>
          item.id === transactionId
            ? {
                ...item,
                categoryId: resolvedCategoryId,
                categoryName: resolvedCategoryName,
                mainCategoryId: resolvedMainId,
                mainCategoryName: resolvedMainName,
                autoCategorized: false,
                needsManualCategory: !resolvedCategoryId,
                classificationSource: 'manual',
                classificationRuleId: null,
                classificationRuleLabel: null,
              }
            : item,
        );

        return {
          categories: nextCategories,
          transactions: updatedTransactions,
        };
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  const value = useMemo<LedgerContextValue>(
    () => ({
      transactions: state.transactions,
      categories: state.categories,
      categoryTree,
      summary,
      reviewTransactions,
      importCsv,
      assignCategory,
      clearAll,
      serverPipelineEnabled: USE_SERVER_PIPELINE,
      rules,
      refreshRules,
      createRule,
      updateRule,
      deleteRule,
      ledgerMeta,
    }),
    [state.transactions, state.categories, categoryTree, summary, reviewTransactions, importCsv, assignCategory, clearAll, rules, refreshRules, createRule, updateRule, deleteRule, ledgerMeta],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
};

export const useLedger = (): LedgerContextValue => {
  const context = useContext(LedgerContext);
  if (!context) {
    throw new Error('useLedger must be used within a LedgerProvider');
  }
  return context;
};
