import type {
  CategorizationRule,
  Prisma,
  RuleMatchField,
  RuleMatchType,
  Transaction,
  TransactionClassificationSource,
} from '@prisma/client';
import { confirmTransactions } from './categorizationService';

type RuleConditionField = 'payee' | 'counterparty' | 'description' | 'amount' | 'source' | 'reference';
type RuleConditionMatchType = 'contains' | 'startsWith' | 'endsWith' | 'equals' | 'regex';

export type RuleCondition = {
  field: RuleConditionField;
  matchType: RuleConditionMatchType;
  value: string;
};

export type RuleEvaluationContext = {
  description: string;
  normalizedDescription: string;
  counterparty?: string | null;
  reference?: string | null;
  source?: string | null;
  amountMinor?: bigint | number | null;
};

const ORDER_BY_PRIORITY = [
  { priority: 'desc' as const },
  { updatedAt: 'desc' as const },
  { createdAt: 'desc' as const },
];

export const fetchActiveRules = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<CategorizationRule[]> =>
  tx.categorizationRule.findMany({
    where: {
      userId,
      isActive: true,
    },
    orderBy: ORDER_BY_PRIORITY,
  });

const legacyFieldToConditionField = (matchField?: RuleMatchField | null): RuleConditionField => {
  switch (matchField) {
    case 'counterparty':
      return 'counterparty';
    case 'reference':
      return 'reference';
    case 'source':
      return 'source';
    case 'description':
    default:
      return 'description';
  }
};

const toLower = (value: string): string => value.toLowerCase();

const safeRegex = (pattern: string): RegExp | null => {
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    console.warn('Invalid rule regex pattern', { pattern, error });
    return null;
  }
};

const normalizeAmount = (value?: bigint | number | null): string => {
  if (value == null) return '';
  const num = typeof value === 'bigint' ? Number(value) / 100 : Number(value);
  return num.toFixed(2);
};

const parseAmountToMinor = (raw: string): number | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (!cleaned.length) return null;
  const decimalNormalized = (() => {
    // Replace comma with dot and collapse multiple dots by keeping the last as decimal separator.
    const replaced = cleaned.replace(/,/g, '.');
    const parts = replaced.split('.');
    if (parts.length === 1) {
      return parts[0];
    }
    const decimals = parts.pop();
    const intPart = parts.join('');
    return `${intPart}.${decimals}`;
  })();
  const asNumber = Number(decimalNormalized);
  if (Number.isNaN(asNumber)) return null;
  return Math.round(asNumber * 100);
};

const legacyConditionsFromRule = (rule: CategorizationRule): RuleCondition[] => {
  if (!rule.pattern || !rule.matchField) return [];
  return [
    {
      field: legacyFieldToConditionField(rule.matchField),
      matchType: ((rule.matchType as RuleConditionMatchType) ?? 'contains') as RuleConditionMatchType,
      value: rule.pattern,
    },
  ];
};

const getFieldValueForCondition = (field: RuleConditionField, context: RuleEvaluationContext): string => {
  switch (field) {
    case 'payee':
      return context.description ?? '';
    case 'counterparty':
      return context.counterparty ?? '';
    case 'reference':
      return context.reference ?? '';
    case 'source':
      return context.source ?? '';
    case 'amount':
      return normalizeAmount(context.amountMinor);
    case 'description':
    default:
      return context.description ?? '';
  }
};

export const matchesRule = (rule: CategorizationRule, context: RuleEvaluationContext): boolean => {
  const rawConditions = (rule.conditions as RuleCondition[] | null | undefined) ?? null;
  const conditions = Array.isArray(rawConditions) && rawConditions.length ? rawConditions : legacyConditionsFromRule(rule);
  if (!conditions.length) return false;

  return conditions.every((condition) => {
    if (condition.field === 'amount') {
      if (context.amountMinor == null) return false;
      const txMinor = typeof context.amountMinor === 'bigint' ? Number(context.amountMinor) : Math.round(Number(context.amountMinor));
      const ruleMinor = parseAmountToMinor(condition.value);
      if (ruleMinor == null || Number.isNaN(txMinor)) return false;
      return txMinor === ruleMinor;
    }

    const haystackRaw = getFieldValueForCondition(condition.field, context);
    if (!haystackRaw) return false;

    const haystack = toLower(haystackRaw);
    const needle = toLower(condition.value);

    switch (condition.matchType) {
      case 'regex': {
        const reg = safeRegex(condition.value);
        return reg ? reg.test(haystackRaw) : false;
      }
      case 'startsWith':
        return haystack.startsWith(needle);
      case 'endsWith':
        return haystack.endsWith(needle);
      case 'equals':
        return haystack === needle;
      case 'contains':
      default:
        return haystack.includes(needle);
    }
  });
};

