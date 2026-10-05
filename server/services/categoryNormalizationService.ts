import crypto from 'node:crypto';
import { Prisma, ReviewDecisionAction, type PrismaClient } from '@prisma/client';
import { canonicalizeEvidence, hashEvidence } from './reviewDecisionService';

export const CATEGORY_NORMALIZATION_VERSION = 'category-normalization-v2';

export type CategoryMergeMapping = { sourceName: string; targetName: string };

type Db = PrismaClient | Prisma.TransactionClient;

export class CategoryNormalizationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'CategoryNormalizationError';
    this.statusCode = statusCode;
  }
}

type CategoryRow = {
  id: string;
  workspaceId: string;
  name: string;
  isActive: boolean;
  isHistorical: boolean;
  _count: {
    transactions: number;
    transactionBookings: number;
    categorizationRules: number;
    categorizationSuggestions: number;
    beforeReviewDecisions: number;
    afterReviewDecisions: number;
    reportSnapshotLines: number;
  };
};

type TransactionRow = {
  id: string;
  userId: string;
  date: Date;
  amountMinor: bigint;
  direction: 'credit' | 'debit';
  categoryId: string | null;
  classificationSource: string;
  classificationRuleId: string | null;
  transactionBooking: {
    id: string;
    workspaceId: string;
    projectId: string;
    transactionTypeId: string;
    categoryId: string;
    source: string;
    ruleId: string | null;
    historicalSourceTransactionId: string | null;
    historicalMatchKey: string | null;
    literalCategoryLabel: string;
    evidenceHash: string;
    confirmedBy: string | null;
    confirmedAt: Date;
    project: { workspaceId: string };
    transactionType: { workspaceId: string };
    category: { workspaceId: string };
  } | null;
};

type RuleRow = { id: string; categoryId: string };
type SuggestionRow = { id: string; categoryId: string | null };

type CategoryChange = {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  merge: boolean;
};

type TransactionChange = {
  id: string;
  userId: string;
  date: string;
  amountMinor: string;
  direction: 'credit' | 'debit';
  sourceCategoryId: string;
  targetCategoryId: string;
  sourceCategoryName: string;
  targetCategoryName: string;
  booking: TransactionRow['transactionBooking'];
  classificationSource: string;
  classificationRuleId: string | null;
  latestDecision: {
    id: string;
    action: string;
    afterBookingId: string | null;
    afterProjectId: string | null;
    afterTypeId: string | null;
    afterCategoryId: string | null;
    evidenceHash: string;
    workspaceId: string;
    actorId: string;
    decidedAt: Date;
    suggestion: { workspaceId: string; status: string } | null;
  } | null;
  decisionWorkspaceIds: string[];
};

type CategoryNormalizationPlanInternal = {
  version: typeof CATEGORY_NORMALIZATION_VERSION;
  workspaceId: string;
  planHash: string;
  mappings: CategoryMergeMapping[];
  categories: CategoryRow[];
  categoryChanges: CategoryChange[];
  transactions: TransactionChange[];
  rules: RuleRow[];
  suggestions: SuggestionRow[];
  retireCategoryIds: string[];
  blockers: string[];
  summary: CategoryNormalizationSummary;
};

export type CategoryNormalizationSummary = {
  categoryCount: number;
  categoryChangeCount: number;
  mergeCategoryCount: number;
  transactionCount: number;
  bookingCount: number;
  ruleCount: number;
  suggestionCount: number;
  retireCategoryCount: number;
  blockedTransactionCount: number;
  countByYear: Record<string, number>;
  incomeMinor: string;
  expenseMinor: string;
  netMinor: string;
  emptyCategories: Array<{ name: string; referenceCount: number; isActive: boolean; willDeactivate: boolean }>;
  labels: Array<{
    from: string;
    to: string;
    transactionCount: number;
    merge: boolean;
    countByYear: Record<string, number>;
    netByYearMinor: Record<string, string>;
    incomeMinor: string;
    expenseMinor: string;
    netMinor: string;
  }>;
  sideEffects: {
    writesPerformed: false;
    mutatesBankFacts: false;
    mutatesReportSnapshots: false;
    preservesBookingSourceAndRuleHistory: true;
  };
};

export type CategoryNormalizationDryRun = {
  status: 'DRY_RUN_COMPLETE' | 'BLOCKED';
  dryRun: true;
  writesPerformed: false;
  planHash: string;
  summary: CategoryNormalizationSummary;
  blockers: string[];
};

const firstCharacter = (value: string): [string, string] => {
  const chars = Array.from(value);
  return [chars[0] ?? '', chars.slice(1).join('')];
};

export const capitalizeCategoryLabel = (value: string): string => {
  const [first, rest] = firstCharacter(value);
  return first ? `${first.toLocaleUpperCase('nl-NL')}${rest}` : value;
};

const isLowercaseInitial = (value: string): boolean => {
  const [first] = firstCharacter(value);
  return Boolean(first) && /^\p{Ll}$/u.test(first);
};

const asInputJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(canonicalizeEvidence(value)) as Prisma.InputJsonValue;

const referenceCount = (category: CategoryRow): number =>
  category._count.transactions
  + category._count.transactionBookings
  + category._count.categorizationRules
  + category._count.categorizationSuggestions;

const buildPlanHash = (input: Omit<CategoryNormalizationPlanInternal, 'planHash' | 'summary'> & { summary: CategoryNormalizationSummary }): string =>
  crypto.createHash('sha256').update(canonicalizeEvidence(input)).digest('hex');

