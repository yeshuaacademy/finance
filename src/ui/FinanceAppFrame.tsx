import Link from 'next/link';
import type { ReactNode } from 'react';
import { FINANCE_NAV_ITEMS } from '@/helpers/navigation';

// Use canonical Dutch nav items from navigation helper (UX-002).
// Navigation is limited to the confirmed finance workflow only.
const navItems = FINANCE_NAV_ITEMS.map((item) => ({
  label: item.label === 'Beoordelen' ? 'Te beoordelen' : item.label,
  href: item.href,
}));

export function FinanceAppFrame({
  children,
  reviewCount,
  activeHref,
  showWorkflowHint = false,
  settingsNavigation,
}: {
  children: ReactNode;
  reviewCount: number;
  activeHref?: string;
  showWorkflowHint?: boolean;
  settingsNavigation?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f5f1ea] text-[#251f1a]">
      {/* Mobile / tablet top bar — hidden on lg+ where the sidebar takes over */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#ded5c8] bg-[#fbf8f2] px-4 py-3 lg:hidden">
        <p className="text-sm font-semibold tracking-[-0.02em]">YA Finance</p>
        <nav className="flex gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? 'bg-[#1f5f4a] text-[#fbf8f2]'
                    : 'text-[#6f6253] hover:bg-[#efe7db] hover:text-[#251f1a]'
                }`}
              >
                {item.label}
                {item.label === 'Te beoordelen' && reviewCount > 0 ? (
                  <span className="rounded-full bg-[#e6b85c] px-1.5 py-0.5 text-[10px] text-[#35240a]">{reviewCount}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto flex min-h-screen max-w-[1480px] gap-6 px-4 py-4 sm:px-6 sm:py-6">
        <aside className="hidden w-64 shrink-0 self-start rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-5 shadow-[0_24px_70px_rgba(87,67,45,0.08)] lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8a7965]">Yeshua Academy</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#251f1a]">Finance</h1>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const isActive = item.href === activeHref;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    isActive
                      ? 'bg-[#1f5f4a] text-[#fbf8f2] shadow-[0_10px_30px_rgba(31,95,74,0.18)]'
                      : 'text-[#6f6253] hover:bg-[#efe7db] hover:text-[#251f1a]'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.label === 'Te beoordelen' && reviewCount > 0 ? (
                    <span className="rounded-full bg-[#e6b85c] px-2 py-0.5 text-xs text-[#35240a]">{reviewCount}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          {settingsNavigation ? <div className="mt-7 border-t border-[#ded5c8] pt-5">{settingsNavigation}</div> : null}
          {showWorkflowHint ? (
            <div className="mt-8 rounded-3xl bg-[#efe7db] p-4 text-sm text-[#5f5347]">
              <p className="font-semibold text-[#251f1a]">Rustige workflow</p>
              <p className="mt-1">Importeer de ING-export, beoordeel wat overblijft en controleer de maand.</p>
            </div>
          ) : null}
        </aside>

        <section className="min-w-0 flex-1">
          {settingsNavigation ? <div className="mb-4 lg:hidden">{settingsNavigation}</div> : null}
          {children}
        </section>
      </div>
    </main>
  );
}
