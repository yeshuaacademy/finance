import type { LedgerTransaction } from '@/helpers/api-transaction-mapper';

const euroFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

const monthFormatter = new Intl.DateTimeFormat('nl-NL', {
  month: 'long',
  year: 'numeric',
});

export type MonthOption = {
  key: string;
  label: string;
};

export type LedgerPeriodSummary = {
  income: number;
  expenses: number;
  result: number;
  reviewCount: number;
  transactionCount: number;
};

export type LedgerYearOverview = LedgerPeriodSummary & {
  year: number;
  transactions: LedgerTransaction[];
};

export const formatEuro = (value: number) => euroFormatter.format(value);

export const parseLedgerDate = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

export const getMonthKeyForTransaction = (transaction: LedgerTransaction) => {
  const date = parseLedgerDate(transaction.date);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const getMonthLabelForKey = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return monthFormatter.format(new Date(Date.UTC(year || 1970, (month || 1) - 1, 1)));
};

export const getLedgerCategoryLabel = (transaction: LedgerTransaction) =>
  transaction.mainCategoryName ?? transaction.categoryName ?? transaction.suggestedMainCategoryName ?? 'Nog te beoordelen';

export const getLastCompletedMonthKey = (now: Date = new Date()): string => {
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${previousMonth.getUTCFullYear()}-${String(previousMonth.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const buildMonthOptions = (transactions: LedgerTransaction[], now: Date = new Date()): MonthOption[] => {
  const keys = new Set(transactions.map(getMonthKeyForTransaction));
  const lastCompleted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  for (let month = 0; month <= lastCompleted.getUTCMonth(); month += 1) {
    keys.add(`${lastCompleted.getUTCFullYear()}-${String(month + 1).padStart(2, '0')}`);
  }

  if (!keys.size) keys.add(getLastCompletedMonthKey(now));

  return Array.from(keys)
    .sort()
    .reverse()
    .map((key) => ({ key, label: getMonthLabelForKey(key) }));
};

export const resolveActiveMonth = (monthOptions: MonthOption[], selectedMonth: string) =>
  monthOptions.some((option) => option.key === selectedMonth)
    ? selectedMonth
    : monthOptions[0]?.key ?? selectedMonth;

export const filterTransactionsByMonth = (transactions: LedgerTransaction[], monthKey: string) =>
  transactions.filter((transaction) => getMonthKeyForTransaction(transaction) === monthKey);

export type LedgerDimensionFilters = {
  clientId?: string | null;
  transactionTypeId?: string | null;
};

const matchesDimension = (filter: string | null | undefined, value: string | null): boolean =>
  filter === undefined || (filter === null ? value === null : value === filter);

export const filterLedgerTransactions = (
  transactions: LedgerTransaction[],
  query: string,
  dimensions: LedgerDimensionFilters = {},
) => {
  const normalized = query.trim().toLowerCase();

  return transactions.filter((transaction) => {
    if (!matchesDimension(dimensions.clientId, transaction.clientId ?? null)
      || !matchesDimension(dimensions.transactionTypeId, transaction.transactionTypeId ?? null)) {
      return false;
    }
    if (!normalized) return true;
    return [
      transaction.description,
      transaction.counterpartyAccount,
      transaction.notificationDetail,
      transaction.categoryName,
      transaction.mainCategoryName,
      transaction.clientCode,
      transaction.clientName,
      transaction.transactionTypeName,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized));
  });
};

export const summarizeLedgerTransactions = (transactions: LedgerTransaction[]): LedgerPeriodSummary => {
  const income = transactions
    .filter((transaction) => transaction.amount > 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expenses = transactions
    .filter((transaction) => transaction.amount < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const reviewCount = transactions.filter((transaction) => transaction.needsManualCategory).length;

  return {
    income,
    expenses,
    result: income - expenses,
    reviewCount,
    transactionCount: transactions.length,
  };
};

export const groupTransactionsByYear = (transactions: LedgerTransaction[]) => {
  const years = new Map<number, LedgerTransaction[]>();

  transactions.forEach((transaction) => {
    const year = parseLedgerDate(transaction.date).getUTCFullYear();
    years.set(year, [...(years.get(year) ?? []), transaction]);
  });

  return Array.from(years.entries()).sort(([a], [b]) => b - a);
};

export const buildLatestYearOverview = (transactions: LedgerTransaction[], now: Date = new Date()): LedgerYearOverview => {
  const latest = groupTransactionsByYear(transactions)[0];
  const year = latest?.[0] ?? now.getUTCFullYear();
  const yearTransactions = latest?.[1] ?? [];
  const summary = summarizeLedgerTransactions(yearTransactions);

  return {
    year,
    transactions: yearTransactions,
    ...summary,
  };
};
