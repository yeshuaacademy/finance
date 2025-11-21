'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useLedger } from '@/context/ledger-context';
import type { Category, RuleCondition } from '@/context/ledger-context';
import { previewRule as previewRuleApi, applyRule as applyRuleApi } from '@/libs/api';

const MATCH_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'regex', label: 'Regex' },
  { value: 'equals', label: 'Equals' },
] as const;

const MATCH_FIELDS = [
  { value: 'description', label: 'Description' },
  { value: 'counterparty', label: 'Counterparty' },
  { value: 'reference', label: 'Reference' },
  { value: 'source', label: 'Source' },
] as const;

const DEFAULT_PRIORITY = 100;

export type RuleFormState = {
  label: string;
  mainCategoryId: string;
  categoryId: string;
  priority: number;
  isActive: boolean;
  conditions: RuleCondition[];
};

type RuleManagerProps = {
  mainCategories: Category[];
  subcategories: Record<string, Category[]>;
  draft?: Partial<RuleFormState> & { categoryId?: string; mainCategoryId?: string };
  onDraftConsumed?: () => void;
};

const createInitialState = (): RuleFormState => ({
  label: '',
  mainCategoryId: '',
  categoryId: '',
  priority: DEFAULT_PRIORITY,
  isActive: true,
  conditions: [
    { field: 'description', matchType: 'contains', value: '' },
  ],
});

