import type { CategorizationRule, Prisma, TransactionClassificationSource } from '@prisma/client';
import { findMatchingRule, touchRuleMatch } from './ruleEngine';

const AMOUNT_THRESHOLD_EUROS = Number(process.env.AMOUNT_MATCH_THRESHOLD ?? 0.01);
const AMOUNT_THRESHOLD_MINOR = BigInt(
  Math.max(1, Math.round(AMOUNT_THRESHOLD_EUROS * 100)),
);

/**
 * Each transaction must be either in the review queue or in the ledger, never in neither.
 * All transitions out of review should go through this helper to keep the invariant.
 */
export const confirmTransactions = async (
  tx: Prisma.TransactionClient,
  params: { userId: string; transactionIds: string[] },
): Promise<number> => {
  if (!params.transactionIds.length) return 0;

  const result = await tx.transaction.updateMany({
    where: {
      userId: params.userId,
      id: { in: params.transactionIds },
      classificationSource: {
        not: 'manual',
      },
    },
    data: {
      classificationSource: 'manual',
    },
  });

  return result.count;
};

export interface CategorizationCandidate {
  userId: string;
  source: string;
  normalizedDescription: string;
  description: string;
  amountMinor: bigint;
  accountIdentifier: string;
  counterparty?: string | null;
  reference?: string | null;
}

export const categorizeTransaction = async (
  tx: Prisma.TransactionClient,
  candidate: CategorizationCandidate,
  options: { rules?: CategorizationRule[] } = {},
): Promise<{
  categoryId: string | null;
  classificationSource: TransactionClassificationSource;
  ruleId: string | null;
}> => {
  const rules = options.rules;
  const rule = findMatchingRule(rules, {
    description: candidate.description,
    normalizedDescription: candidate.normalizedDescription,
    counterparty: candidate.counterparty,
    reference: candidate.reference,
    source: candidate.source,
    amountMinor: candidate.amountMinor,
  });

  if (rule) {
    await touchRuleMatch(tx, rule.id);
    return {
      categoryId: rule.categoryId,
      classificationSource: 'rule',
      ruleId: rule.id,
    };
  }

  const lowerBound = candidate.amountMinor - AMOUNT_THRESHOLD_MINOR;
  const upperBound = candidate.amountMinor + AMOUNT_THRESHOLD_MINOR;

  const exactMatch = await tx.transaction.findFirst({
    where: {
      userId: candidate.userId,
      source: candidate.source,
      amountMinor: {
        gte: lowerBound,
        lte: upperBound,
      },
      categoryId: {
        not: null,
      },
    },
    orderBy: {
      date: 'desc',
    },
    select: {
      categoryId: true,
    },
  });

  if (exactMatch?.categoryId) {
    return {
      categoryId: exactMatch.categoryId,
      classificationSource: 'history',
      ruleId: null,
    };
  }

  const normalizedMatch = await tx.transaction.findFirst({
    where: {
      userId: candidate.userId,
      normalizedKey: candidate.normalizedDescription,
      amountMinor: {
        gte: lowerBound,
        lte: upperBound,
      },
      categoryId: {
        not: null,
      },
    },
    orderBy: {
      date: 'desc',
    },
    select: {
      categoryId: true,
    },
  });

  if (normalizedMatch?.categoryId) {
    return {
      categoryId: normalizedMatch.categoryId,
      classificationSource: 'history',
      ruleId: null,
    };
  }

  const history = await tx.transaction.findMany({
    where: {
      userId: candidate.userId,
      source: candidate.source,
      categoryId: {
        not: null,
      },
    },
    select: {
      categoryId: true,
    },
  });

  const counts = history.reduce<Record<string, number>>((acc, record) => {
    if (!record.categoryId) {
      return acc;
    }

    acc[record.categoryId] = (acc[record.categoryId] ?? 0) + 1;
    return acc;
  }, {});

  const popularEntry = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .find(([, count]) => count >= 3);

  if (popularEntry) {
    return {
      categoryId: popularEntry[0],
      classificationSource: 'history',
      ruleId: null,
    };
  }

  return {
    categoryId: null,
    classificationSource: 'none',
    ruleId: null,
  };
};
