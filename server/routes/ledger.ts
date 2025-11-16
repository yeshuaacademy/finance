import { Request, Response } from 'express';
import { prisma } from '../prismaClient';

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? 'demo-user';

export const getLedger = async (req: Request, res: Response) => {
  const userId = req.header('x-user-id') ?? DEFAULT_USER_ID;

  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      include: {
        category: true,
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

    const accountIds = Array.from(
      new Set(transactions.map((tx) => tx.accountId).filter((value): value is string => Boolean(value))),
    );

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

    const openingsByAccount = openingBalances.reduce<Record<string, typeof openingBalances>>((acc, item) => {
      if (!acc[item.accountId]) {
        acc[item.accountId] = [];
      }
      acc[item.accountId].push(item);
      return acc;
    }, {});

    const transactionsByAccount = new Map<string | null, typeof transactions>();
    transactions.forEach((tx) => {
      const key = tx.accountId ?? null;
      const list = transactionsByAccount.get(key) ?? [];
      list.push(tx);
      transactionsByAccount.set(key, list);
    });

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
      let suggestionConfidence: string | null = null;
      let suggestedMainCategoryName: string | null = null;
      let suggestedSubCategoryName: string | null = null;
      let rawMainCategoryName: string | null = null;
      let rawSubCategoryName: string | null = null;

      const raw = tx.rawRow as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const rawRecord = raw as Record<string, unknown>;
        if (typeof rawRecord.mainCategoryName === 'string') {
          rawMainCategoryName = rawRecord.mainCategoryName;
        }
        if (typeof rawRecord.categoryName === 'string') {
          rawSubCategoryName = rawRecord.categoryName;
        }
        if ('suggestion' in rawRecord) {
          const suggestion = rawRecord.suggestion as Record<string, unknown> | undefined;
          if (suggestion && typeof suggestion === 'object') {
            if (suggestion.confidence != null) {
              suggestionConfidence = String(suggestion.confidence);
            }
            if (typeof suggestion.mainCategoryName === 'string') {
              suggestedMainCategoryName = suggestion.mainCategoryName;
            }
            if (typeof suggestion.categoryName === 'string') {
              suggestedSubCategoryName = suggestion.categoryName;
            }
          }
        }
      }

      const amount = Number(tx.amountMinor) / 100;
      const signedAmount = tx.direction === 'debit' ? -Math.abs(amount) : Math.abs(amount);

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
        ledgerMonth: tx.ledger?.month ?? null,
        ledgerYear: tx.ledger?.year ?? null,
        createdAt: tx.createdAt,
        runningBalanceMinor: runningBalanceById.get(tx.id)?.toString() ?? null,
        runningBalance: runningBalanceById.has(tx.id)
          ? Number(runningBalanceById.get(tx.id)) / 100
          : null,
        classificationSource: tx.classificationSource,
        classificationRuleId: tx.classificationRuleId,
        classificationRuleLabel: tx.classificationRule?.label ?? null,
        ledgerLockedAt: tx.ledger?.lockedAt ?? null,
        suggestionConfidence,
        suggestedMainCategoryName: suggestedMainCategoryName ?? rawMainCategoryName,
        suggestedSubCategoryName: suggestedSubCategoryName ?? rawSubCategoryName ?? tx.category?.name ?? null,
        rawMainCategoryName,
        rawCategoryName: rawSubCategoryName,
      };
    });

    const approvedTransactions = transactions.filter((tx) => tx.classificationSource === 'manual');
    const reviewCount = transactions.filter((tx) => tx.classificationSource !== 'manual').length;
    const autoCategorized = transactions.filter(
      (tx) => tx.classificationSource === 'history' || tx.classificationSource === 'rule',
    ).length;
    const totalAmount = approvedTransactions.reduce((acc, tx) => {
      const base = Number(tx.amountMinor) / 100;
      const signed = tx.direction === 'debit' ? -Math.abs(base) : Math.abs(base);
      return acc + signed;
    }, 0);

    return res.json({
      transactions: payload,
      summary: {
        total: approvedTransactions.length,
        reviewCount,
        autoCategorized,
        totalAmount,
      },
      ledgers: ledgerSnapshots.map((ledger) => ({
        id: ledger.id,
        month: ledger.month,
        year: ledger.year,
        lockedAt: ledger.lockedAt ? ledger.lockedAt.toISOString() : null,
        lockedBy: ledger.lockedBy,
        lockNote: ledger.lockNote ?? null,
      })),
    });
  } catch (error) {
    console.error('Ledger fetch failed', error);
    return res.status(500).json({ error: 'Failed to load ledger.' });
  }
};