export const buildCategoryNormalizationPlan = async (
  db: Db,
  input: { workspaceId: string; userId: string; mappings?: CategoryMergeMapping[] },
): Promise<CategoryNormalizationPlanInternal> => {
  const categories = await db.category.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: {
      _count: {
        select: {
          transactions: true,
          transactionBookings: true,
          categorizationRules: true,
          categorizationSuggestions: true,
          beforeReviewDecisions: true,
          afterReviewDecisions: true,
          reportSnapshotLines: true,
        },
      },
    },
  }) as CategoryRow[];

  const byName = new Map(categories.map((category) => [category.name, category]));
  const automaticCategoryChanges: CategoryChange[] = categories
    // Historical merge sources remain as inactive records for provenance. Do not
    // keep proposing them once their live references have been moved.
    .filter((category) => isLowercaseInitial(category.name) && (category.isActive || referenceCount(category) > 0))
    .map((category) => {
      const targetName = capitalizeCategoryLabel(category.name);
      const target = byName.get(targetName);
      return {
        sourceId: category.id,
        sourceName: category.name,
        targetId: target?.id ?? category.id,
        targetName,
        merge: Boolean(target && target.id !== category.id),
      };
    });

  const explicitMappings = input.mappings ?? [];
  const explicitBlockers: string[] = [];
  const explicitCategoryChanges: CategoryChange[] = [];
  const usedSources = new Set<string>();
  for (const mapping of explicitMappings) {
    const source = byName.get(mapping.sourceName);
    const target = byName.get(mapping.targetName);
    if (!mapping.sourceName || !mapping.targetName || mapping.sourceName === mapping.targetName) {
      explicitBlockers.push('Explicit category mappings must name two different, non-empty labels.');
      continue;
    }
    if (!source) {
      explicitBlockers.push(`Source category '${mapping.sourceName}' was not found.`);
      continue;
    }
    if (!target) {
      explicitBlockers.push(`Target category '${mapping.targetName}' was not found.`);
      continue;
    }
    if (usedSources.has(source.id)) {
      explicitBlockers.push(`Source category '${mapping.sourceName}' is mapped more than once.`);
      continue;
    }
    usedSources.add(source.id);
    if (!target.isActive) {
      explicitBlockers.push(`Explicit merge target '${mapping.targetName}' is inactive; activate it or choose an active target.`);
      continue;
    }
    if (!source.isActive && referenceCount(source) === 0) continue;
    if (source.id === target.id) {
      explicitBlockers.push(`Source and target resolve to the same category '${mapping.sourceName}'.`);
      continue;
    }
    if (automaticCategoryChanges.some((change) => change.sourceId === source.id)) {
      explicitBlockers.push(`Category '${mapping.sourceName}' already has an automatic capitalization mapping.`);
      continue;
    }
    explicitCategoryChanges.push({
      sourceId: source.id,
      sourceName: source.name,
      targetId: target.id,
      targetName: target.name,
      merge: true,
    });
  }
  const categoryChanges = [...automaticCategoryChanges, ...explicitCategoryChanges];

  const categoryChangesByTargetName = new Map<string, CategoryChange[]>();
  for (const change of categoryChanges) {
    const group = categoryChangesByTargetName.get(change.targetName) ?? [];
    group.push(change);
    categoryChangesByTargetName.set(change.targetName, group);
  }
  const normalizationCollisionBlockers = Array.from(categoryChangesByTargetName.entries())
    .filter(([targetName, changes]) => changes.length > 1 && !byName.has(targetName))
    .map(([targetName]) => `Multiple category labels normalize to '${targetName}', but no canonical category exists.`);
  const sourceCategoryById = new Map(categories.map((category) => [category.id, category]));
  const inactiveMergeTargetBlockers = categoryChanges
    .filter((change) => {
      const source = sourceCategoryById.get(change.sourceId);
      const target = sourceCategoryById.get(change.targetId);
      return change.merge && source && target && !target.isActive && referenceCount(source) > 0;
    })
    .map((change) => `Used category '${change.sourceName}' cannot be merged into inactive target '${change.targetName}'. Activate the target or review this mapping first.`);
  const categoryPlanBlockers = [...explicitBlockers, ...normalizationCollisionBlockers, ...inactiveMergeTargetBlockers];

  const sourceIds = categoryChanges.map((change) => change.sourceId);
  const [transactionRows, rules, suggestions] = sourceIds.length
    ? await Promise.all([
      db.transaction.findMany({
        where: {
          OR: [
            { categoryId: { in: sourceIds } },
            { transactionBooking: { is: { workspaceId: input.workspaceId, categoryId: { in: sourceIds } } } },
          ],
        },
        select: {
          id: true,
          userId: true,
          date: true,
          amountMinor: true,
          direction: true,
          categoryId: true,
          classificationSource: true,
          classificationRuleId: true,
          transactionBooking: {
            select: {
              id: true,
              workspaceId: true,
              projectId: true,
              transactionTypeId: true,
              categoryId: true,
              source: true,
              ruleId: true,
              historicalSourceTransactionId: true,
              historicalMatchKey: true,
              literalCategoryLabel: true,
              evidenceHash: true,
              confirmedBy: true,
              confirmedAt: true,
              project: { select: { workspaceId: true } },
              transactionType: { select: { workspaceId: true } },
              category: { select: { workspaceId: true } },
            },
          },
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }) as Promise<TransactionRow[]>,
      db.categorizationRule.findMany({ where: { categoryId: { in: sourceIds } }, select: { id: true, categoryId: true }, orderBy: { id: 'asc' } }) as Promise<RuleRow[]>,
      db.categorizationSuggestion.findMany({ where: { workspaceId: input.workspaceId, categoryId: { in: sourceIds } }, select: { id: true, categoryId: true }, orderBy: { id: 'asc' } }) as Promise<SuggestionRow[]>,
    ])
    : [[], [], []] as [TransactionRow[], RuleRow[], SuggestionRow[]];

  const changeBySourceId = new Map(categoryChanges.map((change) => [change.sourceId, change]));
  const transactionIds = transactionRows.map((row) => row.id);
  const decisionRows = transactionIds.length
    ? await db.reviewDecision.findMany({
      where: { transactionId: { in: transactionIds } },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        transactionId: true,
        workspaceId: true,
        action: true,
        afterBookingId: true,
        afterProjectId: true,
        afterTypeId: true,
        afterCategoryId: true,
        evidenceHash: true,
        actorId: true,
        decidedAt: true,
        suggestion: { select: { workspaceId: true, status: true } },
      },
    })
    : [];
  const latestDecisionByTransaction = new Map<string, (typeof decisionRows)[number]>();
  const decisionWorkspaceIdsByTransaction = new Map<string, string[]>();
  for (const decision of decisionRows) {
    const workspaceIds = decisionWorkspaceIdsByTransaction.get(decision.transactionId) ?? [];
    workspaceIds.push(decision.workspaceId);
    decisionWorkspaceIdsByTransaction.set(decision.transactionId, workspaceIds);
    if (!latestDecisionByTransaction.has(decision.transactionId)) {
      latestDecisionByTransaction.set(decision.transactionId, decision);
    }
  }
  const blockers: string[] = [...categoryPlanBlockers];
  const transactionBlockerStart = blockers.length;
  const transactions: TransactionChange[] = [];
  const countByYear: Record<string, number> = {};
  let incomeMinor = 0n;
  let expenseMinor = 0n;

  for (const row of transactionRows) {
    const bookingCategoryId = row.transactionBooking?.categoryId ?? null;
    const sourceCategoryId = bookingCategoryId ?? row.categoryId;
    const change = sourceCategoryId ? changeBySourceId.get(sourceCategoryId) : null;
    if (!change) {
      blockers.push(`Transaction ${row.id} has mismatched transaction and booking category references.`);
      continue;
    }
    if (!row.transactionBooking) {
      blockers.push(`Transaction ${row.id} has no current booking; category update requires review provenance.`);
      continue;
    }
    if (row.transactionBooking.workspaceId !== input.workspaceId || row.categoryId !== row.transactionBooking.categoryId) {
      blockers.push(`Transaction ${row.id} has inconsistent workspace/category references.`);
      continue;
    }
    if ([row.transactionBooking.project.workspaceId, row.transactionBooking.transactionType.workspaceId, row.transactionBooking.category.workspaceId].some((workspaceId) => workspaceId !== input.workspaceId)) {
      blockers.push(`Transaction ${row.id} has a cross-workspace booking dimension.`);
      continue;
    }
    if ((decisionWorkspaceIdsByTransaction.get(row.id) ?? []).some((workspaceId) => workspaceId !== input.workspaceId)) {
      blockers.push(`Transaction ${row.id} has a cross-workspace review decision.`);
      continue;
    }
    const latestDecision = latestDecisionByTransaction.get(row.id);
    if (latestDecision && latestDecision.decidedAt.getTime() > Date.now()) {
      blockers.push(`Transaction ${row.id} has a future-dated review decision.`);
      continue;
    }

    const amount = row.amountMinor < 0n ? -row.amountMinor : row.amountMinor;
    if (row.direction === 'credit') incomeMinor += amount;
    else expenseMinor += amount;
    const year = String(row.date.getUTCFullYear());
    countByYear[year] = (countByYear[year] ?? 0) + 1;
    transactions.push({
      id: row.id,
      userId: row.userId,
      date: row.date.toISOString(),
      amountMinor: row.amountMinor.toString(),
      direction: row.direction,
      sourceCategoryId: change.sourceId,
      targetCategoryId: change.targetId,
      sourceCategoryName: change.sourceName,
      targetCategoryName: change.targetName,
      booking: row.transactionBooking,
      classificationSource: row.classificationSource,
      classificationRuleId: row.classificationRuleId,
      latestDecision: (() => {
        const decision = latestDecisionByTransaction.get(row.id);
        return decision ? {
          id: decision.id,
          action: decision.action,
          afterBookingId: decision.afterBookingId,
          afterProjectId: decision.afterProjectId,
          afterTypeId: decision.afterTypeId,
          afterCategoryId: decision.afterCategoryId,
          evidenceHash: decision.evidenceHash,
          workspaceId: decision.workspaceId,
          actorId: decision.actorId,
          decidedAt: decision.decidedAt,
          suggestion: decision.suggestion,
        } : null;
      })(),
      decisionWorkspaceIds: decisionWorkspaceIdsByTransaction.get(row.id) ?? [],
    });
  }

  const mergeTargetIds = new Set(categoryChanges.filter((change) => change.merge).map((change) => change.targetId));
  const retireCategoryIds = Array.from(new Set([
    ...categories.filter((category) => referenceCount(category) === 0 && category.isActive && !mergeTargetIds.has(category.id)).map((category) => category.id),
    ...categoryChanges.filter((change) => change.merge).map((change) => change.sourceId),
  ])).sort();
  const emptyCategories = categories
    .filter((category) => referenceCount(category) === 0)
    .map((category) => ({
      name: category.name,
      referenceCount: 0,
      isActive: category.isActive,
      willDeactivate: retireCategoryIds.includes(category.id),
    }));
  const labels = categoryChanges.map((change) => {
    const matching = transactions.filter((transaction) => transaction.sourceCategoryId === change.sourceId);
    const byYear: Record<string, number> = {};
    const netByYearMinor: Record<string, bigint> = {};
    let categoryIncomeMinor = 0n;
    let categoryExpenseMinor = 0n;
    for (const transaction of matching) {
      const year = String(new Date(transaction.date).getUTCFullYear());
      byYear[year] = (byYear[year] ?? 0) + 1;
      const amount = BigInt(transaction.amountMinor);
      const absolute = amount < 0n ? -amount : amount;
      if (transaction.direction === 'credit') {
        categoryIncomeMinor += absolute;
        netByYearMinor[year] = (netByYearMinor[year] ?? 0n) + absolute;
      } else {
        categoryExpenseMinor += absolute;
        netByYearMinor[year] = (netByYearMinor[year] ?? 0n) - absolute;
      }
    }
    return {
      from: change.sourceName,
      to: change.targetName,
      transactionCount: matching.length,
      merge: change.merge,
      countByYear: byYear,
      netByYearMinor: Object.fromEntries(Object.entries(netByYearMinor).map(([year, amount]) => [year, amount.toString()])),
      incomeMinor: categoryIncomeMinor.toString(),
      expenseMinor: categoryExpenseMinor.toString(),
      netMinor: (categoryIncomeMinor - categoryExpenseMinor).toString(),
    };
  });
  const summary: CategoryNormalizationSummary = {
    categoryCount: categories.length,
    categoryChangeCount: categoryChanges.length,
    mergeCategoryCount: categoryChanges.filter((change) => change.merge).length,
    transactionCount: transactions.length,
    bookingCount: transactions.length,
    ruleCount: rules.length,
    suggestionCount: suggestions.length,
    retireCategoryCount: retireCategoryIds.length,
    blockedTransactionCount: blockers.length - transactionBlockerStart,
    countByYear,
    incomeMinor: incomeMinor.toString(),
    expenseMinor: expenseMinor.toString(),
    netMinor: (incomeMinor - expenseMinor).toString(),
    emptyCategories,
    labels,
    sideEffects: {
      writesPerformed: false,
      mutatesBankFacts: false,
      mutatesReportSnapshots: false,
      preservesBookingSourceAndRuleHistory: true,
    },
  };

  const hashPayload = {
    version: CATEGORY_NORMALIZATION_VERSION as typeof CATEGORY_NORMALIZATION_VERSION,
    workspaceId: input.workspaceId,
    mappings: explicitMappings,
    categories,
    categoryChanges,
    transactions,
    rules,
    suggestions,
    retireCategoryIds,
    blockers,
  };
  return {
    ...hashPayload,
    planHash: buildPlanHash({ ...hashPayload, summary }),
    summary,
  };
};