export const findMatchingRule = (
  rules: CategorizationRule[] | undefined,
  context: RuleEvaluationContext,
): CategorizationRule | null => {
  if (!rules?.length) {
    return null;
  }

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (matchesRule(rule, context)) {
      return rule;
    }
  }

  return null;
};

export const previewRuleMatchesForUser = async (
  tx: Prisma.TransactionClient,
  {
    userId,
    ruleId,
    scope,
  }: { userId: string; ruleId: string; scope: 'review-queue' | { importBatchId: string } },
): Promise<any[]> => {
  const rule = await tx.categorizationRule.findFirst({
    where: { id: ruleId, userId, isActive: true },
  });
  if (!rule) {
    return [];
  }

  const scopeFilter =
    scope === 'review-queue'
      ? {
          classificationSource: {
            not: 'manual' as TransactionClassificationSource,
          },
        }
      : {
          importBatchId: (scope as { importBatchId: string }).importBatchId,
        };

  const candidates = await tx.transaction.findMany({
    where: {
      userId,
      ...scopeFilter,
    },
    include: {
      account: {
        select: { name: true, identifier: true },
      },
      category: {
        select: { name: true },
      },
    },
  });

  return candidates.filter((tx) =>
    matchesRule(rule, {
      description: tx.description,
      normalizedDescription: tx.normalizedKey,
      counterparty: tx.counterparty,
      reference: tx.reference,
      source: tx.source,
      amountMinor: tx.amountMinor ?? null,
    }),
  );
};

export const applyRuleToTransactions = async (
  tx: Prisma.TransactionClient,
  {
    userId,
    ruleId,
    transactionIds,
  }: { userId: string; ruleId: string; transactionIds: string[] },
): Promise<number> => {
  if (!transactionIds.length) return 0;

  const rule = await tx.categorizationRule.findFirst({
    where: { id: ruleId, userId },
  });
  if (!rule) return 0;

  await tx.transaction.updateMany({
    where: {
      id: { in: transactionIds },
      userId,
    },
    data: {
      categoryId: rule.categoryId,
      classificationRuleId: rule.id,
    },
  });

  const confirmed = await confirmTransactions(tx, { userId, transactionIds });
  await touchRuleMatch(tx, rule.id);
  return confirmed;
};

export const touchRuleMatch = async (
  tx: Prisma.TransactionClient,
  ruleId: string,
): Promise<void> => {
  await tx.categorizationRule.update({
    where: { id: ruleId },
    data: {
      lastMatchedAt: new Date(),
    },
  });
};

export const listRules = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<CategorizationRule[]> =>
  tx.categorizationRule.findMany({
    where: { userId },
    orderBy: ORDER_BY_PRIORITY,
  });

export const createRule = async (
  tx: Prisma.TransactionClient,
  userId: string,
  payload: {
    label: string;
    pattern?: string;
    matchType?: RuleMatchType;
    matchField?: RuleMatchField;
    categoryId: string;
    priority?: number;
    isActive?: boolean;
    createdBy?: string;
    conditions?: RuleCondition[];
  },
): Promise<CategorizationRule> => {
  return tx.categorizationRule.create({
    data: {
      userId,
      importBatchId: null,
      ledgerId: null,
      categoryId: payload.categoryId,
      label: payload.label.trim(),
      pattern: payload.pattern?.trim() ?? null,
      matchType: payload.matchType ?? 'regex',
      matchField: payload.matchField ?? 'description',
      conditions: payload.conditions ?? undefined,
      priority: payload.priority ?? 100,
      isActive: payload.isActive ?? true,
      createdBy: payload.createdBy,
      lastMatchedAt: null,
    },
  });
};

export const updateRule = async (
  tx: Prisma.TransactionClient,
  userId: string,
  ruleId: string,
  payload: Partial<{
    label: string;
    pattern: string;
    matchType: RuleMatchType;
    matchField: RuleMatchField;
    categoryId: string;
    priority: number;
    isActive: boolean;
    conditions?: RuleCondition[];
  }>,
): Promise<CategorizationRule> => {
  return tx.categorizationRule.update({
    where: {
      id: ruleId,
      userId,
    },
    data: {
      ...(payload.label !== undefined ? { label: payload.label.trim() } : {}),
      ...(payload.pattern !== undefined ? { pattern: payload.pattern.trim() } : {}),
      ...(payload.matchType ? { matchType: payload.matchType } : {}),
      ...(payload.matchField ? { matchField: payload.matchField } : {}),
      ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
      ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
      ...(payload.conditions !== undefined ? { conditions: payload.conditions ?? undefined } : {}),
    },
  });
};

export const deleteRule = async (
  tx: Prisma.TransactionClient,
  userId: string,
  ruleId: string,
): Promise<void> => {
  await tx.categorizationRule.delete({
    where: {
      id: ruleId,
      userId,
    },
  });
};
