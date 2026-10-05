import { describe, expect, it, vi } from 'vitest';
import {
  buildCategoryNormalizationPlan,
  executeCategoryNormalization,
  getCategoryNormalizationDryRun,
  getCategoryNormalizationRollbackDryRun,
} from '../../server/services/categoryNormalizationService';

const workspaceId = 'workspace-1';
const userId = 'user-1';
const actor = { userId, actorId: userId, actorEmail: 'admin@example.test' };
const timestamp = new Date('2026-09-30T00:00:00.000Z');
const emptyCounts = {
  transactions: 0,
  transactionBookings: 0,
  categorizationRules: 0,
  categorizationSuggestions: 0,
  beforeReviewDecisions: 0,
  afterReviewDecisions: 0,
  reportSnapshotLines: 0,
};

const category = (id: string, name: string, countOverrides: Partial<typeof emptyCounts> = {}, overrides: { isActive?: boolean; isHistorical?: boolean } = {}) => ({
  id,
  workspaceId,
  name,
  isActive: overrides.isActive ?? true,
  isHistorical: overrides.isHistorical ?? false,
  _count: { ...emptyCounts, ...countOverrides },
});

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  workspaceId,
  projectId: 'project-1',
  transactionTypeId: 'type-1',
  categoryId: 'cat-lower',
  source: 'HISTORICAL',
  ruleId: 'rule-1',
  historicalSourceTransactionId: 'history-1',
  historicalMatchKey: 'match-1',
  literalCategoryLabel: 'schenking FTK',
  evidenceHash: 'booking-evidence-hash',
  confirmedBy: userId,
  confirmedAt: new Date('2026-01-02T03:04:05.000Z'),
  project: { workspaceId },
  transactionType: { workspaceId },
  category: { workspaceId },
  ...overrides,
});

const transaction = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  userId,
  date: timestamp,
  amountMinor: 31500n,
  direction: 'credit',
  categoryId: 'cat-lower',
  classificationSource: 'history',
  classificationRuleId: null,
  transactionBooking: booking(),
  ...overrides,
});

const eligibleDecision = (overrides: Record<string, unknown> = {}) => ({
  id: 'decision-1',
  transactionId: 'tx-1',
  workspaceId,
  action: 'CHANGE_BOOKING',
  afterBookingId: 'booking-1',
  afterProjectId: 'project-1',
  afterTypeId: 'type-1',
  afterCategoryId: 'cat-lower',
  evidenceHash: 'decision-evidence-hash',
  actorId: userId,
  decidedAt: new Date('2026-09-30T01:00:00.000Z'),
  suggestion: null,
  ...overrides,
});