export const getCategoryNormalizationDryRun = async (
  db: Db,
  input: { workspaceId: string; userId: string; mappings?: CategoryMergeMapping[] },
): Promise<CategoryNormalizationDryRun> => {
  const plan = await buildCategoryNormalizationPlan(db, input);
  return {
    status: plan.blockers.length ? 'BLOCKED' : 'DRY_RUN_COMPLETE',
    dryRun: true,
    writesPerformed: false,
    planHash: plan.planHash,
    summary: plan.summary,
    blockers: plan.blockers,
  };
};

export type CategoryNormalizationActor = {
  userId: string;
  actorId: string;
  actorEmail?: string | null;
};

const isEligibleCurrentDecision = (change: TransactionChange): boolean => {
  const decision = change.latestDecision;
  const booking = change.booking;
  return Boolean(
    decision
    && booking
    && ['ACCEPT_SUGGESTION', 'ASSIGN_MANUALLY', 'CHANGE_BOOKING'].includes(decision.action)
    && decision.afterBookingId === booking.id
    && decision.afterProjectId === booking.projectId
    && decision.afterTypeId === booking.transactionTypeId
    && decision.afterCategoryId === booking.categoryId
    && Boolean(decision.actorId && decision.decidedAt && decision.evidenceHash)
    && Boolean(booking.confirmedBy && booking.confirmedAt && booking.evidenceHash)
    && booking.project.workspaceId === booking.workspaceId
    && booking.transactionType.workspaceId === booking.workspaceId
    && booking.category.workspaceId === booking.workspaceId
    && (decision.action !== 'ACCEPT_SUGGESTION'
      || Boolean(decision.suggestion?.workspaceId === booking.workspaceId && decision.suggestion.status === 'ACCEPTED')),
  );
};

