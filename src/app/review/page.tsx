'use client';

import { Suspense, useCallback, useMemo, useState, forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';
import { ReviewTable } from '@/components/review/ReviewTable';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { useLedger } from '@/context/ledger-context';
import type { Category, LedgerTransaction } from '@/context/ledger-context';
import { ClipboardCheck, Check, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { RuleManager, RuleFormState } from '@/components/review/RuleManager';
import { DEFAULT_LOCALE } from '@/constants/intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@/helpers/utils';

const REVIEW_MAIN_ID = 'cat-review';
const REVIEW_SUB_ID = 'sub-review-needs-category';

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewPageSkeleton />}>
      <ReviewPageContent />
    </Suspense>
  );
}

function ReviewPageSkeleton() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#050B18] text-white/60">
      Loading review queue…
    </div>
  );
}

type ReviewOrderOption =
  | 'date'
  | 'main'
  | 'sub'
  | 'history'
  | 'suggested'
  | 'name'
  | 'amount';

const ORDER_OPTIONS: Array<{ value: ReviewOrderOption; label: string }> = [
  { value: 'date', label: 'Date' },
  { value: 'main', label: 'Main category' },
  { value: 'sub', label: 'Sub category' },
  { value: 'history', label: 'History matched' },
  { value: 'suggested', label: 'Suggested match' },
  { value: 'name', label: 'Name' },
  { value: 'amount', label: 'Amount' },
];