const makeDb = (options: { rows?: unknown[]; decisions?: unknown[]; categories?: unknown[] } = {}) => {
  const data = {
    categories: options.categories ?? [
      category('cat-lower', 'schenking FTK', { transactions: 1, transactionBookings: 1 }),
      category('cat-canonical', 'Schenking FTK', {}, { isHistorical: true }),
      category('cat-rename', 'kruispost in'),
      category('cat-empty', 'Lege categorie'),
    ],
    rows: options.rows ?? [transaction()],
    decisions: options.decisions ?? [eligibleDecision()],
  };
  const db = {
    category: {
      findMany: vi.fn(async () => data.categories),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    transaction: {
      findMany: vi.fn(async () => data.rows),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    transactionBooking: { updateMany: vi.fn(async () => ({ count: 1 })) },
    categorizationRule: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    categorizationSuggestion: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    reviewDecision: {
      findMany: vi.fn(async () => data.decisions),
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: { createMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  };
  return db;
};

describe('category normalization service', () => {
  it('dry-runs case-only merging, first-letter capitalization, and unused-category retirement with exact minor-unit totals', async () => {
    const db = makeDb();
    const plan = await buildCategoryNormalizationPlan(db as never, { workspaceId, userId });

    expect(plan.blockers).toEqual([]);
    expect(plan.categoryChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: 'schenking FTK', targetName: 'Schenking FTK', targetId: 'cat-canonical', merge: true }),
      expect.objectContaining({ sourceName: 'kruispost in', targetName: 'Kruispost in', targetId: 'cat-rename', merge: false }),
    ]));
    expect(plan.summary.transactionCount).toBe(1);
    expect(plan.summary.bookingCount).toBe(1);
    expect(plan.summary.countByYear).toEqual({ 2026: 1 });
    expect(plan.summary.incomeMinor).toBe('31500');
    expect(plan.summary.expenseMinor).toBe('0');
    expect(plan.summary.netMinor).toBe('31500');
    expect(plan.summary.labels.find((label) => label.from === 'schenking FTK')?.netByYearMinor).toEqual({ 2026: '31500' });
    expect(plan.summary.retireCategoryCount).toBe(3);
    expect(plan.retireCategoryIds).not.toContain('cat-canonical');
    expect(plan.summary.emptyCategories).toContainEqual(expect.objectContaining({ name: 'Schenking FTK', willDeactivate: false }));
    expect(plan.summary.emptyCategories).toContainEqual(expect.objectContaining({ name: 'Lege categorie', referenceCount: 0, willDeactivate: true }));
    expect(plan.summary.sideEffects).toEqual({
      writesPerformed: false,
      mutatesBankFacts: false,
      mutatesReportSnapshots: false,
      preservesBookingSourceAndRuleHistory: true,
    });
  });

  it('blocks before applying when the booking is missing or transaction and booking dimensions disagree', async () => {
    const missingBooking = makeDb({ rows: [transaction({ transactionBooking: null })] });
    const missing = await getCategoryNormalizationDryRun(missingBooking as never, { workspaceId, userId });
    expect(missing.status).toBe('BLOCKED');
    expect(missing.writesPerformed).toBe(false);
    expect(missing.blockers[0]).toContain('no current booking');

    const mismatch = makeDb({ rows: [transaction({ categoryId: 'cat-canonical' })] });
    const mismatched = await getCategoryNormalizationDryRun(mismatch as never, { workspaceId, userId });
    expect(mismatched.status).toBe('BLOCKED');
    expect(mismatched.blockers[0]).toContain('inconsistent workspace/category references');
  });

  it('fails closed on cross-workspace review history', async () => {
    const db = makeDb({ decisions: [eligibleDecision({ workspaceId: 'other-workspace' })] });
    const result = await getCategoryNormalizationDryRun(db as never, { workspaceId, userId });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers[0]).toContain('cross-workspace review decision');
  });

  it('blocks multiple Unicode labels that capitalize to the same absent category name', async () => {
    const db = makeDb({
      categories: [category('cat-sigma', 'σchenking'), category('cat-final-sigma', 'ςchenking')],
      rows: [],
      decisions: [],
    });
    const result = await getCategoryNormalizationDryRun(db as never, { workspaceId, userId });
    expect(result.status).toBe('BLOCKED');
    expect(result.writesPerformed).toBe(false);
    expect(result.blockers).toContain("Multiple category labels normalize to 'Σchenking', but no canonical category exists.");
    expect(result.summary.blockedTransactionCount).toBe(0);
  });

  it('blocks merging an active used category into an inactive canonical target', async () => {
    const db = makeDb({
      categories: [
        category('cat-lower', 'schenking FTK', { transactions: 1, transactionBookings: 1 }),
        category('cat-canonical', 'Schenking FTK', {}, { isActive: false, isHistorical: true }),
      ],
    });
    const result = await getCategoryNormalizationDryRun(db as never, { workspaceId, userId });
    expect(result.status).toBe('BLOCKED');
    expect(result.writesPerformed).toBe(false);
    expect(result.blockers).toContain("Active category 'schenking FTK' cannot be merged into inactive target 'Schenking FTK'. Activate the target or review this mapping first.");
  });

  it('requires a matching dry-run hash and preserves the original booking provenance on apply', async () => {
    const db = makeDb();
    const plan = await buildCategoryNormalizationPlan(db as never, { workspaceId, userId });
    const drift = await executeCategoryNormalization(db as never, {
      workspaceId, userId, actor, confirmedPlanHash: 'wrong-hash',
    });
    expect(drift.status).toBe('HASH_DRIFT');
    expect(drift.writesPerformed).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();

    const applied = await executeCategoryNormalization(db as never, {
      workspaceId, userId, actor, confirmedPlanHash: plan.planHash,
    });
    expect(applied.status).toBe('APPLIED');
    expect(applied.writesPerformed).toBe(true);
    expect(db.transaction.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'cat-lower' },
      data: { categoryId: 'cat-canonical' },
    });
    expect(db.transactionBooking.updateMany).toHaveBeenCalledWith({
      where: { workspaceId, categoryId: 'cat-lower' },
      data: { categoryId: 'cat-canonical', literalCategoryLabel: 'Schenking FTK' },
    });
    const decisions = db.reviewDecision.createMany.mock.calls[0]?.[0].data as Array<Record<string, unknown>>;
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      action: 'CHANGE_BOOKING',
      beforeBookingId: 'booking-1',
      afterBookingId: 'booking-1',
      beforeCategoryId: 'cat-lower',
      afterCategoryId: 'cat-canonical',
    });
    expect(decisions[0]?.evidenceHash).toBeTruthy();
    const logs = db.auditLog.createMany.mock.calls[0]?.[0].data as Array<Record<string, unknown>>;
    const txLog = logs.find((entry) => entry.action === 'category.normalization.transaction');
    expect(txLog?.before).toMatchObject({ amountMinor: '31500', date: timestamp.toISOString(), direction: 'credit', bookingSource: 'HISTORICAL', ruleId: 'rule-1' });
    expect(txLog?.after).toMatchObject({ categoryId: 'cat-canonical', bookingSource: 'HISTORICAL', ruleId: 'rule-1' });
  });

  it('provides a guarded rollback dry-run and blocks when the saved after-state has drifted', async () => {
    const operationId = 'operation-1';
    const before = {
      date: timestamp.toISOString(), amountMinor: '31500', direction: 'credit', categoryId: 'cat-lower',
      bookingId: 'booking-1', bookingWorkspaceId: workspaceId, projectId: 'project-1', transactionTypeId: 'type-1', bookingCategoryId: 'cat-lower',
      literalCategoryLabel: 'schenking FTK', bookingSource: 'HISTORICAL', ruleId: 'rule-1',
      historicalSourceTransactionId: 'history-1', historicalMatchKey: 'match-1', bookingEvidenceHash: 'booking-evidence-hash',
      bookingConfirmedBy: userId, bookingConfirmedAt: new Date('2026-01-02T03:04:05.000Z').toISOString(),
      classificationSource: 'history', classificationRuleId: null, decisionId: 'decision-1', decisionWasEligible: true,
    };
    const after = {
      ...before, categoryId: 'cat-canonical', bookingCategoryId: 'cat-canonical', literalCategoryLabel: 'Schenking FTK',
      normalizationDecisionId: 'decision-normalized', latestDecisionId: 'decision-normalized',
    };
    const auditRows = [
      { id: 'audit-tx', userId, action: 'category.normalization.transaction', entityType: 'transaction', entityId: 'tx-1', before, after, metadata: { operationId } },
      { id: 'audit-cat', userId, action: 'category.normalization.category', entityType: 'category', entityId: 'cat-lower', before: { name: 'schenking FTK', isActive: true, isHistorical: false }, after: { name: 'schenking FTK', isActive: false, isHistorical: true }, metadata: { operationId } },
      { id: 'audit-header', userId, action: 'category.normalization.applied', entityType: 'categoryNormalization', entityId: operationId, before: {}, after: {}, metadata: { operationId } },
    ];
    const current = transaction({
      categoryId: 'cat-canonical',
      transactionBooking: booking({ categoryId: 'cat-canonical', literalCategoryLabel: 'Schenking FTK' }),
    });
    const db = {
      auditLog: { findMany: vi.fn(async () => auditRows) },
      transaction: { findMany: vi.fn(async () => [current]) },
      category: { findMany: vi.fn(async () => [{ id: 'cat-lower', name: 'schenking FTK', isActive: false, isHistorical: true }]) },
      categorizationRule: { findMany: vi.fn(async () => []) },
      categorizationSuggestion: { findMany: vi.fn(async () => []) },
      reviewDecision: { findMany: vi.fn(async () => [{ id: 'decision-normalized', transactionId: 'tx-1', workspaceId, decidedAt: new Date('2026-09-30T02:00:00.000Z') }]) },
    };
    const valid = await getCategoryNormalizationRollbackDryRun(db as never, { workspaceId, operationId });
    expect(valid.status).toBe('ROLLBACK_DRY_RUN_COMPLETE');
    expect(valid.summary.transactionCount).toBe(1);
    expect(valid.writesPerformed).toBe(false);

    const driftDb = {
      ...db,
      transaction: { findMany: vi.fn(async () => [transaction({ categoryId: 'some-later-category', transactionBooking: booking({ categoryId: 'some-later-category' }) })]) },
    };
    const drift = await getCategoryNormalizationRollbackDryRun(driftDb as never, { workspaceId, operationId });
    expect(drift.status).toBe('BLOCKED');
    expect(drift.blockers.join(' ')).toContain('changed since normalization');

    const dimensionDriftDb = {
      ...db,
      transaction: { findMany: vi.fn(async () => [transaction({
        categoryId: 'cat-canonical',
        transactionBooking: booking({ categoryId: 'cat-canonical', literalCategoryLabel: 'Schenking FTK', projectId: 'project-changed' }),
      })]) },
    };
    const dimensionDrift = await getCategoryNormalizationRollbackDryRun(dimensionDriftDb as never, { workspaceId, operationId });
    expect(dimensionDrift.status).toBe('BLOCKED');
    expect(dimensionDrift.blockers.join(' ')).toContain('changed since normalization');
  });
});
