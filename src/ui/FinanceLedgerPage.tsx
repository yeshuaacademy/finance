'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLedger } from '@/context/ledger-context';
import { FinanceAppFrame } from '@/ui/FinanceAppFrame';
import type { LedgerTransaction } from '@/helpers/api-transaction-mapper';
import {
  buildLatestYearOverview,
  buildMonthOptions,
  filterLedgerTransactions,
  filterTransactionsByMonth,
  formatEuro,
  getLedgerCategoryLabel,
  getLastCompletedMonthKey,
  parseLedgerDate,
  resolveActiveMonth,
  summarizeLedgerTransactions,
  type MonthOption,
} from '@/helpers/ledger-page';
import { UploadCsvButton } from '@/components/ledger/UploadCsvButton';

const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function Header({ monthOptions, selectedMonth, onMonthChange }: { monthOptions: MonthOption[]; selectedMonth: string; onMonthChange: (value: string) => void }) {
  return (
    <header className="mb-6 rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-5 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#7d6d5a]">Transacties en import</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-[-0.05em] md:text-4xl">Administratie</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedMonth}
            onChange={(event) => onMonthChange(event.target.value)}
            className="rounded-2xl border border-[#ded5c8] bg-[#f5f1ea] px-4 py-3 text-sm font-semibold text-[#574b3f] outline-none focus:border-[#1f5f4a]"
          >
            {monthOptions.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          <Link href="/review" className="rounded-2xl border border-[#ded5c8] bg-[#fbf8f2] px-5 py-3 text-sm font-semibold text-[#574b3f]">
            Te beoordelen
          </Link>
        </div>
      </div>
    </header>
  );
}

function Kpi({ label, value, helper, tone = 'neutral' }: { label: string; value: string; helper: string; tone?: 'income' | 'expense' | 'review' | 'neutral' }) {
  const toneClass =
    tone === 'income'
      ? 'bg-[#e7f0e7] text-[#1f5f4a]'
      : tone === 'expense'
        ? 'bg-[#f4e7df] text-[#914f35]'
        : tone === 'review'
          ? 'bg-[#f5e9c8] text-[#7a5512]'
          : 'bg-[#eee8df] text-[#574b3f]';

  return (
    <article className="rounded-[1.75rem] border border-[#ded5c8] bg-[#fbf8f2] p-5 shadow-[0_18px_55px_rgba(87,67,45,0.07)]">
      <div className={`mb-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${toneClass}`}>{label}</div>
      <p className="text-3xl font-semibold tracking-[-0.05em]">{value}</p>
      <p className="mt-2 text-sm text-[#7d6d5a]">{helper}</p>
    </article>
  );
}

function ImportPanel({ selectedMonth }: { selectedMonth: string }) {
  return (
    <section id="importeren" className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#7d6d5a]">Importeren</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">ING maandexport</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f6253]">
            Upload de CSV-export uit ING. Dubbele transacties worden automatisch genegeerd en onbekende transacties komen in de beoordelingsrij.
          </p>
        </div>
        <UploadCsvButton periodKey={selectedMonth} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <StateCard title="Goed bestand" body="ING CSV met datum, omschrijving, rekening, bedrag en bij/af." />
        <StateCard title="Dubbele import" body="Geen probleem: bestaande transacties worden niet opnieuw toegevoegd." />
        <StateCard title="Verkeerd bestand" body="De app geeft een Nederlandse foutmelding en stopt veilig." />
      </div>
    </section>
  );
}

function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.5rem] border border-[#ded5c8] bg-[#f8f3ec] p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#6f6253]">{body}</p>
    </div>
  );
}