export function RuleManager({ mainCategories, subcategories, draft, onDraftConsumed }: RuleManagerProps) {
  const { rules, serverPipelineEnabled, createRule, updateRule, deleteRule, refreshRules, refreshLedger } = useLedger();
  const [form, setForm] = useState<RuleFormState>(createInitialState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalRuleId, setModalRuleId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMatches, setPreviewMatches] = useState<any[]>([]);

  useEffect(() => {
    if (draft) {
      const nextConditions =
        draft.conditions && draft.conditions.length
          ? (draft.conditions as RuleCondition[])
          : draft.categoryId || draft.label
          ? ([
              {
                field: ((draft as any).matchField ?? 'description') as RuleCondition['field'],
                matchType: ((draft as any).matchType ?? 'contains') as RuleCondition['matchType'],
                value: draft.label ?? '',
              },
            ] as RuleCondition[])
          : undefined;

      setForm((prev) => ({
        ...prev,
        ...draft,
        label: draft.label ?? prev.label,
        categoryId: draft.categoryId ?? prev.categoryId,
        mainCategoryId: draft.mainCategoryId ?? prev.mainCategoryId,
        conditions: nextConditions ?? prev.conditions,
      }));
      setEditingId(null);
      onDraftConsumed?.();
    }
  }, [draft, onDraftConsumed]);

  const sortedMains = useMemo(
    () => mainCategories.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [mainCategories],
  );

  const availableSubs = useMemo(() => {
    if (!form.mainCategoryId) return [];
    return (subcategories[form.mainCategoryId] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [form.mainCategoryId, subcategories]);

  const handleChange = (field: keyof RuleFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = field === 'priority'
        ? Number(event.target.value || DEFAULT_PRIORITY)
        : field === 'isActive'
        ? (event.target as HTMLInputElement).checked
        : event.target.value;
      setForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    };

  const resetForm = () => {
    setForm(createInitialState());
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serverPipelineEnabled) {
      toast.error('Rule management is only available when connected to the server.');
      return;
    }
    if (!form.label.trim() || !form.categoryId) {
      toast.error('Label and category are required.');
      return;
    }
    if (!form.conditions.length || form.conditions.some((cond) => !cond.value.trim())) {
      toast.error('Each condition needs a value.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        label: form.label.trim(),
        pattern: form.conditions[0]?.value ?? '',
        mainCategoryId: form.mainCategoryId || undefined,
        categoryId: form.categoryId,
        matchType: form.conditions[0]?.matchType ?? 'contains',
        matchField: form.conditions[0]?.field ?? 'description',
        conditions: form.conditions,
        priority: form.priority,
        isActive: form.isActive,
      };

      if (editingId) {
        await updateRule(editingId, payload);
        toast.success('Rule updated');
      } else {
        await createRule(payload);
        toast.success('Rule created');
      }

      resetForm();
    } catch (error) {
      console.error(error);
      toast.error(editingId ? 'Unable to update rule' : 'Unable to create rule');
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (id: string) => {
    const rule = rules.find((item) => item.id === id);
    if (!rule) return;
    setEditingId(rule.id);
    setForm({
      label: rule.label,
      categoryId: rule.categoryId,
      mainCategoryId: rule.mainCategoryId ?? '',
      priority: rule.priority ?? DEFAULT_PRIORITY,
      isActive: rule.isActive,
      conditions: rule.conditions && rule.conditions.length
        ? (rule.conditions as RuleCondition[])
        : [{
            field: (rule.matchField ?? 'description') as RuleCondition['field'],
            matchType: (rule.matchType ?? 'contains') as RuleCondition['matchType'],
            value: rule.pattern ?? '',
          }],
    });
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    try {
      await updateRule(id, { isActive: active });
    } catch (error) {
      console.error(error);
      toast.error('Unable to update rule');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this rule?')) {
      return;
    }
    try {
      await deleteRule(id);
      toast.success('Rule deleted');
    } catch (error) {
      console.error(error);
      toast.error('Unable to delete rule');
    }
  };

  const openPreview = async (ruleId: string) => {
    setModalRuleId(ruleId);
    setPreviewLoading(true);
    setPreviewMatches([]);
    try {
      const matches = await previewRuleApi(ruleId, 'review-queue');
      setPreviewMatches(matches ?? []);
    } catch (error) {
      console.error(error);
      toast.error('Unable to preview rule');
      setModalRuleId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const applyRule = async () => {
    if (!modalRuleId || !previewMatches.length) {
      setModalRuleId(null);
      return;
    }
    try {
      await applyRuleApi(modalRuleId, previewMatches.map((m) => m.id));
      toast.success(`Rule applied to ${previewMatches.length} transaction${previewMatches.length === 1 ? '' : 's'}.`);
      setModalRuleId(null);
      setPreviewMatches([]);
      await refreshRules();
      await refreshLedger();
    } catch (error) {
      console.error(error);
      toast.error('Unable to apply rule');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70 transform transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-white/10 hover:shadow-lg"
          onClick={() => {
            refreshRules().catch(() => {});
            toast.success('Rules refreshed');
          }}
        >
          Refresh
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-white/10 bg-[#061124] p-4">
        <div className="grid gap-3">
          <label className="text-xs font-semibold text-white/60">
            Label
            <input
              type="text"
              value={form.label}
              onChange={handleChange('label')}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none"
              placeholder="e.g. ING – Rent"
            />
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-white/60">
              <span>Conditions</span>
              <button
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/70 transition hover:bg-white/10"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    conditions: [
                      ...prev.conditions,
                      { field: 'description', matchType: 'contains', value: '' },
                    ],
                  }))
                }
              >
                + Add condition
              </button>
            </div>
            <div className="space-y-2">
              {form.conditions.map((condition, index) => (
                <div key={`${condition.field}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                  <select
                    value={condition.field}
                    onChange={(event) => {
                      const next = [...form.conditions];
                      next[index] = { ...condition, field: event.target.value as RuleCondition['field'] };
                      setForm((prev) => ({ ...prev, conditions: next }));
                    }}
                    className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none"
                  >
                    <option value="payee">Payee</option>
                    <option value="description">Description</option>
                    <option value="counterparty">Counterparty</option>
                    <option value="reference">Notifications</option>
                    <option value="source">Source</option>
                    <option value="amount">Amount</option>
                  </select>
                  <select
                    value={condition.matchType}
                    onChange={(event) => {
                      const next = [...form.conditions];
                      next[index] = { ...condition, matchType: event.target.value as RuleCondition['matchType'] };
                      setForm((prev) => ({ ...prev, conditions: next }));
                    }}
                    className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none"
                  >
                    <option value="contains">Contains</option>
                    <option value="startsWith">Starts with</option>
                    <option value="endsWith">Ends with</option>
                    <option value="equals">Equals</option>
                    <option value="regex">Regex</option>
                  </select>
                  <input
                    type={condition.field === 'amount' ? 'number' : 'text'}
                    value={condition.value}
                    onChange={(event) => {
                      const next = [...form.conditions];
                      next[index] = { ...condition, value: event.target.value };
                      setForm((prev) => ({ ...prev, conditions: next }));
                    }}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none"
                    placeholder="Value"
                  />
                  {form.conditions.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          conditions: prev.conditions.filter((_, i) => i !== index),
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white/70 transition hover:bg-white/10"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-white/60">
              Main category
              <select
                value={form.mainCategoryId}
                onChange={(event) => {
                  const nextMain = event.target.value;
                  setForm((prev) => ({
                    ...prev,
                    mainCategoryId: nextMain,
                    categoryId: prev.categoryId && subcategories[nextMain]?.some((cat) => cat.id === prev.categoryId)
                      ? prev.categoryId
                      : '',
                  }));
                }}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none"
              >
                <option value="">Select main category</option>
                {sortedMains.map((category) => (
                  <option key={category.id} value={category.id} className="bg-[#061124]">
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-white/60">
              Sub category
              <select
                value={form.categoryId}
                onChange={handleChange('categoryId')}
                disabled={!form.mainCategoryId}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none disabled:opacity-60"
              >
                <option value="">Select sub category</option>
                {availableSubs.map((category) => (
                  <option key={category.id} value={category.id} className="bg-[#061124]">
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs font-semibold text-white/60" />
          <div className="grid grid-cols-2 gap-3 text-xs font-semibold text-white/60">
            <label>
              Priority
              <input
                type="number"
                value={form.priority}
                onChange={handleChange('priority')}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:border-[#2970FF]/70 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs text-white/60">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={handleChange('isActive')}
                className="h-4 w-4 rounded border-white/20 bg-black/40 text-[#2970FF] focus:ring-0"
              />
              Active
            </label>
          </div>
        </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !serverPipelineEnabled}
            className="rounded-lg border border-[#2970FF]/60 bg-[#2970FF]/80 px-3 py-1.5 font-semibold text-white transform transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#2970FF] hover:shadow-lg disabled:opacity-50"
          >
            {editingId ? (busy ? 'Updating…' : 'Update rule') : busy ? 'Creating…' : 'Create rule'}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-semibold text-white/70 transform transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-white/10 hover:shadow-lg"
            >
              Cancel
            </button>
          ) : null}
        </div>
          <span className="text-[11px] text-white/40">Priority ↑ means rule runs first</span>
        </div>
      </form>

      <div className="space-y-2">
        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-center text-xs text-white/50">
            No rules yet. Capture a recurring description to get started.
          </p>
        ) : null}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="rounded-xl border border-white/10 bg-[#050F20] px-4 py-3 text-xs text-white/70"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{rule.label}</div>
                <div className="text-[11px] text-white/50">
                  {rule.matchType} {rule.matchField} → <span className="font-semibold text-white/70">{rule.categoryName ?? rule.categoryId}</span>
                </div>
                <div className="mt-1 text-[11px] text-white/40">Pattern: {rule.pattern}</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openPreview(rule.id)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/70 transition hover:bg-white/10"
                >
                  Apply to queue
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(rule.id)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/70 transition hover:bg-white/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleActive(rule.id, !rule.isActive)}
                  className="rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold transition hover:bg-white/10"
                  style={{ color: rule.isActive ? '#34D399' : '#FBBF24', borderColor: 'rgba(255,255,255,0.1)' }}
                >
                  {rule.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/20"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
              <span>Priority {rule.priority}</span>
              <span>Updated {new Date(rule.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
      {modalRuleId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#050B18] p-6 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Apply rule to review queue</h3>
              <button
                type="button"
                onClick={() => {
                  setModalRuleId(null);
                  setPreviewMatches([]);
                }}
                className="text-sm text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>
            {previewLoading ? (
              <p className="mt-4 text-sm text-white/60">Loading matches…</p>
            ) : previewMatches.length === 0 ? (
              <p className="mt-4 text-sm text-white/60">No matching transactions found.</p>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-white/70">
                  This rule will update {previewMatches.length} transaction
                  {previewMatches.length === 1 ? '' : 's'} in the review queue.
                </p>
                <div className="max-h-80 overflow-y-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-xs text-white/70">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2">Amount</th>
                        <th className="px-3 py-2">Account</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {previewMatches.map((tx) => (
                        <tr key={tx.id} className="bg-white/[0.02]">
                          <td className="px-3 py-2">{new Date(tx.date).toLocaleDateString()}</td>
                          <td className="px-3 py-2">{tx.description}</td>
                          <td className="px-3 py-2">{(Number(tx.amountMinor ?? 0) / 100).toLocaleString(undefined, { style: 'currency', currency: tx.currency ?? 'EUR' })}</td>
                          <td className="px-3 py-2">{tx.account?.name ?? tx.account?.identifier ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalRuleId(null);
                  setPreviewMatches([]);
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={previewLoading || previewMatches.length === 0}
                onClick={applyRule}
                className="rounded-lg border border-[#2970FF] bg-[#2970FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f5de0] disabled:opacity-60"
              >
                Apply rule
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