const makeNormalizationDecision = (
  change: TransactionChange,
  input: { workspaceId: string; actor: CategoryNormalizationActor; operationId: string; planHash: string },
) => {
  if (!change.booking || !isEligibleCurrentDecision(change)) return null;
  const evidence = {
    action: ReviewDecisionAction.CHANGE_BOOKING,
    actorId: input.actor.actorId,
    bookingId: change.booking.id,
    categoryNormalization: {
      operationId: input.operationId,
      planHash: input.planHash,
      version: CATEGORY_NORMALIZATION_VERSION,
    },
    before: {
      categoryId: change.sourceCategoryId,
      literalCategoryLabel: change.booking.literalCategoryLabel,
    },
    after: {
      categoryId: change.targetCategoryId,
      literalCategoryLabel: change.targetCategoryName,
    },
    preservedBookingProvenance: {
      source: change.booking.source,
      ruleId: change.booking.ruleId,
      historicalSourceTransactionId: change.booking.historicalSourceTransactionId,
      historicalMatchKey: change.booking.historicalMatchKey,
      evidenceHash: change.booking.evidenceHash,
    },
    reason: 'Audited category-label normalization; imported bank facts are unchanged.',
    transactionId: change.id,
    workspaceId: input.workspaceId,
  };
  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    transactionId: change.id,
    action: ReviewDecisionAction.CHANGE_BOOKING,
    beforeBookingId: change.booking.id,
    beforeProjectId: change.booking.projectId,
    beforeTypeId: change.booking.transactionTypeId,
    beforeCategoryId: change.sourceCategoryId,
    afterBookingId: change.booking.id,
    afterProjectId: change.booking.projectId,
    afterTypeId: change.booking.transactionTypeId,
    afterCategoryId: change.targetCategoryId,
    actorId: input.actor.actorId,
    actorEmail: input.actor.actorEmail ?? null,
    reason: 'Audited category-label normalization; imported bank facts are unchanged.',
    evidence: asInputJson(evidence),
    evidenceHash: hashEvidence(evidence),
    decidedAt: new Date(Math.max(Date.now(), (change.latestDecision?.decidedAt.getTime() ?? 0) + 1)),
  };
};