function TransactionTable({ transactions }: { transactions: LedgerTransaction[] }) {
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<string | null | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | null | undefined>(undefined);
  const clients = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    transactions.forEach((transaction) => {
      if (!transaction.clientId) return;
      const name = transaction.clientName ?? transaction.clientCode ?? 'Onbekende klant';
      byId.set(transaction.clientId, {
        id: transaction.clientId,
        label: transaction.clientCode && transaction.clientCode !== name
          ? `${transaction.clientCode} · ${name}`
          : name,
      });
    });
    return Array.from(byId.values()).sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  }, [transactions]);
  const transactionTypes = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    transactions.forEach((transaction) => {
      if (!transaction.transactionTypeId) return;
      byId.set(transaction.transactionTypeId, {
        id: transaction.transactionTypeId,
        label: transaction.transactionTypeName ?? 'Onbekend type',
      });
    });
    return Array.from(byId.values()).sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  }, [transactions]);
  const hasUnassignedClient = transactions.some((transaction) => !transaction.clientId);
  const hasUnassignedType = transactions.some((transaction) => !transaction.transactionTypeId);
  const filtered = useMemo(
    () => filterLedgerTransactions(transactions, query, {
      clientId: clientFilter,
      transactionTypeId: typeFilter,
    }),
    [clientFilter, query, transactions, typeFilter],
  );

  return (
    <section id="transacties" className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#7d6d5a]">Transacties</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Klant, type en categorie</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Zoek omschrijving, klant, type of categorie"
            aria-label="Zoeken op omschrijving, klant, type of categorie"
            className="min-w-[15rem] rounded-2xl border border-[#ded5c8] bg-[#f5f1ea] px-4 py-3 text-sm outline-none focus:border-[#1f5f4a]"
          />
          <select
            aria-label="Filter op klant"
            value={clientFilter === undefined ? '' : clientFilter === null ? '__unassigned__' : clientFilter}
            onChange={(event) => setClientFilter(event.target.value === '' ? undefined : event.target.value === '__unassigned__' ? null : event.target.value)}
            className="rounded-2xl border border-[#ded5c8] bg-[#f5f1ea] px-3 py-3 text-sm outline-none focus:border-[#1f5f4a]"
          >
            <option value="">Alle klanten</option>
            {hasUnassignedClient ? <option value="__unassigned__">Klant niet toegewezen</option> : null}
            {clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
          </select>
          <select
            aria-label="Filter op transactietype"
            value={typeFilter === undefined ? '' : typeFilter === null ? '__unassigned__' : typeFilter}
            onChange={(event) => setTypeFilter(event.target.value === '' ? undefined : event.target.value === '__unassigned__' ? null : event.target.value)}
            className="rounded-2xl border border-[#ded5c8] bg-[#f5f1ea] px-3 py-3 text-sm outline-none focus:border-[#1f5f4a]"
          >
            <option value="">Alle typen</option>
            {hasUnassignedType ? <option value="__unassigned__">Type niet toegewezen</option> : null}
            {transactionTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
        </div>
      </div>
      {filtered.length ? (
        <div className="overflow-x-auto rounded-[1.5rem] border border-[#ded5c8]">
          <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
            <thead className="bg-[#f5f1ea] text-xs uppercase tracking-[0.14em] text-[#8a7965]">
              <tr>
                <th className="px-4 py-3 font-semibold">Datum</th>
                <th className="px-4 py-3 font-semibold">Omschrijving</th>
                <th className="px-4 py-3 font-semibold">Klant</th>
                <th className="px-4 py-3 font-semibold">Transactietype</th>
                <th className="px-4 py-3 font-semibold">Categorie</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((transaction) => {
                const isExpense = transaction.amount < 0;
                return (
                  <tr key={transaction.id} className="border-t border-[#ded5c8]">
                    <td className="px-4 py-4 text-[#6f6253]">{dateFormatter.format(parseLedgerDate(transaction.date))}</td>
                    <td className="px-4 py-4">
                      <details>
                        <summary className="cursor-pointer font-semibold text-[#251f1a] marker:text-[#8a7965]">{transaction.description}</summary>
                        <div className="mt-3 rounded-2xl bg-[#f5f1ea] p-3 text-xs leading-5 text-[#6f6253]">
                          <p>Rekening: {transaction.accountLabel ?? transaction.accountIdentifier ?? 'Onbekend'}</p>
                          <p>Tegenrekening: {transaction.counterpartyAccount ?? 'Onbekend'}</p>
                          <p>Omschrijving: {transaction.notificationDetail ?? 'Geen extra omschrijving'}</p>
                          <p>Saldo na transactie: {typeof transaction.runningBalance === 'number' ? formatEuro(transaction.runningBalance) : 'Niet beschikbaar'}</p>
                        </div>
                      </details>
                    </td>
                    <td className="px-4 py-4 text-[#6f6253]">{transaction.clientName ?? transaction.clientCode ?? '—'}</td>
                    <td className="px-4 py-4 text-[#6f6253]">{transaction.transactionTypeName ?? '—'}</td>
                    <td className="px-4 py-4 text-[#6f6253]">{getLedgerCategoryLabel(transaction)}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${transaction.needsManualCategory ? 'bg-[#f5e9c8] text-[#7a5512]' : 'bg-[#e7f0e7] text-[#1f5f4a]'}`}>
                        {transaction.needsManualCategory ? 'Te beoordelen' : 'Verwerkt'}
                      </span>
                    </td>
                    <td className={`px-4 py-4 text-right font-semibold ${isExpense ? 'text-[#914f35]' : 'text-[#1f5f4a]'}`}>{formatEuro(transaction.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-2xl bg-[#f5f1ea] p-5 text-sm text-[#6f6253]">Geen transacties gevonden.</p>
      )}
    </section>
  );
}

function YearOverview({ transactions }: { transactions: LedgerTransaction[] }) {
  const overview = useMemo(() => buildLatestYearOverview(transactions), [transactions]);

  return (
    <section id="jaaroverzicht" className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#7d6d5a]">Jaaroverzicht</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{overview.year} in balans</h3>
        </div>
        <div className="flex gap-2 rounded-full bg-[#f5f1ea] p-1 text-sm font-semibold">
          <span className="rounded-full bg-[#1f5f4a] px-4 py-2 text-[#fbf8f2]">Intern</span>
          <span className="rounded-full px-4 py-2 text-[#6f6253]">ANBI</span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <SmallStat label="Inkomsten" value={formatEuro(overview.income)} />
        <SmallStat label="Uitgaven" value={formatEuro(overview.expenses)} />
        <SmallStat label="Resultaat" value={formatEuro(overview.result)} />
        <SmallStat label="Transacties" value={String(overview.transactionCount)} />
      </div>
      <div className="mt-5 flex flex-col gap-3 rounded-[1.5rem] bg-[#f5f1ea] p-5 text-sm leading-6 text-[#6f6253] md:flex-row md:items-center md:justify-between">
        <p>Voor beginbalans, eindbalans en ANBI-tekst gebruik je het rapportenscherm. Deze kaart blijft bewust simpel.</p>
        <Link href={`/reports?year=${overview.year}`} className="rounded-2xl bg-[#1f5f4a] px-4 py-2 text-center text-sm font-semibold text-[#fbf8f2]">Open rapport</Link>
      </div>
    </section>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] bg-[#f5f1ea] p-4">
      <p className="text-sm text-[#7d6d5a]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

export default function FinanceLedgerPage() {
  const { transactions, summary } = useLedger();

  const monthOptions = useMemo<MonthOption[]>(() => buildMonthOptions(transactions), [transactions]);

  const [selectedMonth, setSelectedMonth] = useState(() => getLastCompletedMonthKey());
  const activeMonth = resolveActiveMonth(monthOptions, selectedMonth);

  const monthTransactions = useMemo(() => filterTransactionsByMonth(transactions, activeMonth), [activeMonth, transactions]);
  const monthSummary = useMemo(() => summarizeLedgerTransactions(monthTransactions), [monthTransactions]);

  return (
    <FinanceAppFrame reviewCount={summary.reviewCount} activeHref="/ledger#transacties">
      <Header monthOptions={monthOptions} selectedMonth={activeMonth} onMonthChange={setSelectedMonth} />
      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Inkomsten" value={formatEuro(monthSummary.income)} helper="Ontvangen in deze maand" tone="income" />
          <Kpi label="Uitgaven" value={formatEuro(monthSummary.expenses)} helper="Besteed in deze maand" tone="expense" />
          <Kpi label="Saldo verandering" value={formatEuro(monthSummary.result)} helper="Inkomsten min uitgaven" />
          <Kpi label="Nog te beoordelen" value={String(monthSummary.reviewCount)} helper="Transacties zonder definitieve categorie" tone="review" />
        </section>
        <ImportPanel selectedMonth={activeMonth} />
        <TransactionTable transactions={monthTransactions} />
        <YearOverview transactions={transactions} />
      </div>
    </FinanceAppFrame>
  );
}
