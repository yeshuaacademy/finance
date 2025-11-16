'use client';

import Link from 'next/link';
import { Fragment, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { UploadCsvButton } from '@/components/ledger/UploadCsvButton';
import { ReconciliationCard } from '@/components/ledger/ReconciliationCard';
import {
  LedgerTable,
  DEFAULT_LEDGER_COLUMN_VISIBILITY,
  LedgerColumnVisibility,
} from '@/components/ledger/LedgerTable';
import { useLedger } from '@/context/ledger-context';
import type { Category, CategoryTree, LedgerTransaction } from '@/context/ledger-context';
import { CalendarDays, Download, Settings, SlidersHorizontal } from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/helpers/utils';
import { DEFAULT_LOCALE } from '@/constants/intl';

const COLORS = ['#6366F1', '#22D3EE', '#F472B6', '#FBBF24', '#34D399', '#F97316', '#A855F7', '#60A5FA'];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const euro = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const monthNameFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long' });
const displayDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  name: monthNameFormatter.format(new Date(Date.UTC(2020, index, 1))),
}));
const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;
type AccountFilterKey = 'all' | 'yeshua' | 'vila' | 'savings';

const ACCOUNT_FILTER_CONFIG: Record<
  AccountFilterKey,
  { label: string; matchLabels?: string[] }
> = {
  all: { label: 'All accounts' },
  yeshua: { label: 'Yeshua Academy', matchLabels: ['Yeshua Academy'] },
  vila: { label: 'Vila Solidária', matchLabels: ['Vila Solidária'] },
  savings: {
    label: 'Yeshua Academy Savings',
    matchLabels: ['Yeshua Academy Savings'],
  },
};

const ACCOUNT_FILTER_OPTIONS: Array<{ key: AccountFilterKey; label: string }> = [
  { key: 'all', label: ACCOUNT_FILTER_CONFIG.all.label },
  { key: 'yeshua', label: ACCOUNT_FILTER_CONFIG.yeshua.label },
  { key: 'vila', label: ACCOUNT_FILTER_CONFIG.vila.label },
  { key: 'savings', label: ACCOUNT_FILTER_CONFIG.savings.label },
];

const ACCOUNT_COLOR_MAP: Record<AccountFilterKey, string> = {
  all: '#6366F1',
  yeshua: '#6366F1',
  vila: '#F97316',
  savings: '#22D3EE',
};

type AccountBreakdownEntry = {
  key: AccountFilterKey;
  label: string;
  income: number;
  expenses: number;
  net: number;
  count: number;
};

const getTransactionDirection = (
  tx: Pick<LedgerTransaction, 'direction' | 'amount'>,
): 'debit' | 'credit' => {
  const raw = (tx.direction ?? '').toString().trim().toLowerCase();
  const debitTokens = ['debit', 'db', 'd', 'af', 'withdrawal', 'out', 'expense'];
  const creditTokens = ['credit', 'cr', 'c', 'bij', 'deposit', 'in', 'income'];

  if (debitTokens.some((token) => raw.startsWith(token))) {
    return 'debit';
  }
  if (creditTokens.some((token) => raw.startsWith(token))) {
    return 'credit';
  }
  return tx.amount < 0 ? 'debit' : 'credit';
};

const isDebitTransaction = (tx: Pick<LedgerTransaction, 'direction' | 'amount'>) =>
  getTransactionDirection(tx) === 'debit';

const getAbsoluteAmount = (tx: Pick<LedgerTransaction, 'amount'>) => Math.abs(tx.amount);

const COLUMN_STORAGE_KEY = 'ledger-column-visibility-v1';
const COLUMN_DEFINITIONS: Array<{ key: keyof LedgerColumnVisibility; label: string }> = [
  { key: 'date', label: 'Date' },
  { key: 'account', label: 'Account' },
  { key: 'description', label: 'Payee' },
  { key: 'amount', label: 'Amount' },
  { key: 'category', label: 'Category' },
  { key: 'balance', label: 'Running balance' },
];

type BreakdownEntry = {
  label: string;
  value: number;
  percent: number;
  color: string;
};

type LineDatum = {
  label: string;
  current: number;
  previous: number;
};

type CashFlowDatum = {
  label: string;
  income: number;
  expenses: number;
  net: number;
};

type PlannedSummary = {
  label: string;
  planned: number;
  actual: number;
  delta: number;
  positive: boolean;
};

type SummaryValues = {
  total: number;
  reviewCount: number;
  autoCategorized: number;
  totalAmount: number;
};

type CategoryAggregate = {
  mainId: string;
  mainName: string;
  totalIncome: number;
  totalExpenses: number;
  children: Array<{
    categoryId: string;
    categoryName: string;
    totalIncome: number;
    totalExpenses: number;
  }>;
};

const REVIEW_MAIN_ID = 'cat-review';
const REVIEW_SUB_ID = 'sub-review-needs-category';

export default function LedgerPage() {
  return (
    <Suspense fallback={<LedgerPageSkeleton />}>
      <LedgerPageContent />
    </Suspense>
  );
}

function LedgerPageSkeleton() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#050B18] text-white/60">
      Loading ledger…
    </div>
  );
}

