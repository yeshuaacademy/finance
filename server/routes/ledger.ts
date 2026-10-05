import { Request, Response } from 'express';
import { prisma } from '../prismaClient';
import { requireAuthenticatedRequest } from '../auth/requestContext';


export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readLedgerRawValue = (raw: Record<string, unknown>, key: string): string | null => {
  const direct = raw[key];
  if (typeof direct === 'string') {
    return direct;
  }
  const columns = raw.columns;
  if (isPlainObject(columns) && typeof columns[key] === 'string') {
    return columns[key] as string;
  }
  return null;
};

export const extractNotificationDetail = (raw: Record<string, unknown> | null): string | null => {
  if (!raw) return null;
  const value =
    readLedgerRawValue(raw, 'Notifications') ??
    readLedgerRawValue(raw, 'Notification') ??
    readLedgerRawValue(raw, 'notifications');
  if (!value) return null;
  const cleaned = value.trim().replace(/^Name:\s*/i, '');
  return cleaned.length ? cleaned : null;
};

export const extractCounterpartyAccount = (raw: Record<string, unknown> | null): string | null => {
  if (!raw) return null;
  const value = readLedgerRawValue(raw, 'Counterparty') ?? readLedgerRawValue(raw, 'counterparty');
  return value?.trim() ? value.trim() : null;
};

export const extractLedgerSuggestionMetadata = (raw: Record<string, unknown> | null) => {
  const rawMainCategoryName = raw && typeof raw.mainCategoryName === 'string' ? raw.mainCategoryName : null;
  const rawSubCategoryName = raw && typeof raw.categoryName === 'string' ? raw.categoryName : null;
  const suggestion = raw && isPlainObject(raw.suggestion) ? raw.suggestion : null;

  return {
    suggestionConfidence: suggestion?.confidence != null ? String(suggestion.confidence) : null,
    suggestedMainCategoryName: typeof suggestion?.mainCategoryName === 'string' ? suggestion.mainCategoryName : null,
    suggestedSubCategoryName: typeof suggestion?.categoryName === 'string' ? suggestion.categoryName : null,
    rawMainCategoryName,
    rawSubCategoryName,
  };
};

export type LedgerSnapshotResponseInput = {
  id: string;
  month: number;
  year: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockNote: string | null;
};

export const serializeLedgerSnapshot = (ledger: LedgerSnapshotResponseInput) => ({
  id: ledger.id,
  month: ledger.month,
  year: ledger.year,
  lockedAt: ledger.lockedAt ? ledger.lockedAt.toISOString() : null,
  lockedBy: ledger.lockedBy,
  lockNote: ledger.lockNote ?? null,
});

export type LedgerSummaryTransactionInput = {
  amountMinor: bigint | number;
  direction: string;
  categoryId: string | null;
  classificationSource: string | null;
};

export const getSignedLedgerAmount = (amountMinor: bigint | number, direction: string): number => {
  const amount = Number(amountMinor) / 100;
  return direction === 'debit' ? -Math.abs(amount) : Math.abs(amount);
};

export const buildLedgerSummary = (transactions: LedgerSummaryTransactionInput[]) => ({
  total: transactions.length,
  reviewCount: transactions.filter(
    (tx) => !tx.categoryId || tx.classificationSource === 'none' || tx.classificationSource === 'import',
  ).length,
  autoCategorized: transactions.filter(
    (tx) => tx.classificationSource === 'history' || tx.classificationSource === 'rule',
  ).length,
  totalAmount: transactions.reduce(
    (acc, tx) => acc + getSignedLedgerAmount(tx.amountMinor, tx.direction),
    0,
  ),
});

export type LedgerAccountTransactionInput = {
  accountId: string | null;
};

export type LedgerRunningBalanceTransactionInput = LedgerAccountTransactionInput & {
  id: string;
  date: Date | string;
  createdAt: Date;
  amountMinor: bigint;
};

export type LedgerOpeningBalanceInput = {
  accountId: string;
  effectiveDate: Date;
  amountMinor: bigint;
};

export const getLedgerAccountIds = (transactions: LedgerAccountTransactionInput[]): string[] =>
  Array.from(new Set(transactions.map((tx) => tx.accountId).filter((value): value is string => Boolean(value))));

export const formatRunningBalanceMinor = (value: bigint | undefined): string | null =>
  value?.toString() ?? null;

export const formatRunningBalanceAmount = (value: bigint | undefined): number | null =>
  value == null ? null : Number(value) / 100;

export const groupLedgerTransactionsByAccount = <T extends { accountId: string | null }>(transactions: T[]) => {
  const transactionsByAccount = new Map<string | null, T[]>();
  transactions.forEach((tx) => {
    const key = tx.accountId ?? null;
    const list = transactionsByAccount.get(key) ?? [];
    list.push(tx);
    transactionsByAccount.set(key, list);
  });
  return transactionsByAccount;
};

export const groupOpeningBalancesByAccount = <T extends { accountId: string }>(openingBalances: T[]) =>
  openingBalances.reduce<Record<string, T[]>>((acc, item) => {
    if (!acc[item.accountId]) {
      acc[item.accountId] = [];
    }
    acc[item.accountId].push(item);
    return acc;
  }, {});

