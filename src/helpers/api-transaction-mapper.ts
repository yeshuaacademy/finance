import { normaliseDescription } from './client-import-normalizers';
import { deriveMainCategoryId } from './category-labels';
import { deriveCategoryNames } from './transaction-category-names';
import type { ReviewDimensionCandidate, ReviewEvidenceAlternative } from '@/libs/api';

export type ApiLedgerTransaction = {
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
  clientId?: string | null;
  clientCode?: string | null;
  clientName?: string | null;
  transactionTypeId?: string | null;
  transactionTypeName?: string | null;
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
  suggestionConfidence?: 'exact' | 'description' | 'account' | 'overall' | 'rule' | 'review' | 'fuzzy' | null;
  suggestedMainCategoryName?: string | null;
  suggestedSubCategoryName?: string | null;
  rawMainCategoryName?: string | null;
  rawCategoryName?: string | null;
  notificationDetail?: string | null;
  counterpartyAccount?: string | null;
};

export type LedgerTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction?: 'credit' | 'debit';
  source: string;
  accountLabel: string | null;
  accountIdentifier: string | null;
  normalizedKey: string;
  notificationDetail: string | null;
  counterpartyAccount: string | null;
  categoryId: string | null;
  categoryName: string | null;
  clientId?: string | null;
  clientCode?: string | null;
  clientName?: string | null;
  transactionTypeId?: string | null;
  transactionTypeName?: string | null;
  mainCategoryId: string | null;
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
  suggestionConfidence?: 'exact' | 'description' | 'account' | 'overall' | 'rule' | 'review' | 'fuzzy' | null;
  suggestedMainCategoryName?: string | null;
  suggestedSubCategoryName?: string | null;
  rawMainCategoryName?: string | null;
  rawCategoryName?: string | null;
  reviewProposal?: ReviewDimensionCandidate | null;
  reviewAlternatives?: ReviewEvidenceAlternative[];
  reviewReason?: string | null;
  reviewEvidenceSummary?: string | null;
  reviewConfidence?: string | null;
  reviewConfidenceLabel?: string | null;
};

export const mapApiTransaction = (tx: ApiLedgerTransaction): LedgerTransaction => {
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
  const needsManualCategory = !tx.categoryId || classification === 'none' || classification === 'import';

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
    notificationDetail: tx.notificationDetail ?? tx.reference ?? null,
    counterpartyAccount: tx.counterpartyAccount ?? tx.counterparty ?? null,
    categoryId: tx.categoryId ?? null,
    categoryName: subName,
    clientId: tx.clientId ?? null,
    clientCode: tx.clientCode ?? null,
    clientName: tx.clientName ?? null,
    transactionTypeId: tx.transactionTypeId ?? null,
    transactionTypeName: tx.transactionTypeName ?? null,
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
    reviewProposal: null,
    reviewAlternatives: [],
    reviewReason: null,
    reviewEvidenceSummary: null,
    reviewConfidence: null,
    reviewConfidenceLabel: null,
  };
};