function LedgerPageContent() {
  const { transactions, summary, categoryTree } = useLedger();
  const approvedTransactions = useMemo(
    () => transactions.filter((tx) => tx.classificationSource === 'manual'),
    [transactions],
  );
  const searchParams = useSearchParams();
  const view = (searchParams?.get('view') ?? 'dashboard') as 'dashboard' | 'transactions' | 'cashflow' | 'overview';

  const dashboardBreakdown = useMemo(() => buildSpendingBreakdown(approvedTransactions), [approvedTransactions]);
  const dashboardLines = useMemo(() => buildLineData(approvedTransactions), [approvedTransactions]);
  const dashboardCashFlow = useMemo(() => buildCashFlowData(approvedTransactions), [approvedTransactions]);
  const dashboardPlanned = useMemo(() => buildPlannedSummary(approvedTransactions), [approvedTransactions]);

  const { title, subtitle, actions } = useMemo(() => {
    switch (view) {
      case 'overview':
        return {
          title: 'Monthly Overview',
          subtitle: 'Review income and spending by category for any month or custom range.',
          actions: (
            <div className="flex items-center gap-3">
              <button className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                <Download className="h-4 w-4" /> Export
              </button>
            </div>
          ),
        };
      case 'transactions':
        return {
          title: 'Transactions',
          subtitle: 'Browse, filter, and export every line in your ledger.',
          actions: (
            <div className="flex items-center gap-3">
              <button className="inline-flex items-center gap-2 rounded-xl border border-[#2970FF] bg-[#2970FF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1f5de0]">
                <Download className="h-4 w-4" /> Export
              </button>
            </div>
          ),
        };
      case 'cashflow':
        return {
          title: 'Cash Flow',
          subtitle: 'Visualise net income trends across months to stay ahead.',
          actions: (
            <div className="flex items-center gap-3">
              <button className="inline-flex items-center gap-2 rounded-xl border border-[#2970FF] bg-[#2970FF] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1f5de0]">
                <Download className="h-4 w-4" /> Export
              </button>
            </div>
          ),
        };
      default:
        return {
          title: 'Performance Summary',
          subtitle: 'Visualize how your ledger is performing at a glance.',
          actions: (
            <div className="flex items-center gap-3">
              <button className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                <Settings className="h-4 w-4" /> Customize
              </button>
              <button className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
                <Download className="h-4 w-4" /> Export
              </button>
            </div>
          ),
        };
    }
  }, [view]);

  const content = useMemo(() => {
    if (view === 'transactions') {
      return <TransactionsView transactions={transactions} categoryTree={categoryTree} />;
    }
    if (view === 'cashflow') {
      return <CashFlowView cashflow={dashboardCashFlow} />;
    }
    if (view === 'overview') {
      return <MonthlyOverviewView transactions={approvedTransactions} categoryTree={categoryTree} />;
    }
    return (
      <DashboardView
        summary={summary}
        spendingBreakdown={dashboardBreakdown}
        comparison={dashboardLines}
        cashflow={dashboardCashFlow}
        planned={dashboardPlanned}
      />
    );
  }, [
    view,
    transactions,
    categoryTree,
    summary,
    dashboardBreakdown,
    dashboardLines,
    dashboardCashFlow,
    dashboardPlanned,
  ]);

  return (
    <DashboardShell title={title} subtitle={subtitle} actions={actions}>
      {content}
    </DashboardShell>
  );
}

function DashboardView({
  summary,
  spendingBreakdown,
  comparison,
  cashflow,
  planned,
}: {
  summary: SummaryValues;
  spendingBreakdown: BreakdownEntry[];
  comparison: LineDatum[];
  cashflow: CashFlowDatum[];
  planned: PlannedSummary[];
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.5fr,2fr]">
        <SummaryCard title="Spending Breakdown" subtitle="Where your money goes">
          <SpendingBreakdownCard data={spendingBreakdown} />
        </SummaryCard>
        <SummaryCard
          title="Spending Comparison"
          subtitle="Track this period against the previous"
          action={
            <button className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
              This Month vs Last Month <CalendarDays className="h-3.5 w-3.5" />
            </button>
          }
        >
          <SpendingComparisonChart data={comparison} />
        </SummaryCard>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <SummaryCard title="Planned Income & Expenses" subtitle="Compare planned vs actual">
          <PlannedIncomeExpensesCard data={planned} />
        </SummaryCard>
        <SummaryCard title="Cash Flow" subtitle="Net income across the last six months">
          <CashFlowChart data={cashflow} />
        </SummaryCard>
      </section>
    </div>
  );
}