const buildAppliedAuditEntries = (
  plan: CategoryNormalizationPlanInternal,
  actor: CategoryNormalizationActor,
  operationId: string,
  decisions: Map<string, string>,
) => {
  const metadata = { operationId, planHash: plan.planHash, version: CATEGORY_NORMALIZATION_VERSION };
  const entries: Array<Record<string, unknown>> = [];
  for (const change of plan.categoryChanges) {
    const before = plan.categories.find((category) => category.id === change.sourceId);
    if (!before) continue;
    const after = change.merge || plan.retireCategoryIds.includes(change.sourceId)
      ? { ...before, name: change.merge ? before.name : change.targetName, isActive: false, isHistorical: true }
      : { ...before, name: change.targetName };
    entries.push({
      userId: actor.userId,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail ?? null,
      action: 'category.normalization.category',
      entityType: 'category',
      entityId: change.sourceId,
      before: asInputJson({ name: before.name, isActive: before.isActive, isHistorical: before.isHistorical }),
      after: asInputJson({ name: after.name, isActive: after.isActive, isHistorical: after.isHistorical }),
      metadata: asInputJson(metadata),
    });
  }
  for (const categoryId of plan.retireCategoryIds) {
    if (plan.categoryChanges.some((change) => change.sourceId === categoryId)) continue;
    const before = plan.categories.find((category) => category.id === categoryId);
    if (!before) continue;
    entries.push({
      userId: actor.userId,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail ?? null,
      action: 'category.normalization.category',
      entityType: 'category',
      entityId: categoryId,
      before: asInputJson({ name: before.name, isActive: before.isActive, isHistorical: before.isHistorical }),
      after: asInputJson({ name: before.name, isActive: false, isHistorical: true }),
      metadata: asInputJson(metadata),
    });
  }
  for (const change of plan.transactions) {
    const booking = change.booking!;
    entries.push({
      userId: change.userId,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail ?? null,
      action: 'category.normalization.transaction',
      entityType: 'transaction',
      entityId: change.id,
      before: asInputJson({
        date: change.date,
        amountMinor: change.amountMinor,
        direction: change.direction,
        categoryId: change.sourceCategoryId,
        bookingId: booking.id,
        bookingWorkspaceId: booking.workspaceId,
        projectId: booking.projectId,
        transactionTypeId: booking.transactionTypeId,
        bookingCategoryId: booking.categoryId,
        literalCategoryLabel: booking.literalCategoryLabel,
        bookingSource: booking.source,
        ruleId: booking.ruleId,
        historicalSourceTransactionId: booking.historicalSourceTransactionId,
        historicalMatchKey: booking.historicalMatchKey,
        bookingEvidenceHash: booking.evidenceHash,
        bookingConfirmedBy: booking.confirmedBy,
        bookingConfirmedAt: booking.confirmedAt.toISOString(),
        bookingDimensionWorkspaces: [booking.project.workspaceId, booking.transactionType.workspaceId, booking.category.workspaceId],
        decisionWorkspaceIds: change.decisionWorkspaceIds,
        classificationSource: change.classificationSource,
        classificationRuleId: change.classificationRuleId,
        decisionWasEligible: isEligibleCurrentDecision(change),
      }),
      after: asInputJson({
        date: change.date,
        amountMinor: change.amountMinor,
        direction: change.direction,
        categoryId: change.targetCategoryId,
        bookingId: booking.id,
        bookingWorkspaceId: booking.workspaceId,
        projectId: booking.projectId,
        transactionTypeId: booking.transactionTypeId,
        bookingCategoryId: change.targetCategoryId,
        literalCategoryLabel: change.targetCategoryName,
        bookingSource: booking.source,
        ruleId: booking.ruleId,
        historicalSourceTransactionId: booking.historicalSourceTransactionId,
        historicalMatchKey: booking.historicalMatchKey,
        bookingEvidenceHash: booking.evidenceHash,
        bookingConfirmedBy: booking.confirmedBy,
        bookingConfirmedAt: booking.confirmedAt.toISOString(),
        bookingDimensionWorkspaces: [booking.project.workspaceId, booking.transactionType.workspaceId, booking.category.workspaceId],
        decisionWorkspaceIds: change.decisionWorkspaceIds,
        classificationSource: change.classificationSource,
        classificationRuleId: change.classificationRuleId,
        normalizationDecisionId: decisions.get(change.id) ?? null,
        latestDecisionId: decisions.get(change.id) ?? change.latestDecision?.id ?? null,
      }),
      metadata: asInputJson(metadata),
    });
  }
  for (const rule of plan.rules) {
    const change = plan.categoryChanges.find((entry) => entry.sourceId === rule.categoryId);
    if (!change || change.sourceId === change.targetId) continue;
    entries.push({
      userId: actor.userId,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail ?? null,
      action: 'category.normalization.rule',
      entityType: 'categorizationRule',
      entityId: rule.id,
      before: asInputJson({ categoryId: rule.categoryId }),
      after: asInputJson({ categoryId: change.targetId }),
      metadata: asInputJson(metadata),
    });
  }
  for (const suggestion of plan.suggestions) {
    const change = suggestion.categoryId
      ? plan.categoryChanges.find((entry) => entry.sourceId === suggestion.categoryId)
      : null;
    if (!change || change.sourceId === change.targetId) continue;
    entries.push({
      userId: actor.userId,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail ?? null,
      action: 'category.normalization.suggestion',
      entityType: 'categorizationSuggestion',
      entityId: suggestion.id,
      before: asInputJson({ categoryId: suggestion.categoryId }),
      after: asInputJson({ categoryId: change.targetId }),
      metadata: asInputJson(metadata),
    });
  }
  entries.push({
    userId: actor.userId,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail ?? null,
    action: 'category.normalization.applied',
    entityType: 'categoryNormalization',
    entityId: operationId,
    before: asInputJson({ planHash: plan.planHash }),
    after: asInputJson(plan.summary),
    metadata: asInputJson(metadata),
  });
  return entries;
};

