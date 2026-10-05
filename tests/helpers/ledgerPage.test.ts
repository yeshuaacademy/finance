import { describe, expect, it } from 'vitest';
import type { LedgerTransaction } from '../../src/helpers/api-transaction-mapper';
import {
  buildLatestYearOverview,
  buildMonthOptions,
  filterLedgerTransactions,
  filterTransactionsByMonth,
  formatEuro,
  getLedgerCategoryLabel,
  getLastCompletedMonthKey,
  getMonthKeyForTransaction,
  getMonthLabelForKey,
  groupTransactionsByYear,
  parseLedgerDate,
  resolveActiveMonth,
  summarizeLedgerTransactions,
} from '../../src/helpers/ledger-page';

const makeTx = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: 'tx-default',
  date: '2026-05-15T00:00:00.000Z',
  description: 'Test transactie',
  amount: 0,
  direction: 'credit',
  source: 'ING',
  accountLabel: null,
  accountIdentifier: null,
  normalizedKey: 'test-transactie',
  notificationDetail: null,
  counterpartyAccount: null,
  categoryId: null,
  categoryName: null,
  mainCategoryId: null,
  mainCategoryName: null,
  ledgerMonth: 5,
  ledgerYear: 2026,
  createdAt: '2026-05-15T00:00:00.000Z',
  autoCategorized: false,
  needsManualCategory: false,
  ...overrides,
});

describe('ledger page helpers', () => {
  it('formats money and parses invalid dates safely', () => {
    expect(formatEuro(1234.56)).toBe('€ 1.234,56');
    expect(parseLedgerDate('geen datum').toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('builds completed-month options and defaults to the last full month', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const transactions = [
      makeTx({ id: 'may', date: '2026-05-15T00:00:00.000Z' }),
      makeTx({ id: 'june', date: '2026-06-01T00:00:00.000Z' }),
      makeTx({ id: 'duplicate-june', date: '2026-06-20T00:00:00.000Z' }),
    ];

    expect(getMonthKeyForTransaction(transactions[0])).toBe('2026-05');
    expect(getMonthLabelForKey('2026-05')).toBe('mei 2026');
    expect(getLastCompletedMonthKey(now)).toBe('2026-07');
    expect(buildMonthOptions(transactions, now).map((option) => option.key)).toEqual([
      '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01',
    ]);
    expect(buildMonthOptions([], new Date('2027-02-01T00:00:00.000Z')).map((option) => option.key)).toEqual([
      '2027-01',
    ]);
  });

  it('resolves the active month and filters transactions for that month', () => {
    const options = [
      { key: '2026-06', label: 'juni 2026' },
      { key: '2026-05', label: 'mei 2026' },
    ];
    const transactions = [
      makeTx({ id: 'may', date: '2026-05-15T00:00:00.000Z' }),
      makeTx({ id: 'june', date: '2026-06-01T00:00:00.000Z' }),
    ];

    expect(resolveActiveMonth(options, '2026-05')).toBe('2026-05');
    expect(resolveActiveMonth(options, '2025-01')).toBe('2026-06');
    expect(filterTransactionsByMonth(transactions, '2026-06').map((tx) => tx.id)).toEqual(['june']);
  });

  it('filters transaction search text across visible and drilldown fields', () => {
    const transactions = [
      makeTx({ id: 'gift', description: 'Gift familie', mainCategoryName: 'Inkomsten' }),
      makeTx({ id: 'bank', description: 'Kosten', counterpartyAccount: 'NL12 BANK', notificationDetail: 'Bankkosten maand' }),
    ];

    expect(filterLedgerTransactions(transactions, '').map((tx) => tx.id)).toEqual(['gift', 'bank']);
    expect(filterLedgerTransactions(transactions, 'familie').map((tx) => tx.id)).toEqual(['gift']);
    expect(filterLedgerTransactions(transactions, 'bankkosten').map((tx) => tx.id)).toEqual(['bank']);
    expect(filterLedgerTransactions(transactions, 'niets')).toEqual([]);
  });

  it('filters transactions by customer and transaction type, including unassigned rows', () => {
    const transactions = [
      makeTx({ id: 'ya-gift', clientId: 'client-ya', clientName: 'YA', transactionTypeId: 'type-gift', transactionTypeName: 'Schenking' }),
      makeTx({ id: 'ftk-gift', clientId: 'client-ftk', clientName: 'FTK', transactionTypeId: 'type-gift', transactionTypeName: 'Schenking' }),
      makeTx({ id: 'unassigned', clientId: null, transactionTypeId: null }),
    ];

    expect(filterLedgerTransactions(transactions, '', { clientId: 'client-ya' }).map((tx) => tx.id)).toEqual(['ya-gift']);
    expect(filterLedgerTransactions(transactions, '', { transactionTypeId: 'type-gift' }).map((tx) => tx.id)).toEqual(['ya-gift', 'ftk-gift']);
    expect(filterLedgerTransactions(transactions, '', { clientId: null, transactionTypeId: null }).map((tx) => tx.id)).toEqual(['unassigned']);
    expect(filterLedgerTransactions(transactions, 'schenking').map((tx) => tx.id)).toEqual(['ya-gift', 'ftk-gift']);
  });

  it('chooses category labels in the same priority order as the ledger table', () => {
    expect(getLedgerCategoryLabel(makeTx({ mainCategoryName: 'Inkomsten', categoryName: 'Giften' }))).toBe('Inkomsten');
    expect(getLedgerCategoryLabel(makeTx({ categoryName: 'Giften' }))).toBe('Giften');
    expect(getLedgerCategoryLabel(makeTx({ suggestedMainCategoryName: 'Voorgesteld' }))).toBe('Voorgesteld');
    expect(getLedgerCategoryLabel(makeTx({}))).toBe('Nog te beoordelen');
  });

  it('summarizes month and latest-year values for KPI cards', () => {
    const transactions = [
      makeTx({ id: 'gift', date: '2026-05-15T00:00:00.000Z', amount: 150, needsManualCategory: false }),
      makeTx({ id: 'rent', date: '2026-05-16T00:00:00.000Z', amount: -45, needsManualCategory: true }),
      makeTx({ id: 'old', date: '2025-05-16T00:00:00.000Z', amount: 999, needsManualCategory: false }),
    ];

    expect(summarizeLedgerTransactions(transactions.slice(0, 2))).toEqual({
      income: 150,
      expenses: 45,
      result: 105,
      reviewCount: 1,
      transactionCount: 2,
    });
    expect(groupTransactionsByYear(transactions).map(([year]) => year)).toEqual([2026, 2025]);
    expect(buildLatestYearOverview(transactions)).toMatchObject({
      year: 2026,
      income: 150,
      expenses: 45,
      result: 105,
      reviewCount: 1,
      transactionCount: 2,
    });
    expect(buildLatestYearOverview([], new Date('2028-01-01T00:00:00.000Z'))).toMatchObject({
      year: 2028,
      transactionCount: 0,
    });
  });
});