function MonthlyOverviewView({
  transactions,
  categoryTree,
}: {
  transactions: LedgerTransaction[];
  categoryTree: CategoryTree;
}) {
  const latestDate = useMemo(() => {
    let latest: number | null = null;
    transactions.forEach((tx) => {
      const time = new Date(tx.date).getTime();
      if (Number.isNaN(time)) return;
      if (latest === null || time > latest) {
        latest = time;
      }
    });
    return latest ? new Date(latest) : null;
  }, [transactions]);

  const defaultMonth = latestDate ? latestDate.getUTCMonth() + 1 : new Date().getUTCMonth() + 1;
  const defaultYear = latestDate ? latestDate.getUTCFullYear() : new Date().getUTCFullYear();

  const defaultRange = useMemo(() => {
    const end = latestDate ? new Date(latestDate) : new Date();
    const start = new Date(end.getTime() - 29 * MILLISECONDS_IN_DAY);
    return {
      start: formatDateInput(start),
      end: formatDateInput(end),
    };
  }, [latestDate]);

  const [mode, setMode] = useState<'month' | 'custom'>('month');
  const [selectedMonth, setSelectedMonth] = useState<number>(defaultMonth);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [customFrom, setCustomFrom] = useState<string>(defaultRange.start);
  const [customTo, setCustomTo] = useState<string>(defaultRange.end);
  const [accountFilter, setAccountFilter] = useState<AccountFilterKey>('all');

  useEffect(() => {
    setSelectedMonth(defaultMonth);
    setSelectedYear(defaultYear);
  }, [defaultMonth, defaultYear]);

  useEffect(() => {
    setCustomFrom(defaultRange.start);
    setCustomTo(defaultRange.end);
  }, [defaultRange.start, defaultRange.end]);

  const availableYears = useMemo(() => {
    const unique = new Set<number>();
    transactions.forEach((tx) => {
      if (Number.isFinite(tx.ledgerYear)) {
        unique.add(tx.ledgerYear);
      }
    });
    if (unique.size === 0) {
      unique.add(defaultYear);
    }
    return Array.from(unique).sort((a, b) => b - a);
  }, [transactions, defaultYear]);

  const periodTransactions = useMemo(() => {
    if (!transactions.length) return [];

    let startTime = Number.NEGATIVE_INFINITY;
    let endTime = Number.POSITIVE_INFINITY;

    if (mode === 'month') {
      startTime = Date.UTC(selectedYear, selectedMonth - 1, 1);
      endTime = Date.UTC(selectedYear, selectedMonth, 0, 23, 59, 59, 999);
    } else {
      if (customFrom) {
        const parsed = Date.parse(`${customFrom}T00:00:00Z`);
        if (!Number.isNaN(parsed)) {
          startTime = parsed;
        }
      }
      if (customTo) {
        const parsed = Date.parse(`${customTo}T23:59:59Z`);
        if (!Number.isNaN(parsed)) {
          endTime = parsed;
        }
      }
    }

    return transactions.filter((tx) => {
      const time = new Date(tx.date).getTime();
      if (Number.isNaN(time)) return false;
      return time >= startTime && time <= endTime;
    });
  }, [transactions, mode, selectedMonth, selectedYear, customFrom, customTo]);

  const filteredTransactions = useMemo(() => {
    if (accountFilter === 'all') {
      return periodTransactions;
    }
    const matchLabels = ACCOUNT_FILTER_CONFIG[accountFilter].matchLabels ?? [];
    if (matchLabels.length === 0) {
      return periodTransactions;
    }
    if (accountFilter === 'yeshua') {
      const otherLabels = new Set([
        ...(ACCOUNT_FILTER_CONFIG.vila.matchLabels ?? []),
        ...(ACCOUNT_FILTER_CONFIG.savings.matchLabels ?? []),
      ]);
      return periodTransactions.filter((tx) => {
        const label = tx.accountLabel ?? '';
        if (matchLabels.includes(label)) {
          return true;
        }
        if (!label) {
          return true;
        }
        return !otherLabels.has(label);
      });
    }
    return periodTransactions.filter((tx) => matchLabels.includes(tx.accountLabel ?? ''));
  }, [periodTransactions, accountFilter]);

  const totals = useMemo(() => {
    let income = 0;
    let expenses = 0;
    filteredTransactions.forEach((tx) => {
      if (isDebitTransaction(tx)) {
        expenses += getAbsoluteAmount(tx);
      } else {
        income += getAbsoluteAmount(tx);
      }
    });
    return {
      income,
      expenses,
      net: income - expenses,
      count: filteredTransactions.length,
    };
  }, [filteredTransactions]);

  const aggregates = useMemo(
    () => buildCategoryAggregates(filteredTransactions, categoryTree),
    [filteredTransactions, categoryTree],
  );

  const periodLabel = useMemo(() => {
    if (mode === 'month') {
      const date = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1));
      return `${monthNameFormatter.format(date)} ${selectedYear}`;
    }
    const hasStart = Boolean(customFrom);
    const hasEnd = Boolean(customTo);
    if (hasStart && hasEnd) {
      return `${formatDisplayDate(customFrom)} – ${formatDisplayDate(customTo)}`;
    }
    if (hasStart) {
      return `From ${formatDisplayDate(customFrom)}`;
    }
    if (hasEnd) {
      return `Until ${formatDisplayDate(customTo)}`;
    }
    return 'All transactions';
  }, [mode, selectedMonth, selectedYear, customFrom, customTo]);

  const showAccountBreakdown = accountFilter === 'all';

  const accountBreakdown = useMemo(() => {
    const baseOrder: AccountFilterKey[] = ['yeshua', 'vila', 'savings'];
    const baseMap = new Map<AccountFilterKey, AccountBreakdownEntry>();

    baseOrder.forEach((key) => {
      baseMap.set(key, {
        key,
        label: ACCOUNT_FILTER_CONFIG[key].label,
        income: 0,
        expenses: 0,
        net: 0,
        count: 0,
      });
    });

    const identifyAccount = (label: string | null | undefined): AccountFilterKey => {
      if (!label) return 'yeshua';
      for (const key of baseOrder) {
        const matches = ACCOUNT_FILTER_CONFIG[key].matchLabels ?? [];
        if (matches.includes(label)) {
          return key;
        }
      }
      return 'yeshua';
    };

    periodTransactions.forEach((tx) => {
      const bucketKey = identifyAccount(tx.accountLabel);
      const bucket = baseMap.get(bucketKey);
      if (!bucket) return;
      if (isDebitTransaction(tx)) {
        const expense = getAbsoluteAmount(tx);
        bucket.expenses += expense;
        bucket.net -= expense;
      } else {
        const incomeValue = getAbsoluteAmount(tx);
        bucket.income += incomeValue;
        bucket.net += incomeValue;
      }
      bucket.count += 1;
    });

    return baseOrder
      .map((key) => baseMap.get(key)!)
      .filter((entry) => entry.count > 0 || entry.income > 0 || entry.expenses > 0);
  }, [periodTransactions]);

  const heroTotals = useMemo(() => {
    if (accountFilter === 'all') {
      return accountBreakdown.reduce(
        (acc, entry) => {
          acc.income += entry.income;
          acc.expenses += entry.expenses;
          acc.net += entry.net;
          acc.count += entry.count;
          return acc;
        },
        { income: 0, expenses: 0, net: 0, count: 0 },
      );
    }
    return totals;
  }, [accountFilter, totals, accountBreakdown]);

  const showCategoryBreakdown = accountFilter !== 'all';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/5 bg-[#060F1F]/60 p-6 shadow-inner shadow-black/30">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Accounts</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {ACCOUNT_FILTER_OPTIONS.map(({ key, label }) => {
                const selected = accountFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAccountFilter(key)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2970FF]/80',
                      selected
                        ? 'border-[#2970FF]/80 bg-[#2970FF]/90 text-white shadow-[0_12px_35px_-18px_rgba(41,112,255,0.85)]'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {accountFilter !== 'all' ? (
            <button
              type="button"
              onClick={() => setAccountFilter('all')}
              className="inline-flex w-full max-w-[160px] items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2970FF]/80 lg:w-auto"
            >
              Clear selection
            </button>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="View mode"
            value={mode}
            onChange={(value) => setMode(value as 'month' | 'custom')}
            options={[
              { id: 'month', name: 'Month' },
              { id: 'custom', name: 'Custom range' },
            ]}
          />
          {mode === 'month' ? (
            <>
              <FilterSelect
                label="Month"
                value={String(selectedMonth)}
                onChange={(value) => setSelectedMonth(Number(value))}
                options={MONTH_OPTIONS}
              />
              <FilterSelect
                label="Year"
                value={String(selectedYear)}
                onChange={(value) => setSelectedYear(Number(value))}
                options={availableYears.map((year) => ({ id: String(year), name: String(year) }))}
              />
            </>
          ) : (
            <>
              <DateInput label="From" value={customFrom} onChange={setCustomFrom} max={customTo || undefined} />
              <DateInput label="Until" value={customTo} onChange={setCustomTo} min={customFrom || undefined} />
            </>
          )}
        </div>
      </div>

      <SummaryCard title="Period Summary" subtitle={periodLabel}>
        <div className="space-y-6">
          <OverviewHeroTotals totals={heroTotals} />
          {showAccountBreakdown ? (
            <AccountBreakdownChart breakdown={accountBreakdown} />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewSummaryCard label="Transactions" value={heroTotals.count} tone="neutral" isCurrency={false} />
          </div>
          {!filteredTransactions.length ? (
            <p className="text-sm text-white/60">No transactions found for this period.</p>
          ) : null}
        </div>
      </SummaryCard>

      {showCategoryBreakdown ? (
        <SummaryCard
          title="Category Breakdown"
          subtitle="Income and expenses grouped by main and sub category."
        >
          <MonthlyTotalsTable aggregates={aggregates} totals={totals} />
        </SummaryCard>
      ) : null}
    </div>
  );
}

function OverviewHeroTotals({
  totals,
}: {
  totals: { income: number; expenses: number; net: number; count: number };
}) {
  const netTone: 'positive' | 'negative' | 'neutral' = totals.net > 0 ? 'positive' : totals.net < 0 ? 'negative' : 'neutral';
  const cards: Array<{
    key: string;
    label: string;
    value: string;
    tone: 'positive' | 'negative' | 'neutral';
    sublabel?: string;
  }> = [
    {
      key: 'income',
      label: 'Total Income',
      value: euro.format(totals.income),
      tone: 'positive',
    },
    {
      key: 'expenses',
      label: 'Total Expenses',
      value: euro.format(totals.expenses),
      tone: 'negative',
    },
    {
      key: 'net',
      label: 'Net Change',
      value: euro.format(totals.net),
      tone: netTone,
      sublabel: `${totals.count.toLocaleString(DEFAULT_LOCALE)} transactions`,
    },
  ];

  const toneText: Record<'positive' | 'negative' | 'neutral', string> = {
    positive: 'text-emerald-200',
    negative: 'text-rose-200',
    neutral: 'text-sky-200',
  };

  const toneGlow: Record<'positive' | 'negative' | 'neutral', string> = {
    positive: 'bg-emerald-400/35',
    negative: 'bg-rose-400/35',
    neutral: 'bg-sky-400/35',
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map(({ key, label, value, tone, sublabel }) => (
        <div
          key={key}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#070F1F]/85 p-6 shadow-[0_25px_80px_-60px_rgba(41,112,255,0.8)]"
        >
          <div
            className={cn(
              'pointer-events-none absolute -right-16 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full blur-3xl',
              toneGlow[tone],
            )}
            aria-hidden
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">{label}</p>
          <p className={cn('mt-4 text-4xl font-bold tracking-tight md:text-5xl', toneText[tone])}>{value}</p>
          {sublabel ? <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-white/50">{sublabel}</p> : null}
        </div>
      ))}
    </div>
  );
}

function AccountBreakdownChart({ breakdown }: { breakdown: AccountBreakdownEntry[] }) {
  const entries = breakdown;
  const hasActivity = entries.some((entry) => entry.income > 0 || entry.expenses > 0);

  const labelLookup = useMemo(() => {
    return entries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.key] = entry.label;
      return acc;
    }, {});
  }, [entries]);

  const chartData = useMemo(() => {
    const incomeRow: Record<string, number | string> = { name: 'Income' };
    const expenseRow: Record<string, number | string> = { name: 'Expenses' };

    entries.forEach((entry) => {
      incomeRow[entry.key] = entry.income;
      expenseRow[entry.key] = entry.expenses;
    });
    return [incomeRow, expenseRow];
  }, [entries]);

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#051025]/90">
      <div className="grid items-stretch gap-0 lg:grid-cols-[1.7fr,1fr]">
        <div className="flex flex-col">
          <div className="px-6 pt-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/50">Account Contribution</h3>
            <p className="mt-1 text-xs text-white/50">Share of total income and expenses in this period.</p>
          </div>
          <div className="flex-1 px-4 pb-6 pt-4 sm:px-6">
            {hasActivity ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  barSize={28}
                  margin={{ top: 12, right: 16, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.45)" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="rgba(255,255,255,0.35)"
                    tickFormatter={(value) => euro.format(value as number)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <RechartsTooltip
                    formatter={(value, name) => [euro.format(value as number), labelLookup[name as string] ?? name]}
                    labelFormatter={(label) => `${label}`}
                    contentStyle={{
                      background: '#0A162D',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                  {entries.map((entry) => (
                    <Bar
                      key={entry.key}
                      dataKey={entry.key}
                      name={entry.label}
                      stackId="total"
                      fill={ACCOUNT_COLOR_MAP[entry.key]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-white/40">
                No account activity for this period.
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col justify-between border-t border-white/10 bg-[#060F1F]/70 lg:border-t-0 lg:border-l">
          {entries.map((entry) => (
            <div key={entry.key} className="flex flex-col gap-3 px-6 py-5">
              <div className="flex items-center justify-between text-sm font-semibold text-white">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ACCOUNT_COLOR_MAP[entry.key] }}
                  />
                  {entry.label}
                </span>
                <span className="text-xs font-medium text-white/50">
                  {entry.count.toLocaleString(DEFAULT_LOCALE)} {entry.count === 1 ? 'transaction' : 'transactions'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs uppercase tracking-wide text-white/50">
                <div>
                  <p>Income</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-200">{euro.format(entry.income)}</p>
                </div>
                <div>
                  <p>Expenses</p>
                  <p className="mt-1 text-sm font-semibold text-rose-200">{euro.format(entry.expenses)}</p>
                </div>
                <div>
                  <p>Net</p>
                  <p
                    className={cn(
                      'mt-1 text-sm font-semibold',
                      entry.net >= 0 ? 'text-emerald-200' : 'text-rose-200',
                    )}
                  >
                    {euro.format(entry.net)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OverviewSummaryCard({
  label,
  value,
  tone,
  isCurrency = true,
}: {
  label: string;
  value: number;
  tone: 'positive' | 'negative' | 'neutral';
  isCurrency?: boolean;
}) {
  const toneClass =
    tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : 'text-white';
  const formattedValue = isCurrency ? euro.format(value) : value.toLocaleString(DEFAULT_LOCALE);

  return (
    <div className="rounded-xl border border-white/5 bg-[#09142A] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{formattedValue}</p>
    </div>
  );
}

function MonthlyTotalsTable({
  aggregates,
  totals,
}: {
  aggregates: CategoryAggregate[];
  totals: { income: number; expenses: number; net: number };
}) {
  if (!aggregates.length) {
    return <p className="text-sm text-white/60">No categorized transactions to display for this period.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#050B18]/70">
      <table className="min-w-full divide-y divide-white/10 text-sm">
        <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Category</th>
            <th className="px-4 py-3 text-right font-semibold">Income</th>
            <th className="px-4 py-3 text-right font-semibold">Expenses</th>
            <th className="px-4 py-3 text-right font-semibold">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-white/80">
          {aggregates.map((main) => {
            const net = main.totalIncome - main.totalExpenses;
            return (
              <Fragment key={main.mainId}>
                <tr className="bg-white/5 text-white">
                  <td className="px-4 py-3 text-sm font-semibold">{main.mainName}</td>
                  <td className="px-4 py-3 text-right text-emerald-300">{euro.format(main.totalIncome)}</td>
                  <td className="px-4 py-3 text-right text-rose-300">{euro.format(main.totalExpenses)}</td>
                  <td
                    className={`px-4 py-3 text-right ${
                      net >= 0 ? 'text-emerald-200' : 'text-rose-200'
                    }`}
                  >
                    {euro.format(net)}
                  </td>
                </tr>
                {main.children.map((child) => {
                  const childNet = child.totalIncome - child.totalExpenses;
                  return (
                    <tr key={`${main.mainId}-${child.categoryId}`} className="text-white/80">
                      <td className="px-4 py-2 pl-8">{child.categoryName}</td>
                      <td className="px-4 py-2 text-right text-emerald-300">{euro.format(child.totalIncome)}</td>
                      <td className="px-4 py-2 text-right text-rose-300">{euro.format(child.totalExpenses)}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          childNet >= 0 ? 'text-emerald-200' : 'text-rose-200'
                        }`}
                      >
                        {euro.format(childNet)}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="bg-white/5 text-sm font-semibold text-white">
          <tr>
            <td className="px-4 py-3">Grand Total</td>
            <td className="px-4 py-3 text-right text-emerald-300">{euro.format(totals.income)}</td>
            <td className="px-4 py-3 text-right text-rose-300">{euro.format(totals.expenses)}</td>
            <td
              className={`px-4 py-3 text-right ${
                totals.net >= 0 ? 'text-emerald-200' : 'text-rose-200'
              }`}
            >
              {euro.format(totals.net)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TransactionsView({ transactions, categoryTree }: { transactions: LedgerTransaction[]; categoryTree: CategoryTree }) {
  const mainOptions = useMemo(() => [
    { id: 'all', name: 'All categories' },
    ...categoryTree.main.filter((cat) => cat.id !== REVIEW_MAIN_ID),
  ], [categoryTree.main]);

  const allSubOptions = useMemo(() => {
    return Object.entries(categoryTree.byParent)
      .filter(([parent]) => parent !== REVIEW_MAIN_ID)
      .flatMap(([, items]) => items.filter((item) => item.id !== REVIEW_SUB_ID));
  }, [categoryTree.byParent]);

  const latestDate = useMemo(() => {
    let latest: number | null = null;
    transactions.forEach((tx) => {
      const time = new Date(tx.date).getTime();
      if (Number.isNaN(time)) return;
      if (latest === null || time > latest) {
        latest = time;
      }
    });
    return latest ? new Date(latest) : null;
  }, [transactions]);

  const defaultMonth = latestDate ? latestDate.getUTCMonth() + 1 : new Date().getUTCMonth() + 1;
  const defaultYear = latestDate ? latestDate.getUTCFullYear() : new Date().getUTCFullYear();

  const defaultRange = useMemo(() => {
    const end = latestDate ? new Date(latestDate) : new Date();
    const start = new Date(end.getTime() - 29 * MILLISECONDS_IN_DAY);
    return {
      start: formatDateInput(start),
      end: formatDateInput(end),
    };
  }, [latestDate]);

  const [mainFilter, setMainFilter] = useState<string>('all');
  const [subFilter, setSubFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const [accountFilter, setAccountFilter] = useState<AccountFilterKey>('all');
  const [mode, setMode] = useState<'month' | 'custom'>('month');
  const [selectedMonth, setSelectedMonth] = useState<number>(defaultMonth);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [customFrom, setCustomFrom] = useState<string>(defaultRange.start);
  const [customTo, setCustomTo] = useState<string>(defaultRange.end);
  const [columnVisibility, setColumnVisibility] = useState<LedgerColumnVisibility>(
    DEFAULT_LEDGER_COLUMN_VISIBILITY,
  );
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const [reconciliationStatus, setReconciliationStatus] = useState<'balanced' | 'unreconciled' | 'unknown'>('unknown');

  const statusBadge = useMemo(() => {
    if (reconciliationStatus === 'balanced') {
      return {
        label: '✅ Reconciled',
        tone: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
      };
    }
    if (reconciliationStatus === 'unreconciled') {
      return {
        label: '⚠️ Mismatch',
        tone: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
      };
    }
    return {
      label: '🕒 Pending',
      tone: 'border-white/20 bg-white/10 text-white/70',
    };
  }, [reconciliationStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<LedgerColumnVisibility>;
      setColumnVisibility((prev) => ({
        ...prev,
        ...parsed,
      }));
    } catch (error) {
      console.warn('Failed to parse column preferences', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  useEffect(() => {
    setSelectedMonth(defaultMonth);
    setSelectedYear(defaultYear);
  }, [defaultMonth, defaultYear]);

  useEffect(() => {
    setCustomFrom(defaultRange.start);
    setCustomTo(defaultRange.end);
  }, [defaultRange.start, defaultRange.end]);

  useEffect(() => {
    if (!columnMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!columnMenuRef.current) return;
      if (!columnMenuRef.current.contains(event.target as Node)) {
        setColumnMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnMenuOpen]);

  const availableYears = useMemo(() => {
    const unique = new Set<number>();
    transactions.forEach((tx) => {
      if (Number.isFinite(tx.ledgerYear)) {
        unique.add(tx.ledgerYear);
      }
    });
    if (unique.size === 0) {
      unique.add(defaultYear);
    }
    return Array.from(unique).sort((a, b) => b - a);
  }, [transactions, defaultYear]);

  const periodTransactions = useMemo(() => {
    if (!transactions.length) return [];

    let startTime = Number.NEGATIVE_INFINITY;
    let endTime = Number.POSITIVE_INFINITY;

    if (mode === 'month') {
      startTime = Date.UTC(selectedYear, selectedMonth - 1, 1);
      endTime = Date.UTC(selectedYear, selectedMonth, 0, 23, 59, 59, 999);
    } else {
      if (customFrom) {
        const parsed = Date.parse(`${customFrom}T00:00:00Z`);
        if (!Number.isNaN(parsed)) {
          startTime = parsed;
        }
      }
      if (customTo) {
        const parsed = Date.parse(`${customTo}T23:59:59Z`);
        if (!Number.isNaN(parsed)) {
          endTime = parsed;
        }
      }
    }

    return transactions.filter((tx) => {
      const time = new Date(tx.date).getTime();
      if (Number.isNaN(time)) return false;
      return time >= startTime && time <= endTime;
    });
  }, [transactions, mode, selectedMonth, selectedYear, customFrom, customTo]);

  const availableSubOptions = useMemo(() => {
    if (mainFilter === 'all') {
      return allSubOptions;
    }
    return (categoryTree.byParent[mainFilter] ?? []).filter((item) => item.id !== REVIEW_SUB_ID);
  }, [mainFilter, categoryTree.byParent, allSubOptions]);

  const baseFilteredTransactions = useMemo(() => {
    return periodTransactions.filter((tx) => {
      const matchesMain = mainFilter === 'all' || tx.mainCategoryId === mainFilter;
      const matchesSub = subFilter === 'all' || tx.categoryId === subFilter;
      return matchesMain && matchesSub;
    });
  }, [periodTransactions, mainFilter, subFilter]);

  const accountFilteredTransactions = useMemo(() => {
    if (accountFilter === 'all') {
      return baseFilteredTransactions;
    }
    const matchLabels = ACCOUNT_FILTER_CONFIG[accountFilter].matchLabels ?? [];
    if (!matchLabels.length) {
      return baseFilteredTransactions;
    }
    return baseFilteredTransactions.filter((tx) => matchLabels.includes(tx.accountLabel ?? ''));
  }, [baseFilteredTransactions, accountFilter]);

  const visibleTransactions = accountFilteredTransactions;

  const totalPages = Math.max(1, Math.ceil(visibleTransactions.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [mainFilter, subFilter, pageSize, accountFilter, mode, selectedMonth, selectedYear, customFrom, customTo]);
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedTransactions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleTransactions.slice(start, start + pageSize);
  }, [visibleTransactions, page, pageSize]);

  const summary = useMemo(() => calculateSummary(visibleTransactions), [visibleTransactions]);

  const startIndex = visibleTransactions.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, visibleTransactions.length);
  const visibleColumnCount = useMemo(
    () => Object.values(columnVisibility).filter(Boolean).length,
    [columnVisibility],
  );

  const handleToggleColumn = (column: keyof LedgerColumnVisibility, value: boolean) => {
    setColumnVisibility((prev) => {
      if (!value && prev[column]) {
        const currentlyVisible = Object.values(prev).filter(Boolean).length;
        if (currentlyVisible <= 1) {
          toast.error('At least one column must remain visible');
          return prev;
        }
      }
      return {
        ...prev,
        [column]: value,
      };
    });
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-6 border-b border-white/5 bg-[#050B18]/95 px-6 py-4 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Accounts</span>
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_FILTER_OPTIONS.map(({ key, label }) => {
              const selected = accountFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAccountFilter(key)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2970FF]/80',
                    selected
                      ? 'border-[#2970FF]/80 bg-[#2970FF]/90 text-white shadow-[0_12px_35px_-18px_rgba(41,112,255,0.85)]'
                      : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span className="ml-auto text-xs font-semibold uppercase tracking-wide text-white/60">Status</span>
          <span className={cn('rounded-full border px-3 py-1 text-[11px] font-semibold', statusBadge.tone)}>
            {statusBadge.label}
          </span>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="View mode"
            value={mode}
            onChange={(value) => setMode(value as 'month' | 'custom')}
            options={[
              { id: 'month', name: 'Month' },
              { id: 'custom', name: 'Custom range' },
            ]}
          />
          {mode === 'month' ? (
            <>
              <FilterSelect
                label="Month"
                value={String(selectedMonth)}
                onChange={(value) => setSelectedMonth(Number(value))}
                options={MONTH_OPTIONS}
              />
              <FilterSelect
                label="Year"
                value={String(selectedYear)}
                onChange={(value) => setSelectedYear(Number(value))}
                options={availableYears.map((year) => ({ id: String(year), name: String(year) }))}
              />
            </>
          ) : (
            <>
              <DateInput label="From" value={customFrom} onChange={setCustomFrom} max={customTo || undefined} />
              <DateInput label="Until" value={customTo} onChange={setCustomTo} min={customFrom || undefined} />
            </>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Main category"
            value={mainFilter}
            onChange={(value) => {
              setMainFilter(value);
              setSubFilter('all');
            }}
            options={mainOptions}
          />
          <FilterSelect
            label="Sub category"
            value={subFilter}
            onChange={setSubFilter}
            options={[{ id: 'all', name: 'All sub categories' }, ...availableSubOptions]}
            disabled={availableSubOptions.length === 0}
          />
          <FilterSelect
            label="Rows per page"
            value={String(pageSize)}
            onChange={(value) => setPageSize(Number(value))}
            options={PAGE_SIZE_OPTIONS.map((size) => ({ id: String(size), name: `${size} rows` }))}
          />
          <div className="flex items-end">
            <button
              onClick={() => {
                setMainFilter('all');
                setSubFilter('all');
                setMode('month');
                setSelectedMonth(defaultMonth);
                setSelectedYear(defaultYear);
                setCustomFrom(defaultRange.start);
                setCustomTo(defaultRange.end);
                setAccountFilter('all');
              }}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>
      <ReconciliationCard onStatusChange={setReconciliationStatus} />

      <section className="rounded-2xl border border-white/5 bg-[#060F1F]/60 p-6 shadow-inner shadow-black/30">
        <header className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Transactions</h2>
            <p className="text-xs text-white/60">
              Showing {visibleTransactions.length === 0 ? 0 : `${startIndex}–${endIndex}`} of{' '}
              {visibleTransactions.length.toLocaleString(DEFAULT_LOCALE)} records
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={columnMenuRef}>
              <button
                type="button"
                onClick={() => setColumnMenuOpen((state) => !state)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
              >
                <SlidersHorizontal className="h-4 w-4 text-white/70" />
                Columns
              </button>
              {columnMenuOpen ? (
                <div className="absolute right-0 z-30 mt-2 w-60 rounded-2xl border border-white/10 bg-[#0A162D] p-4 shadow-lg">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-white/50">
                      Visible columns
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
                      onClick={() => setColumnVisibility({ ...DEFAULT_LEDGER_COLUMN_VISIBILITY })}
                    >
                      Reset
                    </button>
                  </div>
                  <ul className="space-y-2 text-sm text-white/80">
                    {COLUMN_DEFINITIONS.map(({ key, label }) => (
                      <li key={key} className="flex items-center justify-between gap-2">
                        <label htmlFor={`column-${key}`} className="text-xs font-medium text-white/70">
                          {label}
                        </label>
                        <Switch
                          id={`column-${key}`}
                          checked={columnVisibility[key]}
                          onCheckedChange={(checked) => handleToggleColumn(key, checked)}
                          disabled={columnVisibility[key] && visibleColumnCount <= 1}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            {accountFilter !== 'all' ? <UploadCsvButton /> : null}
            <Link
              href="/review"
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20"
            >
              Needs Review
              <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] text-amber-100">
                {summary.reviewCount}
              </span>
            </Link>
          </div>
        </header>
        <LedgerTable transactions={pagedTransactions} summary={summary} columnVisibility={columnVisibility} />
        <PaginationControls
          page={page}
          totalPages={totalPages}
          totalItems={visibleTransactions.length}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}

function CashFlowView({ cashflow }: { cashflow: CashFlowDatum[] }) {
  return (
    <div className="space-y-6">
      <SummaryCard title="Cash Flow" subtitle="Net income across the last six months">
        <CashFlowChart data={cashflow} />
      </SummaryCard>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
      {label}
      <input
        type="date"
        className="rounded-xl border border-white/10 bg-[#09142A] px-3 py-2 text-sm text-white focus:border-[#2970FF] focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={min}
        max={max}
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Category[] | { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
      {label}
      <select
        className="rounded-xl border border-white/10 bg-[#09142A] px-3 py-2 text-sm text-white focus:border-[#2970FF] focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id} className="text-black">
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PaginationControls({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-white/70">
      <div>
        Page {page} of {totalPages} • {totalItems.toLocaleString(DEFAULT_LOCALE)} transactions
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg border border-white/10 px-3 py-1 text-xs font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Previous
        </button>
        <button
          className="rounded-lg border border-white/10 px-3 py-1 text-xs font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function SummaryCard({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <article className="rounded-2xl border border-white/5 bg-[#060F1F]/60 p-6 shadow-inner shadow-black/30">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {subtitle ? <p className="text-xs text-white/60">{subtitle}</p> : null}
        </div>
        {action ?? null}
      </header>
      {children}
    </article>
  );
}

function SpendingBreakdownCard({ data }: { data: BreakdownEntry[] }) {
  if (!data.length) {
    return <p className="text-sm text-white/50">No expense data available.</p>;
  }

  const total = data.reduce((acc, entry) => acc + entry.value, 0);

  return (
    <div className="flex flex-col gap-8 md:flex-row md:items-center">
      <div className="mx-auto h-56 w-full max-w-xs md:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsPieChart>
            <RechartsTooltip
              contentStyle={{
                backgroundColor: '#060F1F',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '0.75rem',
              }}
              formatter={(value: unknown, _name, payload) => [
                euro.format(Number(value ?? 0)),
                (payload?.payload as BreakdownEntry | undefined)?.label ?? '',
              ]}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={3}
            >
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
            </Pie>
          </RechartsPieChart>
        </ResponsiveContainer>
        <div className="mt-4 text-center text-sm font-semibold text-white/70">
          Total spending {euro.format(total)}
        </div>
      </div>
      <ul className="flex-1 space-y-3 text-sm">
        {data.map((entry) => (
          <li key={entry.label} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-white/80">{entry.label}</span>
            </div>
            <div className="text-right text-white">
              <div className="text-sm font-semibold">{euro.format(entry.value)}</div>
              <div className="text-[11px] uppercase tracking-wide text-white/50">{entry.percent}%</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpendingComparisonChart({ data }: { data: LineDatum[] }) {
  if (!data.length) {
    return <p className="text-sm text-white/50">No activity recorded for this period.</p>;
  }

  return (
    <div className="flex h-64 w-full flex-col">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
          <XAxis dataKey="label" stroke="rgba(255,255,255,0.45)" tickLine={false} axisLine={false} />
          <YAxis
            stroke="rgba(255,255,255,0.45)"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => euro.format(Number(value ?? 0))}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: '#060F1F',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '0.75rem',
            }}
            formatter={(value: unknown, name) => [euro.format(Number(value ?? 0)), name as string]}
          />
          <Legend
            wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }}
            iconType="circle"
            verticalAlign="top"
            height={24}
          />
          <Line
            type="monotone"
            dataKey="previous"
            name="Previous period"
            stroke="#4D5A7C"
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 4"
          />
          <Line
            type="monotone"
            dataKey="current"
            name="Current period"
            stroke="#5B9CFF"
            strokeWidth={3}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CashFlowChart({ data }: { data: CashFlowDatum[] }) {
  if (!data.length) {
    return <p className="text-sm text-white/50">No cash flow data available.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 48 }} barCategoryGap={16}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
          <XAxis
            dataKey="label"
            stroke="rgba(255,255,255,0.45)"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.45)"
            tickLine={false}
            axisLine={false}
            width={88}
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => euro.format(Number(value ?? 0))}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: '#060F1F',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '0.75rem',
            }}
            formatter={(value: unknown, name) => [euro.format(Number(value ?? 0)), name as string]}
          />
          <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} iconType="circle" />
          <Bar dataKey="income" name="Income" fill="#5B9CFF" radius={[8, 8, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill="#FF8A65" radius={[8, 8, 0, 0]} />
          <Line type="monotone" dataKey="net" name="Net" stroke="#82AFFF" strokeWidth={3} dot={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PlannedIncomeExpensesCard({ data }: { data: PlannedSummary[] }) {
  return (
    <div className="space-y-4">
      {data.map((entry) => {
        const ratio = entry.planned === 0 ? 0 : Math.min((entry.actual / entry.planned) * 100, 100);
        const exceeded = entry.planned > 0 && entry.actual > entry.planned;
        return (
          <div key={entry.label} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs uppercase tracking-wide text-white/50">
              <span>{entry.label}</span>
              <span className="font-semibold text-white/60">
                {euro.format(entry.planned)} planned
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#2970FF] to-[#5B9CFF]"
                style={{ width: `${ratio}%` }}
              />
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-y-2 text-sm sm:text-base">
              <div className="text-lg font-semibold text-white sm:text-xl">{euro.format(entry.actual)}</div>
              <div className="flex items-center gap-2 text-xs font-medium sm:text-sm">
                {exceeded ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                    Exceeded
                  </span>
                ) : null}
                <span className={entry.positive ? 'text-emerald-400' : 'text-rose-400'}>
                  {entry.positive ? '▲' : '▼'} {Math.abs(entry.delta).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDateInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  if (!value) return '';
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return displayDateFormatter.format(new Date(parsed));
}

function buildCategoryAggregates(transactions: LedgerTransaction[], categoryTree: CategoryTree): CategoryAggregate[] {
  const mainOrder = categoryTree.main
    .filter((category) => category.id !== REVIEW_MAIN_ID)
    .map((category) => category.id);

  const grouped = new Map<
    string,
    {
      mainId: string;
      mainName: string;
      totalIncome: number;
      totalExpenses: number;
      children: Map<
        string,
        {
          categoryId: string;
          categoryName: string;
          totalIncome: number;
          totalExpenses: number;
        }
      >;
    }
  >();

  transactions.forEach((tx) => {
    if (tx.mainCategoryId === REVIEW_MAIN_ID || tx.categoryId === REVIEW_SUB_ID) {
      return;
    }

    const mainId = tx.mainCategoryId ?? tx.categoryId ?? 'uncategorized';
    const mainName = tx.mainCategoryName ?? tx.categoryName ?? 'Uncategorized';
    const childId = tx.categoryId ?? `${mainId}__uncategorized`;
    const childName =
      tx.categoryName ?? (tx.mainCategoryName ? `${tx.mainCategoryName} (uncategorized)` : 'Uncategorized');

    const mainBucket =
      grouped.get(mainId) ??
      {
        mainId,
        mainName,
        totalIncome: 0,
        totalExpenses: 0,
        children: new Map<
          string,
          {
            categoryId: string;
            categoryName: string;
            totalIncome: number;
            totalExpenses: number;
          }
        >(),
      };

    const childBucket =
      mainBucket.children.get(childId) ??
      {
        categoryId: childId,
        categoryName: childName,
        totalIncome: 0,
        totalExpenses: 0,
      };

    if (isDebitTransaction(tx)) {
      const absolute = getAbsoluteAmount(tx);
      mainBucket.totalExpenses += absolute;
      childBucket.totalExpenses += absolute;
    } else {
      const incomeValue = getAbsoluteAmount(tx);
      mainBucket.totalIncome += incomeValue;
      childBucket.totalIncome += incomeValue;
    }

    mainBucket.children.set(childId, childBucket);
    grouped.set(mainId, mainBucket);
  });

  const list = Array.from(grouped.values());

  list.sort((a, b) => {
    const indexA = mainOrder.indexOf(a.mainId);
    const indexB = mainOrder.indexOf(b.mainId);
    if (indexA === -1 && indexB === -1) {
      return a.mainName.localeCompare(b.mainName);
    }
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  return list.map((main) => {
    const categoryOrder = categoryTree.byParent[main.mainId] ?? [];
    const children = Array.from(main.children.values());

    children.sort((a, b) => {
      const indexA = categoryOrder.findIndex((category) => category.id === a.categoryId);
      const indexB = categoryOrder.findIndex((category) => category.id === b.categoryId);
      if (indexA === -1 && indexB === -1) {
        return a.categoryName.localeCompare(b.categoryName);
      }
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    return {
      mainId: main.mainId,
      mainName: main.mainName,
      totalIncome: main.totalIncome,
      totalExpenses: main.totalExpenses,
      children,
    };
  });
}

function buildSpendingBreakdown(transactions: LedgerTransaction[]): BreakdownEntry[] {
  const totals = new Map<string, { label: string; value: number }>();

  transactions.forEach((tx) => {
    if (!isDebitTransaction(tx)) return;
    const key = tx.mainCategoryId ?? tx.categoryId ?? 'uncategorized';
    const label = tx.mainCategoryName ?? tx.categoryName ?? 'Uncategorized';
    const item = totals.get(key) ?? { label, value: 0 };
    item.value += getAbsoluteAmount(tx);
    totals.set(key, item);
  });

  const entries = Array.from(totals.values())
    .map((item, index) => ({
      label: item.label,
      value: item.value,
      percent: 0,
      color: COLORS[index % COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);

  const total = entries.reduce((acc, entry) => acc + entry.value, 0);
  return entries.map((entry) => ({
    ...entry,
    percent: total === 0 ? 0 : Math.round((entry.value / total) * 1000) / 10,
  }));
}

function buildLineData(transactions: LedgerTransaction[]): LineDatum[] {
  const daily = new Map<string, { income: number; expense: number }>();

  transactions.forEach((tx) => {
    const key = tx.date.slice(0, 10);
    const bucket = daily.get(key) ?? { income: 0, expense: 0 };
    if (isDebitTransaction(tx)) {
      bucket.expense += getAbsoluteAmount(tx);
    } else {
      bucket.income += getAbsoluteAmount(tx);
    }
    daily.set(key, bucket);
  });

  const sorted = Array.from(daily.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-30);

  let cumulativeCurrent = 0;
  let cumulativePrevious = 0;

  return sorted.map(([date, value], index) => {
    cumulativeCurrent += value.income - value.expense;
    const previous = index > 2 ? sorted[index - 3][1] : value;
    cumulativePrevious += previous.income - previous.expense;
    return {
      label: date.slice(5),
      current: cumulativeCurrent,
      previous: cumulativePrevious,
    };
  });
}

function buildCashFlowData(transactions: LedgerTransaction[]): CashFlowDatum[] {
  const grouped = new Map<string, { income: number; expenses: number }>();

  transactions.forEach((tx) => {
    const date = new Date(tx.date);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const bucket = grouped.get(key) ?? { income: 0, expenses: 0 };
    if (isDebitTransaction(tx)) {
      bucket.expenses += getAbsoluteAmount(tx);
    } else {
      bucket.income += getAbsoluteAmount(tx);
    }
    grouped.set(key, bucket);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-6)
    .map(([key, value]) => {
      const [year, month] = key.split('-');
      const label = `${monthFormatter.format(new Date(Number(year), Number(month) - 1))}`;
      return {
        label,
        income: value.income,
        expenses: value.expenses,
        net: value.income - value.expenses,
      };
    });
}

function buildPlannedSummary(transactions: LedgerTransaction[]): PlannedSummary[] {
  const income = transactions
    .filter((tx) => !isDebitTransaction(tx))
    .reduce((acc, tx) => acc + getAbsoluteAmount(tx), 0);
  const expenses = transactions
    .filter((tx) => isDebitTransaction(tx))
    .reduce((acc, tx) => acc + getAbsoluteAmount(tx), 0);

  return [
    {
      label: 'Income',
      planned: income * 1.1,
      actual: income,
      delta: income === 0 ? 0 : ((income - income * 1.1) / (income * 1.1)) * 100,
      positive: income >= income * 1.1,
    },
    {
      label: 'Expenses',
      planned: expenses * 0.9,
      actual: expenses,
      delta: expenses === 0 ? 0 : ((expenses - expenses * 0.9) / (expenses * 0.9)) * 100,
      positive: expenses <= expenses * 0.9,
    },
  ];
}

function calculateSummary(list: LedgerTransaction[]): SummaryValues {
  const reviewCount = list.filter((tx) => tx.needsManualCategory).length;
  const autoCategorized = list.filter((tx) => tx.autoCategorized).length;
  const totalAmount = list.reduce(
    (acc, tx) => acc + (isDebitTransaction(tx) ? -getAbsoluteAmount(tx) : getAbsoluteAmount(tx)),
    0,
  );
  return {
    total: list.length,
    reviewCount,
    autoCategorized,
    totalAmount,
  };
}
