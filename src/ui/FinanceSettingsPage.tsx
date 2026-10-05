'use client';

import { useEffect, useMemo, useState } from 'react';
import { FinanceAppFrame } from '@/ui/FinanceAppFrame';
import {
  deactivateEmailRecipient,
  fetchAuditLogs,
  fetchEmailRecipients,
  fetchImportBatches,
  getImportBatchDownloadUrl,
  saveEmailRecipient,
  type AuditLogEntry,
  type EmailRecipient,
  type ImportBatchSummary,
  isClientAdmin,
  fetchReferenceProjects,
  createReferenceProject,
  updateReferenceProject,
  fetchReferenceCategories,
  createReferenceCategory,
  updateReferenceCategory,
  fetchReferenceTransactionTypes,
  createReferenceTransactionType,
  updateReferenceTransactionType,
  postDirectionInferenceDryRun,
  postDirectionInferenceExecute,
  postOwnerHistoryProposalDryRun,
  postOwnerHistoryProposalExecute,
  postCategoryNormalizationAction,
  type ReferenceProjectItem,
  type ReferenceCategoryItem,
  type ReferenceTransactionTypeItem,
  type DirectionInferenceResponse,
  type OwnerHistoryProposalResponse,
  type CategoryNormalizationResponse,
  type CategoryNormalizationSummary,
} from '@/libs/api';
import { useLedger } from '@/context/ledger-context';
import { filterCategoryTreeByActiveIds } from '@/helpers/category-tree';
import {
  formatFileSize,
  formatImportDate,
  isReviewPlaceholderCategory,
  shortHash,
  translateAuditAction,
  translateImportStatus,
} from '@/helpers/settings-page';