export const buildRunningBalanceMap = (
  transactions: LedgerRunningBalanceTransactionInput[],
  openingBalances: LedgerOpeningBalanceInput[],
): Map<string, bigint> => {
  const openingsByAccount = groupOpeningBalancesByAccount(openingBalances);
  const transactionsByAccount = groupLedgerTransactionsByAccount(transactions);
  const runningBalanceById = new Map<string, bigint>();

  transactionsByAccount.forEach((list, accountId) => {
    const sorted = [...list].sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const openings = accountId ? openingsByAccount[accountId] ?? [] : [];
    let openingIndex = 0;
    let currentBalance: bigint | null = null;

    sorted.forEach((tx) => {
      const txDate = new Date(tx.date);
      while (
        openings[openingIndex] &&
        openings[openingIndex]!.effectiveDate.getTime() <= txDate.getTime()
      ) {
        currentBalance = openings[openingIndex]!.amountMinor;
        openingIndex += 1;
      }

      if (currentBalance === null) {
        currentBalance = 0n;
      }

      currentBalance += tx.amountMinor;
      runningBalanceById.set(tx.id, currentBalance);
    });
  });

  return runningBalanceById;
};

export const getLedger = async (req: Request, res: Response) => {
  const actor = await requireAuthenticatedRequest(req, res);
  if (!actor) return;
  const { userId } = actor;

  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      include: {
        category: true,
        project: {
          select: { id: true, code: true, name: true },
        },
        transactionType: {
          select: { id: true, literalName: true },
        },
        transactionBooking: {
          select: {
            projectId: true,
            transactionTypeId: true,
            literalProjectLabel: true,
            literalTypeLabel: true,
            project: { select: { code: true, name: true } },
            transactionType: { select: { literalName: true } },
          },
        },
        ledger: true,
        account: true,
        classificationRule: {
          select: {
            id: true,
            label: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    const accountIds = getLedgerAccountIds(transactions);

    const openingBalances = accountIds.length
      ? await prisma.openingBalance.findMany({
          where: {
            accountId: {
              in: accountIds,
            },
          },
          orderBy: {
            effectiveDate: 'asc',
          },
        })
      : [];

    const runningBalanceById = buildRunningBalanceMap(transactions, openingBalances);

    const ledgerSnapshots = await prisma.ledger.findMany({
      where: { userId },
      select: {
        id: true,
        month: true,
        year: true,
        lockedAt: true,
        lockedBy: true,
        lockNote: true,
      },
    });

    const payload = transactions.map((tx) => {
      const rawValue = tx.rawRow as unknown;
      const rawRecord = isPlainObject(rawValue) ? rawValue : null;
      const {
        suggestionConfidence,
        suggestedMainCategoryName,
        suggestedSubCategoryName,
        rawMainCategoryName,
        rawSubCategoryName,
      } = extractLedgerSuggestionMetadata(rawRecord);

      const notificationDetail = extractNotificationDetail(rawRecord) ?? tx.reference ?? null;
      const counterpartyAccount = tx.counterparty ?? extractCounterpartyAccount(rawRecord) ?? null;

      const signedAmount = getSignedLedgerAmount(tx.amountMinor, tx.direction);

      return {
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: signedAmount,
        amountMinor: tx.amountMinor.toString(),
        currency: tx.currency,
        direction: tx.direction,
        source: tx.source,
        counterparty: tx.counterparty,
        reference: tx.reference,
        accountLabel: tx.account?.name ?? null,
        accountIdentifier: tx.account?.identifier ?? null,
        sourceFile: tx.sourceFile,
        categoryId: tx.categoryId,
        categoryName: tx.category?.name ?? null,
        clientId: tx.transactionBooking?.projectId ?? tx.projectId ?? null,
        clientCode: tx.transactionBooking?.project?.code ?? tx.project?.code ?? null,
        clientName: tx.transactionBooking?.literalProjectLabel
          ?? tx.transactionBooking?.project?.name
          ?? tx.project?.name
          ?? null,
        transactionTypeId: tx.transactionBooking?.transactionTypeId ?? tx.transactionTypeId ?? null,
        transactionTypeName: tx.transactionBooking?.literalTypeLabel
          ?? tx.transactionBooking?.transactionType?.literalName
          ?? tx.transactionType?.literalName
          ?? null,
        ledgerMonth: tx.ledger?.month ?? null,
        ledgerYear: tx.ledger?.year ?? null,
        createdAt: tx.createdAt,
        runningBalanceMinor: formatRunningBalanceMinor(runningBalanceById.get(tx.id)),
        runningBalance: formatRunningBalanceAmount(runningBalanceById.get(tx.id)),
        classificationSource: tx.classificationSource,
        classificationRuleId: tx.classificationRuleId,
        classificationRuleLabel: tx.classificationRule?.label ?? null,
        ledgerLockedAt: tx.ledger?.lockedAt ?? null,
        suggestionConfidence,
        suggestedMainCategoryName: suggestedMainCategoryName ?? rawMainCategoryName,
        suggestedSubCategoryName: suggestedSubCategoryName ?? rawSubCategoryName ?? tx.category?.name ?? null,
        rawMainCategoryName,
        rawCategoryName: rawSubCategoryName,
        notificationDetail,
        counterpartyAccount,
      };
    });

    return res.json({
      transactions: payload,
      summary: buildLedgerSummary(transactions),
      ledgers: ledgerSnapshots.map(serializeLedgerSnapshot),
    });
  } catch (error) {
    console.error('Ledger fetch failed', error);
    return res.status(500).json({ error: 'Het grootboek kon niet worden geladen.' });
  }
};
