import { describe, expect, it } from 'vitest';
import { mapApiTransaction } from '../../src/helpers/api-transaction-mapper';

describe('API transaction mapper', () => {
  it('maps categorized API transactions into signed ledger transactions', () => {
    const mapped = mapApiTransaction({
      id: 'tx-1',
      date: '2026-05-15T12:00:00.000Z',
      description: 'Gift voor zending!',
      amount: 25,
      direction: 'credit',
      source: 'Donor Naam',
      accountIdentifier: 'NL89INGB0006369960',
      categoryId: 'cat-gifts',
      categoryName: 'Inkomsten — Giften',
      clientId: 'client-ya',
      clientCode: 'YA',
      clientName: 'YA',
      transactionTypeId: 'type-donation',
      transactionTypeName: 'Schenking',
      ledgerMonth: 5,
      ledgerYear: 2026,
      createdAt: '2026-05-15T13:00:00.000Z',
      runningBalance: 100.25,
      classificationSource: 'history',
      classificationRuleId: 'rule-1',
      classificationRuleLabel: 'Giften regel',
      ledgerLockedAt: '2026-05-31T00:00:00.000Z',
      suggestionConfidence: 'exact',
      reference: 'REF-1',
      counterparty: 'NL00BANK',
    });

    expect(mapped).toMatchObject({
      id: 'tx-1',
      date: '2026-05-15T12:00:00.000Z',
      description: 'Gift voor zending!',
      amount: 25,
      direction: 'credit',
      source: 'Donor Naam',
      accountLabel: 'NL89INGB0006369960',
      accountIdentifier: 'NL89INGB0006369960',
      normalizedKey: 'gift voor zending',
      notificationDetail: 'REF-1',
      counterpartyAccount: 'NL00BANK',
      categoryId: 'cat-gifts',
      categoryName: 'Giften',
      clientId: 'client-ya',
      clientCode: 'YA',
      clientName: 'YA',
      transactionTypeId: 'type-donation',
      transactionTypeName: 'Schenking',
      mainCategoryId: 'main:inkomsten',
      mainCategoryName: 'Inkomsten',
      ledgerMonth: 5,
      ledgerYear: 2026,
      createdAt: '2026-05-15T13:00:00.000Z',
      autoCategorized: true,
      needsManualCategory: false,
      runningBalance: 100.25,
      runningBalanceMinor: '10025',
      classificationSource: 'history',
      classificationRuleId: 'rule-1',
      classificationRuleLabel: 'Giften regel',
      ledgerLockedAt: '2026-05-31T00:00:00.000Z',
      suggestionConfidence: 'exact',
    });
  });

  it('derives debit sign, period, balance, and review state from partial API data', () => {
    const mapped = mapApiTransaction({
      id: 'tx-2',
      date: '2026-06-02T08:30:00.000Z',
      description: 'Bankkosten',
      amount: 7.5,
      direction: 'debit',
      source: 'ING',
      categoryId: null,
      runningBalanceMinor: '9250',
      classificationSource: 'none',
    });

    expect(mapped).toMatchObject({
      amount: -7.5,
      direction: 'debit',
      ledgerMonth: 6,
      ledgerYear: 2026,
      runningBalance: 92.5,
      runningBalanceMinor: '9250',
      autoCategorized: false,
      needsManualCategory: true,
      classificationSource: 'none',
      categoryId: null,
      categoryName: null,
      mainCategoryId: null,
      mainCategoryName: null,
    });
  });

  it('falls back safely for invalid dates and amountMinor input', () => {
    const before = Date.now();
    const mapped = mapApiTransaction({
      id: 'tx-3',
      date: 'geen datum',
      description: 'Onbekend',
      amount: undefined as unknown as number,
      amountMinor: '1234',
      source: 'Import',
      categoryId: 'cat-raw',
      rawCategoryName: 'Uitgaven — Overig',
      createdAt: 'ook geen datum',
    });
    const after = Date.now();

    expect(new Date(mapped.date).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(mapped.date).getTime()).toBeLessThanOrEqual(after + 1000);
    expect(mapped.amount).toBe(12.34);
    expect(mapped.createdAt).toBe(mapped.date);
    expect(mapped.categoryName).toBe('Overig');
    expect(mapped.mainCategoryName).toBe('Uitgaven');
    expect(mapped.mainCategoryId).toBe('main:uitgaven');
  });
});