export const executeCategoryNormalization = async (
  db: PrismaClient,
  input: {
    workspaceId: string;
    userId: string;
    actor: CategoryNormalizationActor;
    confirmedPlanHash: string;
    mappings?: CategoryMergeMapping[];
  },
) => {
  const initialPlan = await buildCategoryNormalizationPlan(db, input);
  if (initialPlan.blockers.length) {
    return { status: 'BLOCKED' as const, writesPerformed: false, planHash: initialPlan.planHash, summary: initialPlan.summary, blockers: initialPlan.blockers };
  }
  if (initialPlan.planHash !== input.confirmedPlanHash) {
    return { status: 'HASH_DRIFT' as const, writesPerformed: false, planHash: initialPlan.planHash, summary: initialPlan.summary, blockers: [] };
  }

  return db.$transaction(async (tx) => {
    const plan = await buildCategoryNormalizationPlan(tx, input);
    if (plan.planHash !== input.confirmedPlanHash || plan.blockers.length) {
      return { status: 'HASH_DRIFT' as const, writesPerformed: false, planHash: plan.planHash, summary: plan.summary, blockers: plan.blockers };
    }

    const operationId = crypto.randomUUID();
    const decisions = plan.transactions
      .map((change) => makeNormalizationDecision(change, { workspaceId: input.workspaceId, actor: input.actor, operationId, planHash: plan.planHash }))
      .filter((decision): decision is NonNullable<typeof decision> => Boolean(decision));
    const decisionIdByTransaction = new Map(decisions.map((decision) => [decision.transactionId, decision.id]));

    for (const change of plan.categoryChanges) {
      if (change.sourceId !== change.targetId) {
        await tx.transaction.updateMany({ where: { categoryId: change.sourceId }, data: { categoryId: change.targetId } });
        await tx.transactionBooking.updateMany({
          where: { workspaceId: input.workspaceId, categoryId: change.sourceId },
          data: { categoryId: change.targetId, literalCategoryLabel: change.targetName },
        });
        await tx.categorizationRule.updateMany({ where: { categoryId: change.sourceId }, data: { categoryId: change.targetId } });
        await tx.categorizationSuggestion.updateMany({
          where: { workspaceId: input.workspaceId, categoryId: change.sourceId },
          data: { categoryId: change.targetId },
        });
      } else {
        await tx.transactionBooking.updateMany({
          where: { workspaceId: input.workspaceId, categoryId: change.sourceId },
          data: { literalCategoryLabel: change.targetName },
        });
      }
      if (change.merge || plan.retireCategoryIds.includes(change.sourceId)) {
        await tx.category.update({ where: { id: change.sourceId }, data: { isActive: false, isHistorical: true } });
        if (!change.merge) await tx.category.update({ where: { id: change.sourceId }, data: { name: change.targetName } });
      } else {
        await tx.category.update({ where: { id: change.sourceId }, data: { name: change.targetName } });
      }
    }
    const retiredIds = plan.retireCategoryIds.filter((id) => !plan.categoryChanges.some((change) => change.sourceId === id));
    if (retiredIds.length) {
      await tx.category.updateMany({
        where: { workspaceId: input.workspaceId, id: { in: retiredIds } },
        data: { isActive: false, isHistorical: true },
      });
    }
    if (decisions.length) await tx.reviewDecision.createMany({ data: decisions });
    const auditEntries = buildAppliedAuditEntries(plan, input.actor, operationId, decisionIdByTransaction);
    await tx.auditLog.createMany({ data: auditEntries as Prisma.AuditLogCreateManyInput[] });
    return {
      status: 'APPLIED' as const,
      writesPerformed: true,
      operationId,
      planHash: plan.planHash,
      summary: plan.summary,
      decisionCount: decisions.length,
      auditEntryCount: auditEntries.length,
    };
  }, {
    maxWait: 10000,
    timeout: 120000,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
};

type AuditEntry = {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const readString = (value: unknown): string | null => typeof value === 'string' ? value : null;

type CategoryNormalizationRollbackPlan = {
  operationId: string;
  workspaceId: string;
  planHash: string;
  transactionEntries: AuditEntry[];
  categoryEntries: AuditEntry[];
  ruleEntries: AuditEntry[];
  suggestionEntries: AuditEntry[];
  decisionEntries: Array<{ transactionId: string; bookingId: string; beforeCategoryId: string; afterCategoryId: string }>;
  latestDecisionAtByTransaction: Map<string, number>;
  blockers: string[];
  summary: {
    transactionCount: number;
    categoryCount: number;
    ruleCount: number;
    suggestionCount: number;
    writesPerformed: false;
  };
};

const buildCategoryNormalizationRollbackPlan = async (
  db: Db,
  input: { workspaceId: string; operationId: string },
): Promise<CategoryNormalizationRollbackPlan> => {
  const audit = await db.auditLog.findMany({
    where: {
      action: {
        in: [
          'category.normalization.applied',
          'category.normalization.category',
          'category.normalization.transaction',
          'category.normalization.rule',
          'category.normalization.suggestion',
          'category.normalization.reverted',
        ],
      },
      metadata: { path: ['operationId'], equals: input.operationId },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, action: true, entityType: true, entityId: true, before: true, after: true, metadata: true },
  }) as AuditEntry[];
  const blockers: string[] = [];
  const applied = audit.filter((entry) => entry.action === 'category.normalization.applied' && entry.entityType === 'categoryNormalization');
  const reverted = audit.some((entry) => entry.action === 'category.normalization.reverted');
  if (applied.length !== 1) blockers.push(applied.length ? 'Operation audit header is ambiguous.' : 'Normalization operation was not found.');
  if (reverted) blockers.push('This normalization operation has already been reversed.');

  const transactionEntries = audit.filter((entry) => entry.action === 'category.normalization.transaction');
  const categoryEntries = audit.filter((entry) => entry.action === 'category.normalization.category');
  const ruleEntries = audit.filter((entry) => entry.action === 'category.normalization.rule');
  const suggestionEntries = audit.filter((entry) => entry.action === 'category.normalization.suggestion');
  const transactionIds = transactionEntries.map((entry) => entry.entityId).filter((id): id is string => Boolean(id));
  const categoryIds = categoryEntries.map((entry) => entry.entityId).filter((id): id is string => Boolean(id));
  const ruleIds = ruleEntries.map((entry) => entry.entityId).filter((id): id is string => Boolean(id));
  const suggestionIds = suggestionEntries.map((entry) => entry.entityId).filter((id): id is string => Boolean(id));

  const transactions = transactionIds.length ? await db.transaction.findMany({
      where: { id: { in: transactionIds } },
      select: {
        id: true, categoryId: true, date: true, amountMinor: true, direction: true,
        classificationSource: true, classificationRuleId: true,
        transactionBooking: { select: {
          id: true, workspaceId: true, projectId: true, transactionTypeId: true, categoryId: true,
          literalCategoryLabel: true, source: true, ruleId: true,
          historicalSourceTransactionId: true, historicalMatchKey: true, evidenceHash: true,
          confirmedBy: true, confirmedAt: true,
          project: { select: { workspaceId: true } },
          transactionType: { select: { workspaceId: true } },
          category: { select: { workspaceId: true } },
        } },
      },
    }) as Array<{
      id: string; categoryId: string | null; date: Date; amountMinor: bigint; direction: 'credit' | 'debit';
      classificationSource: string; classificationRuleId: string | null;
      transactionBooking: null | {
        id: string; workspaceId: string; projectId: string; transactionTypeId: string; categoryId: string;
        literalCategoryLabel: string; source: string; ruleId: string | null; historicalSourceTransactionId: string | null;
        historicalMatchKey: string | null; evidenceHash: string; confirmedBy: string | null; confirmedAt: Date;
        project: { workspaceId: string }; transactionType: { workspaceId: string }; category: { workspaceId: string };
      };
    }> : [];
  const categories = categoryIds.length
    ? await db.category.findMany({ where: { id: { in: categoryIds }, workspaceId: input.workspaceId }, select: { id: true, name: true, isActive: true, isHistorical: true } })
    : [];
  const rules = ruleIds.length
    ? await db.categorizationRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, categoryId: true } })
    : [];
  const suggestions = suggestionIds.length
    ? await db.categorizationSuggestion.findMany({ where: { id: { in: suggestionIds }, workspaceId: input.workspaceId }, select: { id: true, categoryId: true } })
    : [];
  const decisions = transactionIds.length ? await db.reviewDecision.findMany({
      where: { transactionId: { in: transactionIds } },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, transactionId: true, workspaceId: true, decidedAt: true },
    }) : [];
  const transactionById = new Map(transactions.map((entry) => [entry.id, entry]));
  const categoryById = new Map(categories.map((entry) => [entry.id, entry]));
  const ruleById = new Map(rules.map((entry) => [entry.id, entry]));
  const suggestionById = new Map(suggestions.map((entry) => [entry.id, entry]));
  const latestDecisionByTransaction = new Map<string, { id: string; workspaceId: string; decidedAt: Date }>();
  const decisionWorkspaceIdsByTransaction = new Map<string, string[]>();
  for (const decision of decisions) {
    const workspaceIds = decisionWorkspaceIdsByTransaction.get(decision.transactionId) ?? [];
    workspaceIds.push(decision.workspaceId);
    decisionWorkspaceIdsByTransaction.set(decision.transactionId, workspaceIds);
    if (!latestDecisionByTransaction.has(decision.transactionId)) latestDecisionByTransaction.set(decision.transactionId, { id: decision.id, workspaceId: decision.workspaceId, decidedAt: decision.decidedAt });
  }

  for (const entry of transactionEntries) {
    const before = asRecord(entry.before);
    const after = asRecord(entry.after);
    const current = entry.entityId ? transactionById.get(entry.entityId) : null;
    const booking = current?.transactionBooking;
    if (!before || !after || !current || !booking) {
      blockers.push(`Transaction audit target ${entry.entityId ?? '(missing id)'} is unavailable.`);
      continue;
    }
    if (
      current.categoryId !== after.categoryId
      || booking.categoryId !== after.bookingCategoryId
      || booking.literalCategoryLabel !== after.literalCategoryLabel
      || booking.id !== after.bookingId
      || booking.workspaceId !== after.bookingWorkspaceId
      || booking.projectId !== after.projectId
      || booking.transactionTypeId !== after.transactionTypeId
      || booking.source !== after.bookingSource
      || booking.ruleId !== after.ruleId
      || booking.historicalSourceTransactionId !== after.historicalSourceTransactionId
      || booking.historicalMatchKey !== after.historicalMatchKey
      || booking.evidenceHash !== after.bookingEvidenceHash
      || booking.confirmedBy !== after.bookingConfirmedBy
      || booking.confirmedAt.toISOString() !== after.bookingConfirmedAt
      || [booking.project.workspaceId, booking.transactionType.workspaceId, booking.category.workspaceId].some((workspaceId) => workspaceId !== input.workspaceId)
      || current.classificationSource !== after.classificationSource
      || current.classificationRuleId !== after.classificationRuleId
      || current.date.toISOString() !== after.date
      || current.amountMinor.toString() !== after.amountMinor
      || current.direction !== after.direction
      || (latestDecisionByTransaction.get(current.id)?.id ?? null) !== (after.latestDecisionId ?? null)
      || (latestDecisionByTransaction.get(current.id)?.workspaceId ?? null) !== (after.latestDecisionId ? input.workspaceId : null)
      || (latestDecisionByTransaction.get(current.id)?.decidedAt.getTime() ?? 0) > Date.now()
      || (decisionWorkspaceIdsByTransaction.get(current.id) ?? []).some((workspaceId) => workspaceId !== input.workspaceId)
    ) blockers.push(`Transaction ${entry.entityId} has changed since normalization; rollback would overwrite later work.`);
  }
  for (const entry of categoryEntries) {
    const after = asRecord(entry.after);
    const current = entry.entityId ? categoryById.get(entry.entityId) : null;
    if (!after || !current || current.name !== after.name || current.isActive !== after.isActive || current.isHistorical !== after.isHistorical) {
      blockers.push(`Category ${entry.entityId ?? '(missing id)'} has changed since normalization.`);
    }
  }
  for (const entry of ruleEntries) {
    const after = asRecord(entry.after);
    const current = entry.entityId ? ruleById.get(entry.entityId) : null;
    if (!after || !current || current.categoryId !== after.categoryId) blockers.push(`Rule ${entry.entityId ?? '(missing id)'} has changed since normalization.`);
  }
  for (const entry of suggestionEntries) {
    const after = asRecord(entry.after);
    const current = entry.entityId ? suggestionById.get(entry.entityId) : null;
    if (!after || !current || current.categoryId !== after.categoryId) blockers.push(`Suggestion ${entry.entityId ?? '(missing id)'} has changed since normalization.`);
  }

  const decisionEntries = transactionEntries.flatMap((entry) => {
    const before = asRecord(entry.before);
    const after = asRecord(entry.after);
    if (!before || !after || !after.normalizationDecisionId) return [];
    return [{
      transactionId: entry.entityId!,
      bookingId: String(after.bookingId),
      beforeCategoryId: String(after.categoryId),
      afterCategoryId: String(before.categoryId),
    }];
  });
  const hashPayload = {
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    auditIds: audit.map((entry) => entry.id),
    currentTransactions: transactions.map((entry) => ({
      id: entry.id, categoryId: entry.categoryId,
      bookingId: entry.transactionBooking?.id ?? null,
      bookingCategoryId: entry.transactionBooking?.categoryId ?? null,
      literalCategoryLabel: entry.transactionBooking?.literalCategoryLabel ?? null,
      updatedAt: entry.date,
      classificationSource: entry.classificationSource,
      classificationRuleId: entry.classificationRuleId,
      amountMinor: entry.amountMinor.toString(),
      direction: entry.direction,
      latestDecisionAt: latestDecisionByTransaction.get(entry.id)?.decidedAt.toISOString() ?? null,
    })),
    currentCategories: categories,
    currentRules: rules,
    currentSuggestions: suggestions,
    blockers,
  };
  return {
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    planHash: hashEvidence(hashPayload),
    transactionEntries,
    categoryEntries,
    ruleEntries,
    suggestionEntries,
    decisionEntries,
    latestDecisionAtByTransaction: new Map(Array.from(latestDecisionByTransaction.entries()).map(([transactionId, decision]) => [transactionId, decision.decidedAt.getTime()])),
    blockers,
    summary: {
      transactionCount: transactionEntries.length,
      categoryCount: categoryEntries.length,
      ruleCount: ruleEntries.length,
      suggestionCount: suggestionEntries.length,
      writesPerformed: false,
    },
  };
};

