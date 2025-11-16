import { describe, expect, it } from 'vitest';
import {
  buildExactMatchIndex,
  buildFuzzyMatchIndex,
  buildLedgerMatchCandidates,
  findExactLedgerMatch,
  findFuzzyLedgerMatch,
  normalizeMatchableTransaction,
} from '../../server/services/transactionMatching';

const BASE_LEDGER_SOURCE = {
  transactionId: 'tx-ledger-1',
  categoryId: 'cat-expense',
  description: 'Yeshua Academy Tuition Contribution',
  amountMinor: -12345n,
  direction: 'debit' as const,
  accountIdentifier: 'NL89INGB0006369960',
  counterparty: 'Stichting Yeshua',
  notifications: 'Reference 2024-01',
  raw: { Notifications: 'Reference 2024-01' },
  createdAt: new Date('2024-01-15T10:00:00Z'),
};

describe('transactionMatching helpers', () => {
  it('matches exact transactions across all normalized fields', () => {
    const candidates = buildLedgerMatchCandidates([BASE_LEDGER_SOURCE]);
    const index = buildExactMatchIndex(candidates);
    const normalizedImport = normalizeMatchableTransaction({
      description: 'YESHUA ACADEMY TUITION CONTRIBUTION',
      amountMinor: -12345n,
      direction: 'debit',
      accountIdentifier: 'NL89 INGB 0006369960',
      counterparty: 'stichting YESHUA',
      notifications: 'Reference 2024-01',
    });
    expect(normalizedImport).not.toBeNull();
    const match = normalizedImport ? findExactLedgerMatch(normalizedImport, index) : null;
    expect(match).not.toBeNull();
    expect(match?.categoryId).toBe('cat-expense');
  });

  it('finds fuzzy matches when amount/account/counterparty align and similarity threshold is met', () => {
    const ledgerSources = [
      BASE_LEDGER_SOURCE,
      {
        ...BASE_LEDGER_SOURCE,
        transactionId: 'tx-ledger-2',
        categoryId: 'cat-donation',
        description: 'Community Support Gift',
        notifications: 'Donation Ref 2024-02',
        raw: { Notifications: 'Donation Ref 2024-02' },
        createdAt: new Date('2024-02-10T10:00:00Z'),
      },
    ];
    const candidates = buildLedgerMatchCandidates(ledgerSources);
    const fuzzyIndex = buildFuzzyMatchIndex(candidates);
    const normalizedImport = normalizeMatchableTransaction({
      description: 'Community support gift for February',
      amountMinor: -12345n,
      direction: 'debit',
      accountIdentifier: 'NL89INGB0006369960',
      counterparty: 'Stichting Yeshua',
      notifications: 'Donation Ref 2024-02',
    });
    expect(normalizedImport).not.toBeNull();
    const match = normalizedImport ? findFuzzyLedgerMatch(normalizedImport, fuzzyIndex) : null;
    expect(match).not.toBeNull();
    expect(match?.transactionId).toBe('tx-ledger-2');
    expect(match?.categoryId).toBe('cat-donation');
  });

  it('returns null for fuzzy matching when similarity threshold is not met', () => {
    const candidates = buildLedgerMatchCandidates([BASE_LEDGER_SOURCE]);
    const fuzzyIndex = buildFuzzyMatchIndex(candidates);
    const normalizedImport = normalizeMatchableTransaction({
      description: 'Completely different description',
      amountMinor: -12345n,
      direction: 'debit',
      accountIdentifier: 'NL89INGB0006369960',
      counterparty: 'Stichting Yeshua',
      notifications: 'Unrelated reference',
    });
    expect(normalizedImport).not.toBeNull();
    const match = normalizedImport ? findFuzzyLedgerMatch(normalizedImport, fuzzyIndex) : null;
    expect(match).toBeNull();
  });
});