function ReviewPageContent() {
  const { reviewTransactions, transactions, categoryTree, categories, assignCategory, clearReviewQueue: clearReviewQueueAction } =
    useLedger();
  const [orderBy, setOrderBy] = useState<ReviewOrderOption>('date');

  const mainCategories = useMemo(
    () => categoryTree.main.filter((category) => category.id !== REVIEW_MAIN_ID),
    [categoryTree.main],
  );

  const subcategories = useMemo(() => {
    const result: Record<string, Category[]> = {};
    mainCategories.forEach((main) => {
      const subs = (categoryTree.byParent[main.id] ?? []).filter((category) => category.id !== REVIEW_SUB_ID);
      if (subs.length) {
        result[main.id] = subs;
      }
    });
    return result;
  }, [mainCategories, categoryTree.byParent]);

  const orderedReviewTransactions = useMemo(() => {
    const sorted = [...reviewTransactions];
    const compare = buildTransactionComparator(orderBy);
    sorted.sort(compare);
    return sorted;
  }, [reviewTransactions, orderBy]);

  const suggestions = useMemo(
    () => buildSuggestions(orderedReviewTransactions),
    [orderedReviewTransactions],
  );

  const [ruleDraft, setRuleDraft] = useState<Partial<RuleFormState> | undefined>(undefined);
  const [isClearDialogOpen, setClearDialogOpen] = useState(false);
  const [isClearingQueue, setIsClearingQueue] = useState(false);

  const handleCreateRuleDraft = useCallback((tx: LedgerTransaction) => {
    setRuleDraft({
      label: tx.description.slice(0, 60),
      mainCategoryId: tx.mainCategoryId ?? '',
      categoryId: tx.categoryId ?? '',
      conditions: [
        { field: 'description', matchType: 'contains', value: tx.description },
      ],
      priority: 100,
      isActive: true,
    });
    toast.success('Rule form pre-filled above. Adjust and save.');
  }, []);

  const handleClearQueue = useCallback(async () => {
    if (!reviewTransactions.length) {
      setClearDialogOpen(false);
      return;
    }
    setIsClearingQueue(true);
    try {
      await clearReviewQueueAction();
      toast.success('Review queue cleared');
      setClearDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('Unable to clear queue');
    } finally {
      setIsClearingQueue(false);
    }
  }, [clearReviewQueueAction, reviewTransactions.length]);

  return (
    <DashboardShell
      title="Needs Review"
      subtitle="Resolve uncategorized transactions so your reports stay accurate"
      actions={
        <div className="flex flex-col gap-3 text-xs font-medium text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            {reviewTransactions.length.toLocaleString(DEFAULT_LOCALE)} items pending
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3 sm:pl-4">
            <OrderBySelect value={orderBy} onValueChange={(value) => setOrderBy(value as ReviewOrderOption)} />
            <Button
              variant="destructive"
              disabled={reviewTransactions.length === 0 || isClearingQueue}
              onClick={() => setClearDialogOpen(true)}
              className="transform transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg"
            >
              Clear queue
            </Button>
          </div>
          <Dialog open={isClearDialogOpen} onOpenChange={setClearDialogOpen}>
            <DialogContent className="bg-[#060F1F]/90 text-white">
              <DialogHeader>
                <DialogTitle>Delete review queue?</DialogTitle>
                <DialogDescription className="text-sm text-white/70">
                  This will permanently delete all transactions currently in the review queue for this account. Confirmed ledger
                  transactions will not be affected.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setClearDialogOpen(false)}
                  disabled={isClearingQueue}
                  className="transform transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleClearQueue}
                  disabled={isClearingQueue}
                  className="transform transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg"
                >
                  {isClearingQueue ? 'Deleting…' : 'Delete queue'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-white/5 bg-[#060F1F]/70 p-6 shadow-inner shadow-black/30">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60">Categorization rules</h2>
          <p className="mt-1 text-xs text-white/50">
            Automate recurring vendors with prioritized patterns. Save a rule to apply it to future imports instantly.
          </p>
          <div className="mt-4">
            <RuleManager
              mainCategories={mainCategories}
              subcategories={subcategories}
              draft={ruleDraft}
              onDraftConsumed={() => setRuleDraft(undefined)}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-white/5 bg-[#060F1F]/60 p-6 shadow-inner shadow-black/30">
          <ReviewTable
            transactions={orderedReviewTransactions}
            categoryTree={{ mainCategories, subcategories }}
            suggestions={suggestions}
            onAssign={assignCategory}
            onCreateRule={handleCreateRuleDraft}
          />
        </section>
      </div>
    </DashboardShell>
  );
}

type Suggestion = {
  mainCategoryId?: string | null;
  mainCategoryName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  confidence: 'exact' | 'fuzzy' | 'none';
};

function buildSuggestions(reviewTransactions: LedgerTransaction[]): Record<string, Suggestion> {
  if (!reviewTransactions.length) return {};

  const suggestions: Record<string, Suggestion> = {};

  reviewTransactions.forEach((tx) => {
    const mainCategoryId = tx.mainCategoryId ?? null;
    const categoryId = tx.categoryId ?? null;
    const mainCategoryName =
      tx.mainCategoryName ?? tx.suggestedMainCategoryName ?? tx.rawMainCategoryName ?? null;
    const categoryName = tx.categoryName ?? tx.suggestedSubCategoryName ?? tx.rawCategoryName ?? null;

    let confidence: Suggestion['confidence'] = 'none';
    if (
      tx.classificationSource === 'history' ||
      tx.classificationSource === 'rule' ||
      tx.suggestionConfidence === 'exact'
    ) {
      confidence = 'exact';
    } else if (
      tx.classificationSource === 'import' &&
      tx.suggestionConfidence &&
      tx.suggestionConfidence !== 'review'
    ) {
      confidence = 'fuzzy';
    }

    suggestions[tx.id] = {
      mainCategoryId,
      mainCategoryName,
      categoryId,
      categoryName,
      confidence,
    };
  });

  return suggestions;
}

const buildTransactionComparator = (order: ReviewOrderOption) => {
  return (a: LedgerTransaction, b: LedgerTransaction) => {
    const compareStrings = (left: string | null | undefined, right: string | null | undefined) => {
      const safeLeft = left?.toLowerCase() ?? '';
      const safeRight = right?.toLowerCase() ?? '';
      if (safeLeft < safeRight) return -1;
      if (safeLeft > safeRight) return 1;
      return 0;
    };

    let delta = 0;
    switch (order) {
      case 'date': {
        const left = new Date(a.date).getTime();
        const right = new Date(b.date).getTime();
        delta = left - right;
        break;
      }
      case 'main':
        delta = compareStrings(a.mainCategoryName, b.mainCategoryName);
        break;
      case 'sub':
        delta = compareStrings(a.categoryName, b.categoryName);
        break;
      case 'history': {
        const left = a.classificationSource === 'history' ? 0 : 1;
        const right = b.classificationSource === 'history' ? 0 : 1;
        delta = left - right;
        break;
      }
      case 'suggested': {
        const isSuggested = (tx: LedgerTransaction) =>
          tx.classificationSource === 'import' && tx.suggestionConfidence && tx.suggestionConfidence !== 'review';
        const left = isSuggested(a) ? 0 : 1;
        const right = isSuggested(b) ? 0 : 1;
        delta = left - right;
        break;
      }
      case 'name':
        delta = compareStrings(a.description, b.description);
        break;
      case 'amount':
        delta = a.amount - b.amount;
        break;
      default:
        delta = 0;
    }

    if (delta !== 0) {
      return delta;
    }
    return a.id.localeCompare(b.id);
  };
};

function OrderBySelect({ value, onValueChange }: { value: ReviewOrderOption; onValueChange: (value: string) => void }) {
  return (
    <div className="space-y-1 text-left text-white/60">
      <p className="text-[11px] font-semibold uppercase tracking-wide">Order by</p>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9 min-w-[180px] rounded-xl border border-white/15 bg-[#050B18]/70 px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-white/40">
          <SelectValue placeholder="Order by" />
        </SelectTrigger>
        <SelectContent className="rounded-xl border border-white/10 bg-[#050B18]/95 text-sm text-white shadow-xl">
          {ORDER_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-80" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport className={cn('p-1', position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]')}>
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;
