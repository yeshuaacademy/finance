import { describe, it, expect } from 'vitest';
import { matchesRule, type RuleCondition } from '../ruleEngine';
import type { CategorizationRule } from '@prisma/client';

const baseContext = {
  description: 'Hr MPH Likkel, Mw DD Likkel-Koning',
  normalizedDescription: 'hr mph likkel, mw dd likkel-koning',
  counterparty: 'NL00INGB0123456789',
  reference: 'Payment reference',
  source: 'ING',
  amountMinor: 200000, // 2000.00
};

const makeRule = (overrides: Partial<CategorizationRule> & { conditions?: RuleCondition[] }): CategorizationRule => {
  return {
    id: 'rule-1',
    userId: 'user-1',
    importBatchId: null,
    ledgerId: null,
    categoryId: 'cat-1',
    label: 'Test',
    pattern: null,
    matchType: null,
    matchField: null,
    conditions: overrides.conditions ?? null,
    priority: 100,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMatchedAt: null,
    ...overrides,
  } as CategorizationRule;
};

describe('matchesRule', () => {
  it('matches single description contains condition', () => {
    const rule = makeRule({
      conditions: [{ field: 'description', matchType: 'contains', value: 'Likkel' }],
    });
    expect(matchesRule(rule, baseContext)).toBe(true);
  });

  it('matches combined description + amount equals conditions', () => {
    const rule = makeRule({
      conditions: [
        { field: 'description', matchType: 'contains', value: 'Likkel' },
        { field: 'amount', matchType: 'equals', value: '2000' },
      ],
    });
    expect(matchesRule(rule, baseContext)).toBe(true);
  });

  it('does not match when amount differs', () => {
    const rule = makeRule({
      conditions: [
        { field: 'description', matchType: 'contains', value: 'Likkel' },
        { field: 'amount', matchType: 'equals', value: '1500' },
      ],
    });
    expect(matchesRule(rule, baseContext)).toBe(false);
  });

  it('legacy rule with pattern/matchField still matches', () => {
    const legacyRule = makeRule({
      pattern: 'Likkel',
      matchType: 'contains' as any,
      matchField: 'description' as any,
      conditions: null,
    });
    expect(matchesRule(legacyRule, baseContext)).toBe(true);
  });
});