function SettingCard({ title, body, status }: { title: string; body: string; status: string }) {
  return (
    <article className="rounded-[1.75rem] border border-[#ded5c8] bg-[#fbf8f2] p-5 shadow-[0_18px_55px_rgba(87,67,45,0.07)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold tracking-[-0.04em]">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-[#6f6253]">{body}</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#edf5ec] px-3 py-1 text-xs font-semibold text-[#1f5f4a]">{status}</span>
      </div>
    </article>
  );
}

function CategoryOverview({ categories }: { categories: ReferenceCategoryItem[] | null }) {
  const { categoryTree } = useLedger();
  const activeCategories = useMemo(() => categories?.filter((category) => category.isActive) ?? [], [categories]);
  const visibleTree = useMemo(() => filterCategoryTreeByActiveIds(
    categoryTree,
    new Set(activeCategories.map((category) => category.id)),
    new Map(activeCategories.map((category) => [category.id, category.name])),
  ), [activeCategories, categoryTree]);
  const mainCategories = useMemo(() => visibleTree.main.filter((category) => !isReviewPlaceholderCategory(category)), [visibleTree.main]);

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#7d6d5a]">Categorieën</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Huidige indeling</h3>
        </div>
        <span className="rounded-full bg-[#f5f1ea] px-3 py-1 text-xs font-semibold text-[#7d6d5a]">{mainCategories.length} hoofdcategorieën</span>
      </div>
      {mainCategories.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {mainCategories.map((main) => {
            const children = (visibleTree.byParent[main.id] ?? []).filter((category) => !isReviewPlaceholderCategory(category));
            return (
              <div key={main.id} className="rounded-[1.5rem] border border-[#ded5c8] bg-[#f8f3ec] p-4">
                <p className="font-semibold text-[#251f1a]">{main.name}</p>
                {children.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {children.map((child) => (
                      <span key={child.id} className="rounded-full bg-[#fbf8f2] px-3 py-1 text-xs font-semibold text-[#6f6253]">{child.name}</span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[#7d6d5a]">Geen subcategorieën.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl bg-[#f5f1ea] p-5 text-sm text-[#6f6253]">
          {categories === null ? 'Actieve categorieën laden…' : 'Nog geen actieve categorieën.'}
        </p>
      )}
    </section>
  );
}

function EmailRecipientsPanel() {
  const canManageRecipients = isClientAdmin();
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRecipients = () => {
    fetchEmailRecipients()
      .then((items) => {
        setRecipients(items);
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'E-mailontvangers konden niet worden geladen.');
      });
  };

  useEffect(() => {
    loadRecipients();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageRecipients) {
      setError('Alleen beheerders mogen e-mailontvangers beheren.');
      return;
    }
    setBusy(true);
    try {
      await saveEmailRecipient({ email, name: name || null });
      setEmail('');
      setName('');
      loadRecipients();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'E-mailontvanger kon niet worden opgeslagen.');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id: string) => {
    if (!canManageRecipients) {
      setError('Alleen beheerders mogen e-mailontvangers beheren.');
      return;
    }
    setBusy(true);
    try {
      await deactivateEmailRecipient(id);
      loadRecipients();
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : 'E-mailontvanger kon niet worden gedeactiveerd.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">E-mailupdates</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Ontvangers maandoverzicht</h3>
      <p className="mt-2 text-sm leading-6 text-[#6f6253]">Beheer de mensen die de financiële samenvatting per e-mail mogen ontvangen.</p>
      {!canManageRecipients ? <p className="mt-4 rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Je kijkt mee als viewer. Alleen beheerders kunnen ontvangers toevoegen of uitschakelen.</p> : null}

      <form onSubmit={handleSubmit} className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="e-mailadres" className="rounded-2xl border border-[#ded5c8] bg-[#f5f1ea] px-4 py-3 text-sm outline-none focus:border-[#1f5f4a]" />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="naam optioneel" className="rounded-2xl border border-[#ded5c8] bg-[#f5f1ea] px-4 py-3 text-sm outline-none focus:border-[#1f5f4a]" />
        <button disabled={busy || !canManageRecipients} className="rounded-2xl bg-[#1f5f4a] px-5 py-3 text-sm font-semibold text-[#fbf8f2] disabled:opacity-60">{canManageRecipients ? 'Toevoegen' : 'Alleen beheerder'}</button>
      </form>

      {error ? <p className="mt-4 rounded-2xl bg-[#f7e9e4] p-4 text-sm text-[#7b4b3a]">{error}</p> : null}

      <div className="mt-5 space-y-3">
        {recipients.length ? recipients.map((recipient) => (
          <div key={recipient.id} className="flex flex-col gap-3 rounded-[1.25rem] bg-[#f5f1ea] p-4 text-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-[#251f1a]">{recipient.name || recipient.email}</p>
              <p className="text-xs text-[#7d6d5a]">{recipient.email} · {recipient.isActive ? 'actief' : 'uitgeschakeld'}</p>
            </div>
            {recipient.isActive ? (
              <button type="button" disabled={busy || !canManageRecipients} onClick={() => deactivate(recipient.id)} className="rounded-full border border-[#ded5c8] px-3 py-1 text-xs font-semibold text-[#7b4b3a] disabled:opacity-60">{canManageRecipients ? 'Uitschakelen' : 'Alleen beheerder'}</button>
            ) : null}
          </div>
        )) : <p className="rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Nog geen e-mailontvangers toegevoegd.</p>}
      </div>
    </section>
  );
}

function ImportHistoryPanel() {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchImportBatches(10)
      .then((items) => {
        if (!cancelled) {
          setBatches(items);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Importgeschiedenis kon niet worden geladen.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#7d6d5a]">ING-imports</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Laatste importbestanden</h3>
        </div>
        <span className="rounded-full bg-[#edf5ec] px-3 py-1 text-xs font-semibold text-[#1f5f4a]">Download beschikbaar</span>
      </div>
      <p className="mb-5 text-sm leading-6 text-[#6f6253]">
        Deze lijst toont de opgeslagen importmetadata en geeft toegang tot het originele ING-bestand wanneer het vanaf nu is opgeslagen.
      </p>
      {error ? <p className="rounded-2xl bg-[#f7e9e4] p-4 text-sm text-[#7b4b3a]">{error}</p> : null}
      {!error && batches.length ? (
        <div className="space-y-3">
          {batches.map((batch) => (
            <div key={batch.id} className="rounded-[1.25rem] bg-[#f5f1ea] p-4 text-sm text-[#574b3f]">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-[#251f1a]">{batch.filename}</p>
                  <p className="text-xs text-[#7d6d5a]">{formatImportDate(batch.completedAt ?? batch.startedAt)} · {translateImportStatus(batch.status)}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-[#fbf8f2] px-3 py-1">{batch.importedRows} nieuw</span>
                  <span className="rounded-full bg-[#fbf8f2] px-3 py-1">{batch.autoCategorizedRows} automatisch</span>
                  <span className="rounded-full bg-[#fbf8f2] px-3 py-1">{batch.reviewRows} te beoordelen</span>
                  <span className="rounded-full bg-[#fbf8f2] px-3 py-1">{batch.duplicateRows} dubbel</span>
                  <span className="rounded-full bg-[#fbf8f2] px-3 py-1">{formatFileSize(batch.fileSizeBytes)}</span>
                  <span className="rounded-full bg-[#fbf8f2] px-3 py-1">hash {shortHash(batch.fileSha256)}</span>
                  {batch.hasOriginalFile ? <a href={getImportBatchDownloadUrl(batch.id)} className="rounded-full bg-[#1f5f4a] px-3 py-1 text-[#fbf8f2]">Download origineel</a> : <span className="rounded-full bg-[#fff7df] px-3 py-1 text-[#7a5512]">geen bestand</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {!error && !batches.length ? <p className="rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Nog geen imports gevonden.</p> : null}
    </section>
  );
}

function AuditLogPreview() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuditLogs(10)
      .then((entries) => {
        if (!cancelled) {
          setLogs(entries);
          setError(null);
        }
      })
      .catch((auditError) => {
        if (!cancelled) {
          setError(auditError instanceof Error ? auditError.message : 'De auditlog kon niet worden geladen.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">Auditlog</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Laatste wijzigingen</h3>
      {error ? <p className="mt-4 rounded-2xl bg-[#f7e9e4] p-4 text-sm text-[#7b4b3a]">{error}</p> : null}
      {!error && logs.length ? (
        <div className="mt-5 space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-[1.25rem] bg-[#f5f1ea] p-4 text-sm text-[#574b3f]">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <p className="font-semibold text-[#251f1a]">{translateAuditAction(log.action)}</p>
                <p className="text-xs text-[#8a7965]">{new Date(log.createdAt).toLocaleString('nl-NL')}</p>
              </div>
              <p className="mt-1 text-xs text-[#7d6d5a]">
                {log.actorEmail ?? log.actorId ?? 'Onbekende gebruiker'} · {log.entityType}{log.entityId ? ` ${log.entityId.slice(0, 8)}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {!error && !logs.length ? (
        <p className="mt-4 rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Nog geen wijzigingen gelogd.</p>
      ) : null}
    </section>
  );
}

function GuardrailList() {
  const items = [
    'ING-import is de normale bron van waarheid.',
    'Dubbele transacties worden genegeerd bij import.',
    'Transacties zonder volledige match komen in Te beoordelen.',
    'Handmatige correcties horen niet in de dagelijkse workflow.',
    'Rapporten zijn pas publiceerbaar na handmatige controle.',
  ];

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">Veiligheid</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Foolproof regels</h3>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div key={item} className="flex gap-3 rounded-[1.25rem] bg-[#f5f1ea] p-4 text-sm text-[#574b3f]">
            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[#1f5f4a] text-center text-xs font-bold leading-5 text-[#fbf8f2]">✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Reference data panels ────────────────────────────────────────────────

function ProjectsPanel({ admin }: { admin: boolean }) {
  const [items, setItems] = useState<ReferenceProjectItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const load = () => {
    fetchReferenceProjects()
      .then((data) => { setItems(data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Laden mislukt.'));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!admin) return;
    setBusy(true);
    try {
      await createReferenceProject({ code: newCode.trim(), name: newName.trim() });
      setNewCode('');
      setNewName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aanmaken mislukt.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: ReferenceProjectItem) => {
    if (!admin) return;
    setBusy(true);
    try {
      await updateReferenceProject(item.id, { isActive: !item.isActive });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bijwerken mislukt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">Referentiedata</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Klanten</h3>
      {!admin && <p className="mt-3 rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Alleen beheerders kunnen klanten beheren.</p>}
      {admin && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap gap-2">
          <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Code (bijv. YA)" className="rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 text-sm" />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Naam" className="rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 text-sm flex-1 min-w-[160px]" />
          <button type="submit" disabled={busy || !newCode.trim() || !newName.trim()} className="rounded-xl bg-[#1f5f4a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Toevoegen</button>
        </form>
      )}
      {error && <p className="mt-3 rounded-xl bg-[#f7e9e4] p-3 text-sm text-[#7b4b3a]">{error}</p>}
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.id} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${item.isActive ? 'bg-[#f5f1ea]' : 'bg-[#fdf5f5] opacity-60'}`}>
            <span><span className="font-mono text-xs text-[#8a7965] mr-2">{item.code}</span>{item.name}{item.isHistorical ? <span className="ml-2 text-xs text-[#8a7965]">(historisch)</span> : null}</span>
            {admin && (
              <button type="button" disabled={busy} onClick={() => toggle(item)} className="ml-3 rounded-full border border-[#d7cdbf] px-2 py-0.5 text-xs font-semibold text-[#6f6253] disabled:opacity-40">
                {item.isActive ? 'Deactiveren' : 'Activeren'}
              </button>
            )}
          </div>
        ))}
        {!items.length && <p className="rounded-xl bg-[#f5f1ea] p-3 text-sm text-[#6f6253]">Nog geen projecten.</p>}
      </div>
    </section>
  );
}

function CategoriesPanel({ admin, onItemsLoaded }: { admin: boolean; onItemsLoaded: (items: ReferenceCategoryItem[]) => void }) {
  const [items, setItems] = useState<ReferenceCategoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const currentItems = items.filter((item) => item.isActive);
  const archivedItems = items.filter((item) => !item.isActive);

  const load = () => {
    fetchReferenceCategories()
      .then((data) => { setItems(data); onItemsLoaded(data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Laden mislukt.'));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!admin) return;
    setBusy(true);
    try {
      await createReferenceCategory({ name: newName.trim() });
      setNewName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aanmaken mislukt.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: ReferenceCategoryItem) => {
    if (!admin) return;
    setBusy(true);
    try {
      await updateReferenceCategory(item.id, { isActive: !item.isActive });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bijwerken mislukt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">Referentiedata</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Categorieën beheren</h3>
      {!admin && <p className="mt-3 rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Alleen beheerders kunnen categorieën beheren.</p>}
      {admin && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Categorie-naam" className="rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 text-sm flex-1 min-w-[160px]" />
          <button type="submit" disabled={busy || !newName.trim()} className="rounded-xl bg-[#1f5f4a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Toevoegen</button>
        </form>
      )}
      {error && <p className="mt-3 rounded-xl bg-[#f7e9e4] p-3 text-sm text-[#7b4b3a]">{error}</p>}
      <div className="mt-4 space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-[#7d6d5a]">Actieve categorieën · {currentItems.length}</p>
        {currentItems.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-xl bg-[#f5f1ea] px-3 py-2 text-sm">
            <span>{item.name}{item.isHistorical ? <span className="ml-2 text-xs text-[#8a7965]">(historisch)</span> : null}</span>
            {admin && (
              <button type="button" disabled={busy} onClick={() => toggle(item)} className="ml-3 rounded-full border border-[#d7cdbf] px-2 py-0.5 text-xs font-semibold text-[#6f6253] disabled:opacity-40">
                Deactiveren
              </button>
            )}
          </div>
        ))}
        {!currentItems.length && <p className="rounded-xl bg-[#f5f1ea] p-3 text-sm text-[#6f6253]">Geen actieve categorieën.</p>}
        {archivedItems.length > 0 && (
          <details className="rounded-xl border border-[#ded5c8] bg-[#fbf8f2] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[#6f6253]">Historisch of gedeactiveerd · {archivedItems.length}</summary>
            <div className="mt-3 space-y-2">
              {archivedItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl bg-[#f5f1ea] px-3 py-2 text-sm opacity-75">
                  <span>{item.name}{item.isHistorical ? <span className="ml-2 text-xs text-[#8a7965]">(historisch)</span> : null}</span>
                  {admin && (
                    <button type="button" disabled={busy} onClick={() => toggle(item)} className="ml-3 rounded-full border border-[#d7cdbf] px-2 py-0.5 text-xs font-semibold text-[#6f6253] disabled:opacity-40">
                      {item.isActive ? 'Deactiveren' : 'Activeren'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function TransactionTypesPanel({ admin }: { admin: boolean }) {
  const [items, setItems] = useState<ReferenceTransactionTypeItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDirection, setNewDirection] = useState<'credit' | 'debit' | 'both'>('both');

  const load = () => {
    fetchReferenceTransactionTypes()
      .then((data) => { setItems(data); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Laden mislukt.'));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!admin) return;
    setBusy(true);
    try {
      await createReferenceTransactionType({
        literalName: newName.trim(),
        direction: newDirection === 'both' ? null : newDirection,
      });
      setNewName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aanmaken mislukt.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: ReferenceTransactionTypeItem) => {
    if (!admin) return;
    setBusy(true);
    try {
      await updateReferenceTransactionType(item.id, { isActive: !item.isActive });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bijwerken mislukt.');
    } finally {
      setBusy(false);
    }
  };

  const directionLabel = (d: 'credit' | 'debit' | null) =>
    d === 'credit' ? 'Bijschrijving' : d === 'debit' ? 'Afschrijving' : null;

  return (
    <section className="rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">Referentiedata</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Transactietypes</h3>
      {!admin && <p className="mt-3 rounded-2xl bg-[#f5f1ea] p-4 text-sm text-[#6f6253]">Alleen beheerders kunnen transactietypes beheren.</p>}
      {admin && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Type-naam (literal)" className="rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 text-sm flex-1 min-w-[160px]" />
          <select value={newDirection} onChange={(e) => setNewDirection(e.target.value as 'credit' | 'debit' | 'both')} className="rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 text-sm">
            <option value="both">Beide richtingen</option>
            <option value="credit">Bijschrijving (credit)</option>
            <option value="debit">Afschrijving (debit)</option>
          </select>
          <button type="submit" disabled={busy || !newName.trim()} className="rounded-xl bg-[#1f5f4a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Toevoegen</button>
        </form>
      )}
      {error && <p className="mt-3 rounded-xl bg-[#f7e9e4] p-3 text-sm text-[#7b4b3a]">{error}</p>}
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item.id} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${item.isActive ? 'bg-[#f5f1ea]' : 'bg-[#fdf5f5] opacity-60'}`}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{item.literalName}</span>
              {item.direction
                ? <span className="text-xs text-[#8a7965]">{directionLabel(item.direction)}</span>
                : <span className="rounded-full bg-[#edf5ec] px-2 py-0.5 text-xs font-semibold text-[#1f5f4a]">Beide richtingen</span>}
              {item.isHistorical ? <span className="text-xs text-[#8a7965]">(historisch)</span> : null}
            </span>
            {admin && (
              <button type="button" disabled={busy} onClick={() => toggle(item)} className="ml-3 rounded-full border border-[#d7cdbf] px-2 py-0.5 text-xs font-semibold text-[#6f6253] disabled:opacity-40">
                {item.isActive ? 'Deactiveren' : 'Activeren'}
              </button>
            )}
          </div>
        ))}
        {!items.length && <p className="rounded-xl bg-[#f5f1ea] p-3 text-sm text-[#6f6253]">Nog geen transactietypes. Voeg er minimaal één toe voor elke richting om transacties te kunnen beoordelen.</p>}
      </div>
    </section>
  );
}

function OperatorToolsPanel({ admin }: { admin: boolean }) {
  const [dirResult, setDirResult] = useState<DirectionInferenceResponse | null>(null);
  const [propResult, setPropResult] = useState<OwnerHistoryProposalResponse | null>(null);
  const [dirConfirmHash, setDirConfirmHash] = useState('');
  const [propConfirmHash, setPropConfirmHash] = useState('');
  const [dirBusy, setDirBusy] = useState(false);
  const [propBusy, setPropBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [propError, setPropError] = useState<string | null>(null);
  const [categoryResult, setCategoryResult] = useState<CategoryNormalizationResponse | null>(null);
  const [categoryConfirmHash, setCategoryConfirmHash] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryMappingSource, setCategoryMappingSource] = useState('');
  const [categoryMappingTarget, setCategoryMappingTarget] = useState('');
  const [rollbackOperationId, setRollbackOperationId] = useState('');
  const [rollbackResult, setRollbackResult] = useState<CategoryNormalizationResponse | null>(null);
  const [rollbackConfirmHash, setRollbackConfirmHash] = useState('');

  useEffect(() => {
    if (!admin) return;
    postDirectionInferenceDryRun()
      .then((r) => setDirResult(r))
      .catch((e) => setDirError(e instanceof Error ? e.message : 'Laden mislukt.'));
    postOwnerHistoryProposalDryRun()
      .then((r) => setPropResult(r))
      .catch((e) => setPropError(e instanceof Error ? e.message : 'Laden mislukt.'));
    postCategoryNormalizationAction({ action: 'dry-run' })
      .then((r) => setCategoryResult(r))
      .catch((e) => setCategoryError(e instanceof Error ? e.message : 'Laden mislukt.'));
  }, [admin]);

  const runDirDryRun = async () => {
    setDirBusy(true); setDirError(null);
    try { setDirResult(await postDirectionInferenceDryRun()); }
    catch (e) { setDirError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setDirBusy(false); }
  };

  const runDirExecute = async () => {
    if (!dirConfirmHash.trim()) return;
    setDirBusy(true); setDirError(null);
    try { setDirResult(await postDirectionInferenceExecute(dirConfirmHash.trim())); setDirConfirmHash(''); }
    catch (e) { setDirError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setDirBusy(false); }
  };

  const runPropDryRun = async () => {
    setPropBusy(true); setPropError(null);
    try { setPropResult(await postOwnerHistoryProposalDryRun()); }
    catch (e) { setPropError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setPropBusy(false); }
  };

  const runPropExecute = async () => {
    if (!propConfirmHash.trim()) return;
    setPropBusy(true); setPropError(null);
    try { setPropResult(await postOwnerHistoryProposalExecute(propConfirmHash.trim())); setPropConfirmHash(''); }
    catch (e) { setPropError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setPropBusy(false); }
  };

  const runCategoryDryRun = async () => {
    setCategoryBusy(true); setCategoryError(null); setCategoryConfirmHash('');
    try { setCategoryResult(await postCategoryNormalizationAction({ action: 'dry-run', mappings: categoryMappings })); }
    catch (e) { setCategoryError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setCategoryBusy(false); }
  };

  const runCategoryExecute = async () => {
    if (!categoryResult || categoryConfirmHash.trim() !== categoryResult.planHash) return;
    setCategoryBusy(true); setCategoryError(null);
    try {
      const result = await postCategoryNormalizationAction({ action: 'apply', confirmedPlanHash: categoryConfirmHash.trim(), mappings: categoryMappings });
      setCategoryResult(result);
      setCategoryConfirmHash('');
      if (result.operationId) setRollbackOperationId(result.operationId);
    } catch (e) { setCategoryError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setCategoryBusy(false); }
  };

  const categoryMappings = categoryMappingSource.trim() && categoryMappingTarget.trim()
    ? [{ sourceName: categoryMappingSource.trim(), targetName: categoryMappingTarget.trim() }]
    : [];

  const changeCategoryMapping = (source: string, target: string) => {
    setCategoryMappingSource(source);
    setCategoryMappingTarget(target);
    setCategoryResult(null);
    setCategoryConfirmHash('');
  };

  const runRollbackDryRun = async () => {
    if (!rollbackOperationId.trim()) return;
    setCategoryBusy(true); setCategoryError(null); setRollbackConfirmHash('');
    try { setRollbackResult(await postCategoryNormalizationAction({ action: 'rollback-dry-run', operationId: rollbackOperationId.trim() })); }
    catch (e) { setCategoryError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setCategoryBusy(false); }
  };

  const runRollback = async () => {
    if (!rollbackResult || rollbackConfirmHash.trim() !== rollbackResult.planHash) return;
    setCategoryBusy(true); setCategoryError(null);
    try { setRollbackResult(await postCategoryNormalizationAction({ action: 'rollback', operationId: rollbackOperationId.trim(), confirmedPlanHash: rollbackConfirmHash.trim() })); setRollbackConfirmHash(''); }
    catch (e) { setCategoryError(e instanceof Error ? e.message : 'Mislukt.'); }
    finally { setCategoryBusy(false); }
  };

  if (!admin) return null;

  return (
    <section className="rounded-[2rem] border border-amber-300 bg-[#fffdf5] p-6 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
      <p className="text-sm font-medium text-[#7d6d5a]">Beheerder – eenmalige operaties</p>
      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Operatortools</h3>
      <p className="mt-2 text-sm leading-6 text-[#6f6253]">
        Voer altijd eerst een dry-run uit. Kopieer de planhash naar het bevestigingsveld en klik daarna uitvoeren. Elke uitvoer is gecontroleerd idempotent.
      </p>

      {/* Historical category normalization */}
      <CategoryNormalizationControls
        busy={categoryBusy}
        error={categoryError}
        result={categoryResult}
        confirmHash={categoryConfirmHash}
        onConfirmHash={setCategoryConfirmHash}
        onDryRun={runCategoryDryRun}
        onExecute={runCategoryExecute}
        operationId={rollbackOperationId}
        onOperationId={setRollbackOperationId}
        rollbackResult={rollbackResult}
        rollbackConfirmHash={rollbackConfirmHash}
        onRollbackConfirmHash={setRollbackConfirmHash}
        onRollbackDryRun={runRollbackDryRun}
        onRollback={runRollback}
        mappingSource={categoryMappingSource}
        mappingTarget={categoryMappingTarget}
        onMappingChange={changeCategoryMapping}
      />

      {/* Direction inference */}
      <div className="mt-6 rounded-[1.5rem] border border-[#ded5c8] bg-[#fbf8f2] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Richtingsinferentie transactietypes</p>
            <p className="text-xs text-[#7d6d5a]">Past alleen ondubbelzinnige richtingen toe op types zonder richting.</p>
          </div>
          <button type="button" disabled={dirBusy} onClick={runDirDryRun} className="rounded-xl border border-[#d7cdbf] px-3 py-1.5 text-xs font-semibold text-[#574b3f] disabled:opacity-40">
            {dirBusy ? 'Laden…' : 'Dry-run vernieuwen'}
          </button>
        </div>
        {dirError && <p className="mt-3 rounded-xl bg-[#f7e9e4] p-3 text-sm text-[#7b4b3a]">{dirError}</p>}
        {dirResult && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-3 rounded-xl bg-[#f5f1ea] px-3 py-2">
              <span>Ondubbelzinnig: <strong>{dirResult.counts.unambiguous}</strong></span>
              <span>Conflicterend: <strong>{dirResult.counts.conflicting}</strong></span>
              <span>Onbekend: <strong>{dirResult.counts.unknown}</strong></span>
              <span>Ongebruikt: <strong>{dirResult.counts.unused}</strong></span>
              {dirResult.updatedCount !== undefined && <span>Bijgewerkt: <strong>{dirResult.updatedCount}</strong></span>}
            </div>
            <div className="rounded-xl bg-[#f5f1ea] px-3 py-2">
              <span className="text-xs text-[#8a7965]">Status: </span>
              <span className={`text-xs font-semibold ${dirResult.status === 'APPLIED' ? 'text-[#1f5f4a]' : dirResult.status === 'HASH_DRIFT' ? 'text-[#914f35]' : 'text-[#574b3f]'}`}>{dirResult.status}</span>
              <span className="ml-3 text-xs text-[#8a7965]">Plan hash: </span>
              <code className="text-[10px] break-all">{dirResult.planHash}</code>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={dirConfirmHash}
                onChange={(e) => setDirConfirmHash(e.target.value)}
                placeholder="Plak planhash ter bevestiging"
                className="flex-1 min-w-[200px] rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                disabled={dirBusy || !dirConfirmHash.trim() || dirConfirmHash.trim() !== dirResult.planHash}
                onClick={runDirExecute}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Uitvoeren
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Owner-history proposals */}
      <div className="mt-4 rounded-[1.5rem] border border-[#ded5c8] bg-[#fbf8f2] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Eigenaar-historische suggesties</p>
            <p className="text-xs text-[#7d6d5a]">Zaait CategorizatieSuggesties voor open transacties op basis van HISTORICAL-boekingen.</p>
          </div>
          <button type="button" disabled={propBusy} onClick={runPropDryRun} className="rounded-xl border border-[#d7cdbf] px-3 py-1.5 text-xs font-semibold text-[#574b3f] disabled:opacity-40">
            {propBusy ? 'Laden…' : 'Dry-run vernieuwen'}
          </button>
        </div>
        {propError && <p className="mt-3 rounded-xl bg-[#f7e9e4] p-3 text-sm text-[#7b4b3a]">{propError}</p>}
        {propResult && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-3 rounded-xl bg-[#f5f1ea] px-3 py-2">
              <span>Open tx: <strong>{propResult.counts.openTransactions}</strong></span>
              <span>Gedekt: <strong>{propResult.counts.covered}</strong></span>
              <span>Ongedekt: <strong>{propResult.counts.uncovered}</strong></span>
              <span>Onthouden: <strong>{propResult.counts.abstainedWeak}</strong></span>
              {propResult.createdSuggestionCount !== undefined && <span>Aangemaakt: <strong>{propResult.createdSuggestionCount}</strong></span>}
            </div>
            <div className="rounded-xl bg-[#f5f1ea] px-3 py-2">
              <span className="text-xs text-[#8a7965]">Status: </span>
              <span className={`text-xs font-semibold ${propResult.status === 'CREATED' ? 'text-[#1f5f4a]' : propResult.status === 'HASH_DRIFT' ? 'text-[#914f35]' : 'text-[#574b3f]'}`}>{propResult.status}</span>
              <span className="ml-3 text-xs text-[#8a7965]">Plan hash: </span>
              <code className="text-[10px] break-all">{propResult.planHash}</code>
            </div>
            <p className="text-xs text-[#8a7965]">
              Bewijs: {propResult.provenanceProof.evidenceBookingsLoadedFromSource} · Kwalificeert voor confirmedHistoryEligibility: {propResult.provenanceProof.qualifiesUnderConfirmedHistoryEligibilityService ? 'ja' : 'nee'} · Uitsluitingsreden: {propResult.provenanceProof.exclusionReason}
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={propConfirmHash}
                onChange={(e) => setPropConfirmHash(e.target.value)}
                placeholder="Plak planhash ter bevestiging"
                className="flex-1 min-w-[200px] rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                disabled={propBusy || !propConfirmHash.trim() || propConfirmHash.trim() !== propResult.planHash}
                onClick={runPropExecute}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Uitvoeren
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatMinorUnits(value: string): string {
  const minor = BigInt(value);
  const sign = minor < 0n ? '-' : '';
  const absolute = minor < 0n ? -minor : minor;
  return `${sign}€ ${(absolute / 100n).toLocaleString('nl-NL')},${String(absolute % 100n).padStart(2, '0')}`;
}

function CategoryNormalizationControls(props: {
  busy: boolean;
  error: string | null;
  result: CategoryNormalizationResponse | null;
  confirmHash: string;
  onConfirmHash: (value: string) => void;
  onDryRun: () => void;
  onExecute: () => void;
  operationId: string;
  onOperationId: (value: string) => void;
  rollbackResult: CategoryNormalizationResponse | null;
  rollbackConfirmHash: string;
  onRollbackConfirmHash: (value: string) => void;
  onRollbackDryRun: () => void;
  onRollback: () => void;
  mappingSource: string;
  mappingTarget: string;
  onMappingChange: (source: string, target: string) => void;
}) {
  const summary = props.result?.summary && 'labels' in props.result.summary
    ? props.result.summary as CategoryNormalizationSummary
    : null;
  return (
    <div className="mt-6 rounded-[1.5rem] border border-[#ded5c8] bg-[#fbf8f2] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Historische categorieën normaliseren</p>
          <p className="text-xs text-[#7d6d5a]">Kapitaliseert bestaande labels, voegt case-duplicaten en hieronder exact opgegeven categorieën samen en archiveert ongebruikte categorieën zonder historische rapporten te wijzigen.</p>
        </div>
        <button type="button" disabled={props.busy} onClick={props.onDryRun} className="rounded-xl border border-[#d7cdbf] px-3 py-1.5 text-xs font-semibold text-[#574b3f] disabled:opacity-40">
          {props.busy ? 'Laden…' : 'Dry-run vernieuwen'}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[#6f6253]">Optionele exacte samenvoeging:</span>
        <input aria-label="Broncategorie voor samenvoeging" disabled={props.busy} value={props.mappingSource} onChange={(event) => props.onMappingChange(event.target.value, props.mappingTarget)} placeholder="Bronlabel" className="min-w-[150px] rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 disabled:opacity-50" />
        <span>→</span>
        <input aria-label="Doelcategorie voor samenvoeging" disabled={props.busy} value={props.mappingTarget} onChange={(event) => props.onMappingChange(props.mappingSource, event.target.value)} placeholder="Doellabel" className="min-w-[150px] rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 disabled:opacity-50" />
      </div>
      {props.error && <p className="mt-3 rounded-xl bg-[#f7e9e4] p-3 text-sm text-[#7b4b3a]">{props.error}</p>}
      {props.result && summary && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap gap-3 rounded-xl bg-[#f5f1ea] px-3 py-2">
            <span>Transacties: <strong>{summary.transactionCount}</strong></span>
            <span>Inkomsten: <strong>{formatMinorUnits(summary.incomeMinor)}</strong></span>
            <span>Uitgaven: <strong>{formatMinorUnits(summary.expenseMinor)}</strong></span>
            <span>Netto: <strong>{formatMinorUnits(summary.netMinor)}</strong></span>
            <span>Categorieën bijgewerkt: <strong>{summary.categoryChangeCount}</strong></span>
            <span>Samenvoegingen: <strong>{summary.mergeCategoryCount}</strong></span>
            <span>Regels: <strong>{summary.ruleCount}</strong></span>
            <span>Suggesties: <strong>{summary.suggestionCount}</strong></span>
            <span>Te archiveren: <strong>{summary.retireCategoryCount}</strong></span>
          </div>
          <div className="rounded-xl bg-[#f5f1ea] px-3 py-2 text-xs">
            <span className="text-[#8a7965]">Status: </span><strong>{props.result.status}</strong>
            <span className="ml-3 text-[#8a7965]">SHA-256 planhash: </span><code className="break-all">{props.result.planHash}</code>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#ded5c8]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f5f1ea] text-[#6f6253]"><tr><th className="p-2">Huidig label</th><th className="p-2">Doel</th><th className="p-2">Aantal</th><th className="p-2">Per jaar</th><th className="p-2">Netto</th></tr></thead>
              <tbody>{summary.labels.map((label) => (
                <tr key={label.from} className="border-t border-[#ded5c8]">
                  <td className="p-2">{label.from}</td><td className="p-2">{label.to}{label.merge ? ' (samenvoegen)' : ''}</td><td className="p-2">{label.transactionCount}</td>
                  <td className="p-2">{Object.entries(label.countByYear).sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => `${year}: ${count} · ${formatMinorUnits(label.netByYearMinor[year] ?? '0')}`).join(' · ') || '—'}</td><td className="p-2">{formatMinorUnits(label.netMinor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {summary.emptyCategories.some((category) => category.willDeactivate) && (
            <details className="rounded-xl border border-[#ded5c8] bg-[#f5f1ea] p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Ongebruikte categorieën die worden gearchiveerd · {summary.emptyCategories.filter((category) => category.willDeactivate).length}</summary>
              <ul className="mt-2 space-y-1 text-[#6f6253]">
                {summary.emptyCategories.filter((category) => category.willDeactivate).map((category) => <li key={category.name}>{category.name}</li>)}
              </ul>
            </details>
          )}
          <p className="text-xs text-[#7d6d5a]">
            Bankfeiten en bevroren rapporten blijven ongewijzigd. Boekingsbron, regel en historische match blijven behouden; elke bijgewerkte boeking krijgt een auditregel. Alleen als de bestaande beslissingshistorie de huidige bevestigde boeking volledig ondersteunt, wordt ook een aanvullende wijzigingsbeslissing vastgelegd.
          </p>
          {props.result.blockers?.length ? <ul className="rounded-xl bg-[#f7e9e4] p-3 text-xs text-[#7b4b3a]">{props.result.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
          {props.result.status === 'DRY_RUN_COMPLETE' && !props.result.writesPerformed && (
            <div className="flex flex-wrap gap-2">
              <input value={props.confirmHash} onChange={(event) => props.onConfirmHash(event.target.value)} placeholder="Plak planhash ter bevestiging" className="min-w-[220px] flex-1 rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 font-mono text-xs" />
              <button type="button" disabled={props.busy || props.confirmHash.trim() !== props.result.planHash} onClick={props.onExecute} className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Normaliseren</button>
            </div>
          )}
          {props.result.operationId && <p className="rounded-xl bg-[#edf5ec] p-3 text-xs text-[#1f5f4a]">Uitgevoerd · rollback-id: <code className="break-all">{props.result.operationId}</code></p>}
          {(props.operationId || props.result.operationId) && (
            <div className="space-y-2 rounded-xl border border-[#ded5c8] p-3">
              <p className="text-xs font-semibold">Rollback (nieuwe, geauditeerde omkering)</p>
              <div className="flex flex-wrap gap-2">
                <input value={props.operationId} onChange={(event) => props.onOperationId(event.target.value)} placeholder="Rollback-id" className="min-w-[220px] flex-1 rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 font-mono text-xs" />
                <button type="button" disabled={props.busy || !props.operationId.trim()} onClick={props.onRollbackDryRun} className="rounded-xl border border-[#d7cdbf] px-3 py-2 text-xs font-semibold">Rollback dry-run</button>
              </div>
              {props.rollbackResult && <div className="space-y-2 text-xs"><p>Status: <strong>{props.rollbackResult.status}</strong> · Planhash: <code className="break-all">{props.rollbackResult.planHash}</code></p>{props.rollbackResult.blockers?.length ? <p className="text-[#914f35]">{props.rollbackResult.blockers.join(' · ')}</p> : null}
                {props.rollbackResult.status === 'ROLLBACK_DRY_RUN_COMPLETE' && <div className="flex flex-wrap gap-2"><input value={props.rollbackConfirmHash} onChange={(event) => props.onRollbackConfirmHash(event.target.value)} placeholder="Plak rollback-hash" className="min-w-[220px] flex-1 rounded-xl border border-[#d7cdbf] bg-white px-3 py-2 font-mono text-xs" /><button type="button" disabled={props.busy || props.rollbackConfirmHash.trim() !== props.rollbackResult.planHash} onClick={props.onRollback} className="rounded-xl border border-[#914f35] px-4 py-2 text-xs font-semibold text-[#914f35] disabled:opacity-40">Rollback uitvoeren</button></div>}
              </div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FinanceSettingsPage() {
  const { summary } = useLedger();
  const admin = isClientAdmin();
  const [referenceCategories, setReferenceCategories] = useState<ReferenceCategoryItem[] | null>(null);

  return (
    <FinanceAppFrame reviewCount={summary.reviewCount} activeHref="/settings">
      <header className="mb-6 rounded-[2rem] border border-[#ded5c8] bg-[#fbf8f2] p-5 shadow-[0_24px_70px_rgba(87,67,45,0.08)]">
        <p className="text-sm font-medium text-[#7d6d5a]">Instellingen</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-[-0.05em] md:text-4xl">Beheer zonder rommel</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f6253]">Deze pagina toont de instellingen die belangrijk zijn voor de administratie. Gevaarlijke acties blijven bewust buiten de normale workflow.</p>
      </header>

      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SettingCard title="Gebruikers" body="De app blijft privé. Clerk verzorgt de aanmelding; actieve workspace-lidmaatschappen bepalen de lees- en beheermachtigingen." status="Actief" />
          <SettingCard title="E-mailupdates" body="Maandelijkse financiële samenvattingen blijven via Resend lopen en zijn versimpeld naar finance-only e-mails." status="Actief" />
          <SettingCard title="Beheermodus" body="Handmatig wijzigen of verwijderen van transacties hoort later achter een aparte veilige beheermodus, niet in het normale dashboard." status="Gepland" />
        </section>

        <ProjectsPanel admin={admin} />
        <CategoriesPanel admin={admin} onItemsLoaded={setReferenceCategories} />
        <TransactionTypesPanel admin={admin} />
        <CategoryOverview categories={referenceCategories} />
        <ImportHistoryPanel />
        <EmailRecipientsPanel />
        <OperatorToolsPanel admin={admin} />
        <AuditLogPreview />
        <GuardrailList />
      </div>
    </FinanceAppFrame>
  );
}