export const getCategoryNormalizationRollbackDryRun = async (
  db: Db,
  input: { workspaceId: string; operationId: string },
) => {
  const plan = await buildCategoryNormalizationRollbackPlan(db, input);
  return {
    status: plan.blockers.length ? 'BLOCKED' as const : 'ROLLBACK_DRY_RUN_COMPLETE' as const,
    dryRun: true as const,
    writesPerformed: false as const,
    operationId: plan.operationId,
    planHash: plan.planHash,
    summary: plan.summary,
    blockers: plan.blockers,
  };
};

export const executeCategoryNormalizationRollback = async (
  db: PrismaClient,
  input: { workspaceId: string; operationId: string; actor: CategoryNormalizationActor; confirmedPlanHash: string },
) => {
  const initial = await buildCategoryNormalizationRollbackPlan(db, input);
  if (initial.blockers.length) return { status: 'BLOCKED' as const, writesPerformed: false, planHash: initial.planHash, blockers: initial.blockers, summary: initial.summary };
  if (initial.planHash !== input.confirmedPlanHash) return { status: 'HASH_DRIFT' as const, writesPerformed: false, planHash: initial.planHash, blockers: [], summary: initial.summary };

  return db.$transaction(async (tx) => {
    const plan = await buildCategoryNormalizationRollbackPlan(tx, input);
    if (plan.blockers.length || plan.planHash !== input.confirmedPlanHash) {
      return { status: 'HASH_DRIFT' as const, writesPerformed: false, planHash: plan.planHash, blockers: plan.blockers, summary: plan.summary };
    }
    const transactionById = new Map(plan.transactionEntries.map((entry) => [entry.entityId!, entry]));
    const rows = plan.transactionEntries.map((entry) => {
      const before = asRecord(entry.before)!;
      const after = asRecord(entry.after)!;
      return { entry, before, after };
    });
    const decisionCreateData = plan.decisionEntries.map((entry) => {
      const audit = transactionById.get(entry.transactionId)!;
      const before = asRecord(audit.before)!;
      const after = asRecord(audit.after)!;
      return { audit, before, after, entry };
    });

    for (const row of rows) {
      const bookingId = String(row.after.bookingId);
      await tx.transaction.update({ where: { id: row.entry.entityId! }, data: { categoryId: String(row.before.categoryId) } });
      await tx.transactionBooking.update({
        where: { id: bookingId },
        data: { categoryId: String(row.before.bookingCategoryId), literalCategoryLabel: String(row.before.literalCategoryLabel) },
      });
    }
    for (const entry of plan.ruleEntries) {
      const before = asRecord(entry.before)!;
      await tx.categorizationRule.update({ where: { id: entry.entityId! }, data: { categoryId: String(before.categoryId) } });
    }
    for (const entry of plan.suggestionEntries) {
      const before = asRecord(entry.before)!;
      await tx.categorizationSuggestion.update({ where: { id: entry.entityId! }, data: { categoryId: readString(before.categoryId) } });
    }
    for (const entry of plan.categoryEntries) {
      const before = asRecord(entry.before)!;
      await tx.category.update({
        where: { id: entry.entityId! },
        data: { name: String(before.name), isActive: Boolean(before.isActive), isHistorical: Boolean(before.isHistorical) },
      });
    }

    const reversalDecisions = decisionCreateData.map(({ audit, before, after }) => {
      const transactionId = audit.entityId!;
      const bookingId = String(after.bookingId);
      const newDecisionId = crypto.randomUUID();
      const evidence = {
        action: ReviewDecisionAction.CHANGE_BOOKING,
        actorId: input.actor.actorId,
        categoryNormalizationRollback: { operationId: input.operationId, planHash: plan.planHash, version: CATEGORY_NORMALIZATION_VERSION },
        before: { categoryId: after.categoryId, literalCategoryLabel: after.literalCategoryLabel },
        after: { categoryId: before.categoryId, literalCategoryLabel: before.literalCategoryLabel },
        preservedBookingProvenance: {
          source: after.bookingSource,
          ruleId: after.ruleId,
          historicalSourceTransactionId: after.historicalSourceTransactionId,
          historicalMatchKey: after.historicalMatchKey,
          evidenceHash: after.bookingEvidenceHash,
        },
        reason: 'Reversal of audited category-label normalization.',
        transactionId,
        workspaceId: input.workspaceId,
      };
      return {
        id: newDecisionId,
        workspaceId: input.workspaceId,
        transactionId,
        action: ReviewDecisionAction.CHANGE_BOOKING,
        beforeBookingId: bookingId,
        beforeProjectId: String(before.projectId),
        beforeTypeId: String(before.transactionTypeId),
        beforeCategoryId: String(after.categoryId),
        afterBookingId: bookingId,
        afterProjectId: String(before.projectId),
        afterTypeId: String(before.transactionTypeId),
        afterCategoryId: String(before.categoryId),
        actorId: input.actor.actorId,
        actorEmail: input.actor.actorEmail ?? null,
        reason: 'Reversal of audited category-label normalization.',
        evidence: asInputJson(evidence),
        evidenceHash: hashEvidence(evidence),
        decidedAt: new Date(Math.max(Date.now(), (plan.latestDecisionAtByTransaction.get(transactionId) ?? 0) + 1)),
      };
    });
    if (reversalDecisions.length) await tx.reviewDecision.createMany({ data: reversalDecisions });

    const metadata = { operationId: input.operationId, rollbackPlanHash: plan.planHash, version: CATEGORY_NORMALIZATION_VERSION };
    const auditEntries = rows.map(({ entry, before, after }) => ({
      userId: entry.userId,
      actorId: input.actor.actorId,
      actorEmail: input.actor.actorEmail ?? null,
      action: 'category.normalization.rollback.transaction',
      entityType: 'transaction',
      entityId: entry.entityId,
      before: asInputJson({ categoryId: after.categoryId, bookingCategoryId: after.bookingCategoryId, literalCategoryLabel: after.literalCategoryLabel }),
      after: asInputJson({ categoryId: before.categoryId, bookingCategoryId: before.bookingCategoryId, literalCategoryLabel: before.literalCategoryLabel }),
      metadata: asInputJson(metadata),
    }));
    auditEntries.push({
      userId: input.actor.userId,
      actorId: input.actor.actorId,
      actorEmail: input.actor.actorEmail ?? null,
      action: 'category.normalization.reverted',
      entityType: 'categoryNormalization',
      entityId: input.operationId,
      before: asInputJson({ operationId: input.operationId }),
      after: asInputJson(plan.summary),
      metadata: asInputJson(metadata),
    });
    await tx.auditLog.createMany({ data: auditEntries as Prisma.AuditLogCreateManyInput[] });
    return { status: 'REVERSED' as const, writesPerformed: true, operationId: input.operationId, planHash: plan.planHash, summary: plan.summary, auditEntryCount: auditEntries.length };
  }, {
    maxWait: 10000,
    timeout: 120000,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
};
