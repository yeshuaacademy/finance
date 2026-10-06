import { buildLimitQuery, buildReconciliationQuery, buildReportSummaryQuery, encodeApiPathSegment } from '@/helpers/api-client';

const rawEnvBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

const resolveApiBaseUrl = (): string => {
  if (rawEnvBase && rawEnvBase.length > 0) {
    return rawEnvBase.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'http://localhost:4000';
};

const API_BASE_URL = resolveApiBaseUrl();
export type ClientRole = 'admin' | 'viewer';
// The server derives the actual role from Clerk plus workspace membership.
// This value is UI-only and never authorizes an API request.
export const getClientRole = (): ClientRole => 'admin';
export const isClientAdmin = () => getClientRole() === 'admin';

export type ReviewEvidenceStatus = 'finalized' | 'review_suggested' | 'conflict' | 'unmatched';

export type ReviewDimensionCandidate = {
  projectId: string | null;
  projectCode: string | null;
  projectLabel: string | null;
  transactionTypeId: string | null;
  transactionTypeLabel: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  complete: boolean;
};

export type ReviewEvidenceAlternative = ReviewDimensionCandidate & {
  suggestionId: string;
  rank: number;
  matcher: string;
  confidence: string;
  confidenceLabel: string;
  reason: string;
  matchedRuleIds: string[];
  historicalRecordIds: string[];
  evidenceHashes: string[];
  evidenceHash: string;
  producerKey: string | null;
  producerVersion: string | null;
  scoreBasisPoints: number | null;
  eligible: boolean;
};

export type PrefillSource =
  | 'AUTHORITATIVE_TRANSACTION'
  | 'EXISTING_BOOKING'
  | 'OWNER_HISTORY_V2'
  | 'LEGACY_HISTORY_FALLBACK'
  | 'NONE';

export type ReviewPrefillMetadata = {
  source: PrefillSource;
  complete: boolean;
  weakFallback: boolean;
  scoreBasisPoints: number | null;
  confidence: string | null;
  matcher: string | null;
};

export type EvidenceRichReviewItem = {
  id: string;
  transactionId: string;
  previewFingerprint: string | null;
  displayDate: string;
  rawIngDate: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  accountIdentifier: string | null;
  accountName: string | null;
  amount: number;
  amountMinor: string;
  currency: string;
  direction: 'credit' | 'debit';
  directionLabel: string;
  description: string;
  paymentPurpose: string | null;
  source: string;
  deterministicStatus: ReviewEvidenceStatus;
  statusLabel: string;
  reason: string;
  proposed: ReviewDimensionCandidate | null;
  prefill: ReviewPrefillMetadata;
  alternatives: ReviewEvidenceAlternative[];
  evidence: {
    matchedRuleIds: string[];
    historicalRecordIds: string[];
    evidenceHashes: string[];
    importFingerprint: string | null;
    exactReplayKey: string | null;
    reason: string;
  };
  safeDeterministicCandidate: boolean;
  requiresAdministratorApproval: true;
  sideEffects: {
    createsTransactionBooking: false;
    closesPeriod: false;
  };
};

export type ReviewCategoryOption = {
  id: string;
  name: string;
};

export type ReviewProjectOption = {
  id: string;
  code: string;
  name: string;
};

export type ReviewTransactionTypeOption = {
  id: string;
  literalName: string;
  direction: 'credit' | 'debit' | null;
};

export type ReviewPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type ReviewQuery = {
  page?: number;
  pageSize?: 25 | 50 | 100;
  confidence?: 'green' | 'amber' | 'red' | 'gray' | null;
  direction?: 'credit' | 'debit' | null;
  projectId?: string | null;
  categoryId?: string | null;
  state?: 'all' | 'incomplete';
};

export type EvidenceRichReviewResponse = {
  transactions: EvidenceRichReviewItem[];
  categories: ReviewCategoryOption[];
  projects: ReviewProjectOption[];
  transactionTypes: ReviewTransactionTypeOption[];
  pagination: ReviewPagination;
  message: string;
};

const getApiUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
};

const withUserHeader = (init: RequestInit = {}): RequestInit => {
  return { ...init, credentials: 'include' };
};

export const fetchLedger = async () => {
  const response = await fetch(getApiUrl('/api/ledger'), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    throw new Error('Het grootboek kon niet worden geladen.');
  }

  return response.json();
};

export const buildReviewQueryString = ({
  page = 1,
  pageSize = 25,
  confidence = null,
  direction = null,
  projectId = null,
  categoryId = null,
  state = 'all',
}: ReviewQuery = {}): string => {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (confidence) query.set('confidence', confidence);
  if (direction) query.set('direction', direction);
  if (projectId) query.set('projectId', projectId);
  if (categoryId) query.set('categoryId', categoryId);
  if (state !== 'all') query.set('state', state);
  return query.toString();
};

export const fetchReview = async (query: ReviewQuery = {}): Promise<EvidenceRichReviewResponse> => {
  const response = await fetch(getApiUrl(`/api/review?${buildReviewQueryString(query)}`), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    throw new Error('De beoordelingsrij kon niet worden geladen.');
  }

  return response.json();
};

export const clearReviewQueue = async () => {
  const response = await fetch(getApiUrl('/api/review/clear'), withUserHeader({
    method: 'POST',
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'De beoordelingsrij kon niet worden afgerond.' }));
    throw new Error(error.error ?? 'De beoordelingsrij kon niet worden afgerond.');
  }

  return response.json();
};

export const uploadImportFile = async (formData: FormData) => {
  const response = await fetch(getApiUrl('/api/upload'), withUserHeader({
    method: 'POST',
    body: formData,
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'De import is niet gelukt. Controleer het bestand en probeer het opnieuw.',
    }));
    throw new Error(error.error ?? 'De import is niet gelukt. Controleer het bestand en probeer het opnieuw.');
  }

  return response.json();
};

export const uploadStatementPackage = async (csv: File | null, pdf: File | null, periodKey?: string) => {
  const formData = new FormData();
  if (csv) formData.append('csv', csv);
  if (pdf) formData.append('pdf', pdf);
  if (periodKey) formData.append('periodKey', periodKey);

  const response = await fetch(getApiUrl('/api/statements/import'), withUserHeader({
    method: 'POST',
    body: formData,
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'Het maandafschrift kon niet veilig worden verwerkt.',
    }));
    throw new Error(error.error ?? 'Het maandafschrift kon niet veilig worden verwerkt.');
  }

  return response.json();
};

export const updateCategory = async (id: string, payload: {
  categoryId?: string | null;
  categoryName?: string;
  projectId?: string | null;
  transactionTypeId?: string | null;
  reason?: string | null;
}) => {
  const response = await fetch(getApiUrl(`/api/transactions/${encodeApiPathSegment(id)}/category`), withUserHeader({
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'De boeking kon niet worden bijgewerkt.' }));
    throw new Error(error.error ?? 'De boeking kon niet worden bijgewerkt.');
  }

  return response.json();
};

export const fetchAccounts = async () => {
  const response = await fetch(getApiUrl('/api/accounts'), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    throw new Error('Rekeningen konden niet worden geladen.');
  }

  return response.json();
};

export const saveOpeningBalance = async (accountId: string, payload: {
  effectiveDate: string;
  amount: number | string;
  currency?: string;
  note?: string;
}) => {
  const response = await fetch(getApiUrl(`/api/accounts/${encodeApiPathSegment(accountId)}/opening-balance`), withUserHeader({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Beginbalans kon niet worden opgeslagen.' }));
    throw new Error(error.error ?? 'Beginbalans kon niet worden opgeslagen.');
  }

  return response.json();
};

export const lockOpeningBalance = async (balanceId: string) => {
  const response = await fetch(getApiUrl(`/api/opening-balances/${encodeApiPathSegment(balanceId)}/lock`), withUserHeader({
    method: 'POST',
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Beginbalans kon niet worden vergrendeld.' }));
    throw new Error(error.error ?? 'Beginbalans kon niet worden vergrendeld.');
  }

  return response.json();
};

export const fetchReconciliation = async (params: {
  accountId: string;
  month?: number;
  year?: number;
  start?: string;
  end?: string;
}) => {
  const response = await fetch(getApiUrl(`/api/reconciliation?${buildReconciliationQuery(params)}`), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Reconciliatiegegevens konden niet worden geladen.' }));
    throw new Error(error.error ?? 'Reconciliatiegegevens konden niet worden geladen.');
  }

  return response.json();
};

export const lockLedgerPeriod = async (ledgerId: string, payload?: { note?: string }) => {
  const response = await fetch(getApiUrl(`/api/ledger/${encodeApiPathSegment(ledgerId)}/lock`), withUserHeader({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Maand kon niet worden vergrendeld.' }));
    throw new Error(error.error ?? 'Maand kon niet worden vergrendeld.');
  }

  return response.json();
};

export const unlockLedgerPeriod = async (ledgerId: string) => {
  const response = await fetch(getApiUrl(`/api/ledger/${encodeApiPathSegment(ledgerId)}/unlock`), withUserHeader({
    method: 'POST',
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Maand kon niet worden ontgrendeld.' }));
    throw new Error(error.error ?? 'Maand kon niet worden ontgrendeld.');
  }

  return response.json();
};

type RulePayload = {
  label: string;
  pattern?: string;
  categoryId: string;
  matchType?: string;
  matchField?: string;
  conditions?: unknown;
  priority?: number;
  isActive?: boolean;
};

export type RuleCreationCondition = {
  field: 'payee' | 'counterparty' | 'description' | 'paymentPurpose' | 'amount' | 'source' | 'reference';
  matchType: 'contains' | 'startsWith' | 'endsWith' | 'equals' | 'regex';
  value: string;
};

export type RuleCreationPreviewPayload = {
  reviewDecisionId?: string | null;
  projectId: string;
  transactionTypeId: string;
  categoryId: string;
  label?: string | null;
  conditions: RuleCreationCondition[];
  confidence?: string | null;
};

export type RuleCreationPreview = {
  transactionId: string;
  reviewDecisionId: string | null;
  label: string;
  conditions: RuleCreationCondition[];
  expected: {
    projectId: string;
    projectLabel: string;
    transactionTypeId: string;
    transactionTypeLabel: string;
    categoryId: string;
    categoryLabel: string;
  } | null;
  matchedTransactionIds: string[];
  activationAllowed: boolean;
  rejectionReasons: string[];
  previewHash: string;
  sideEffects: {
    createsTransactionBooking: false;
    closesPeriod: false;
  };
};

export type RuleCreationActivationPayload = RuleCreationPreviewPayload & {
  previewHash: string;
  explicitConfirmation: true;
};

export type RuleCreationActivationResponse = {
  rule: unknown;
  preview: RuleCreationPreview;
  sideEffects: {
    createsTransactionBooking: false;
    closesPeriod: false;
  };
};

export const fetchCategorizationRules = async () => {
  const response = await fetch(getApiUrl('/api/rules'), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    throw new Error('Categorisatieregels konden niet worden geladen.');
  }

  return response.json();
};

export const createCategorizationRule = async (payload: RulePayload) => {
  const response = await fetch(getApiUrl('/api/rules'), withUserHeader({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Categorisatieregel kon niet worden gemaakt.' }));
    throw new Error(error.error ?? 'Categorisatieregel kon niet worden gemaakt.');
  }

  return response.json();
};

export const updateCategorizationRule = async (id: string, payload: Partial<RulePayload>) => {
  const response = await fetch(getApiUrl(`/api/rules/${encodeApiPathSegment(id)}`), withUserHeader({
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Categorisatieregel kon niet worden bijgewerkt.' }));
    throw new Error(error.error ?? 'Categorisatieregel kon niet worden bijgewerkt.');
  }

  return response.json();
};

export const previewReviewRuleCreation = async (
  transactionId: string,
  payload: RuleCreationPreviewPayload,
): Promise<RuleCreationPreview> => {
  const response = await fetch(getApiUrl(`/api/review/${encodeApiPathSegment(transactionId)}/rule/preview`), withUserHeader({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Regelvoorbeeld kon niet worden opgebouwd.' }));
    throw new Error(error.error ?? 'Regelvoorbeeld kon niet worden opgebouwd.');
  }

  return response.json();
};

export const activateReviewRuleCreation = async (
  transactionId: string,
  payload: RuleCreationActivationPayload,
): Promise<RuleCreationActivationResponse> => {
  const response = await fetch(getApiUrl(`/api/review/${encodeApiPathSegment(transactionId)}/rule/activate`), withUserHeader({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Regel kon niet worden geactiveerd.' }));
    throw new Error(error.error ?? 'Regel kon niet worden geactiveerd.');
  }

  return response.json();
};

export const deleteCategorizationRule = async (id: string): Promise<void> => {
  const response = await fetch(getApiUrl(`/api/rules/${encodeApiPathSegment(id)}`), withUserHeader({
    method: 'DELETE',
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Categorisatieregel kon niet worden verwijderd.' }));
    throw new Error(error.error ?? 'Categorisatieregel kon niet worden verwijderd.');
  }

  return;
};

export const previewRule = async (id: string, scope: 'review-queue' | { importBatchId: string }) => {
  const url = getApiUrl(`/api/rules/${encodeApiPathSegment(id)}/preview`);
  const response = await fetch(url, withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scope === 'review-queue' ? { scope } : { scope: 'import-batch', importBatchId: scope.importBatchId }),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Voorbeeld van regel kon niet worden geladen.' }));
    console.error('Voorbeeld van regel kon niet worden geladen', { url, status: response.status, error });
    throw new Error(error.error ?? 'Voorbeeld van regel kon niet worden geladen.');
  }

  return response.json();
};

export const applyRule = async (id: string, transactionIds: string[]) => {
  const url = getApiUrl(`/api/rules/${encodeApiPathSegment(id)}/apply`);
  const response = await fetch(url, withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionIds }),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Categorisatieregel kon niet worden toegepast.' }));
    console.error('Categorisatieregel kon niet worden toegepast', { url, status: response.status, error });
    throw new Error(error.error ?? 'Categorisatieregel kon niet worden toegepast.');
  }

  return response.json();
};


export const fetchReportSummary = async (params: { year: number; month?: number | null }) => {
  const response = await fetch(getApiUrl(`/api/reports/summary?${buildReportSummaryQuery(params)}`), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Het rapport kon niet worden geladen.' }));
    throw new Error(error.error ?? 'Het rapport kon niet worden geladen.');
  }

  return response.json();
};

export type AuditLogEntry = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
};

export const fetchAuditLogs = async (limit = 25): Promise<AuditLogEntry[]> => {
  const response = await fetch(getApiUrl(`/api/audit-log?${buildLimitQuery(limit)}`), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'De auditlog kon niet worden geladen.' }));
    throw new Error(error.error ?? 'De auditlog kon niet worden geladen.');
  }

  return response.json();
};

export type EmailRecipient = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const fetchEmailRecipients = async (): Promise<EmailRecipient[]> => {
  const response = await fetch(getApiUrl('/api/email-recipients'), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'E-mailontvangers konden niet worden geladen.' }));
    throw new Error(error.error ?? 'E-mailontvangers konden niet worden geladen.');
  }

  return response.json();
};

export const saveEmailRecipient = async (payload: { email: string; name?: string | null }): Promise<EmailRecipient> => {
  const response = await fetch(getApiUrl('/api/email-recipients'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'E-mailontvanger kon niet worden opgeslagen.' }));
    throw new Error(error.error ?? 'E-mailontvanger kon niet worden opgeslagen.');
  }

  return response.json();
};

export const deactivateEmailRecipient = async (id: string): Promise<EmailRecipient> => {
  const response = await fetch(getApiUrl(`/api/email-recipients/${encodeApiPathSegment(id)}`), withUserHeader({ method: 'DELETE' }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'E-mailontvanger kon niet worden gedeactiveerd.' }));
    throw new Error(error.error ?? 'E-mailontvanger kon niet worden gedeactiveerd.');
  }

  return response.json();
};

export const activateEmailRecipient = async (id: string): Promise<EmailRecipient> => {
  const response = await fetch(getApiUrl(`/api/email-recipients/${encodeApiPathSegment(id)}/activate`), withUserHeader({ method: 'POST' }));
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'E-mailontvanger kon niet worden ingeschakeld.' }));
    throw new Error(error.error ?? 'E-mailontvanger kon niet worden ingeschakeld.');
  }
  return response.json();
};

export const removeEmailRecipient = async (id: string): Promise<void> => {
  const response = await fetch(getApiUrl(`/api/email-recipients/${encodeApiPathSegment(id)}/remove`), withUserHeader({ method: 'POST' }));
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'E-mailontvanger kon niet worden verwijderd.' }));
    throw new Error(error.error ?? 'E-mailontvanger kon niet worden verwijderd.');
  }
};

export type ImportBatchSummary = {
  id: string;
  filename: string;
  fileType: string | null;
  status: 'pending' | 'completed' | 'failed';
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  errorRows: number;
  fileSizeBytes: number | null;
  fileSha256: string | null;
  hasOriginalFile: boolean;
  autoCategorizedRows: number;
  reviewRows: number;
  startedAt: string;
  completedAt: string | null;
};

export const fetchImportBatches = async (limit = 25): Promise<ImportBatchSummary[]> => {
  const response = await fetch(getApiUrl(`/api/import-batches?${buildLimitQuery(limit)}`), withUserHeader({ cache: 'no-store' }));

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Importgeschiedenis kon niet worden geladen.' }));
    throw new Error(error.error ?? 'Importgeschiedenis kon niet worden geladen.');
  }

  return response.json();
};

export const getImportBatchDownloadUrl = (id: string): string =>
  getApiUrl(`/api/import-batches/${encodeApiPathSegment(id)}/download`);




export type MerchantKnowledgeSideEffects = {
  readOnly: true;
  createsTransactionBooking: false;
  mutatesBankFacts: false;
};

export type MerchantKnowledgeSummaryResponse = MerchantKnowledgeSideEffects & {
  workspaceId: string;
  counts: {
    merchants: number;
    aliases: number;
    fingerprints: number;
    openConflicts: number;
  };
};

export type MerchantKnowledgeMerchantListItem = {
  id: string;
  canonicalName: string;
  status: 'PROPOSED' | 'ACTIVE' | 'CONFLICTED' | 'MERGED' | 'DEPRECATED';
  version: number;
  mergedIntoMerchantId: string | null;
  counts: { aliases: number; fingerprints: number; resolutions: number };
  createdAt: string;
  updatedAt: string;
};

export type MerchantKnowledgeMerchantListResponse = MerchantKnowledgeSideEffects & {
  merchants: MerchantKnowledgeMerchantListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  filters: { status: string | null; query: string | null };
};

export type MerchantKnowledgeEvidenceItem = {
  id: string;
  signalType: string;
  status: string;
  valueHash: string;
  evidenceHash: string;
  displayValue: string | null;
  createdAt: string;
  normalizationVersion?: string;
  extractionVersion?: string;
  confidenceBasisPoints?: number | null;
  strength?: string;
};

export type MerchantKnowledgeMerchantDetailResponse = MerchantKnowledgeSideEffects & {
  merchant: null | {
    id: string;
    canonicalName: string;
    status: string;
    version: number;
    mergedIntoMerchantId: string | null;
    createdAt: string;
    updatedAt: string;
    aliases: MerchantKnowledgeEvidenceItem[];
    fingerprints: MerchantKnowledgeEvidenceItem[];
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.json().catch((): null => null) as { error?: string } | null;
    throw new Error(payload?.error ?? 'API request failed.');
  }
  return response.json() as Promise<T>;
};

export const fetchMerchantKnowledgeSummary = async (): Promise<MerchantKnowledgeSummaryResponse> =>
  readJson(await fetch(getApiUrl('/api/merchant-knowledge/summary'), withUserHeader({ cache: 'no-store' })));

export const fetchMerchantKnowledgeMerchants = async (input: {
  page?: number;
  pageSize?: 25 | 50 | 100;
  status?: MerchantKnowledgeMerchantListItem['status'] | null;
  query?: string | null;
} = {}): Promise<MerchantKnowledgeMerchantListResponse> => {
  const params = new URLSearchParams();
  if (input.page !== undefined) params.set('page', String(input.page));
  if (input.pageSize !== undefined) params.set('pageSize', String(input.pageSize));
  if (input.status) params.set('status', input.status);
  if (input.query) params.set('query', input.query);
  const suffix = params.size ? `?${params.toString()}` : '';
  return readJson(await fetch(getApiUrl(`/api/merchant-knowledge/merchants${suffix}`), withUserHeader({ cache: 'no-store' })));
};

export const fetchMerchantKnowledgeMerchantDetail = async (
  merchantId: string,
): Promise<MerchantKnowledgeMerchantDetailResponse> =>
  readJson(await fetch(
    getApiUrl(`/api/merchant-knowledge/merchants/${encodeApiPathSegment(merchantId)}`),
    withUserHeader({ cache: 'no-store' }),
  ));

export type MerchantKnowledgePreviewAction =
  | 'MERGE_MERCHANTS'
  | 'SPLIT_MERCHANT'
  | 'RESOLVE_CONFLICT'
  | 'REASSIGN_KNOWLEDGE'
  | 'DEPRECATE_ALIAS'
  | 'DEPRECATE_MERCHANT';

export type MerchantKnowledgePreviewRequest = {
  action: MerchantKnowledgePreviewAction;
  reason: string;
  requestKey: string;
  targetMerchantId?: string;
  sourceMerchantIds?: string[];
  sourceMerchantId?: string;
  plannedMerchantIds?: string[];
  affectedAliasIds?: string[];
  affectedFingerprintIds?: string[];
  assignments?: Array<{ merchantId: string; aliasIds: string[]; fingerprintIds: string[] }>;
  conflictId?: string;
  intent?: 'SELECT_MERCHANT' | 'ABSTAIN' | 'DISMISS';
  selectedMerchantId?: string;
  aliasId?: string;
  merchantId?: string;
};

export type MerchantKnowledgePreviewResponse = {
  action: MerchantKnowledgePreviewAction;
  planVersion: string;
  planHash: string;
  beforeState: unknown;
  afterState: unknown;
  affectedEntityIds: string[];
  evidenceRefs: Array<{
    recordType: 'ALIAS' | 'FINGERPRINT';
    recordId: string;
    evidenceHash: string;
  }>;
  merchantStateRefs: Array<{
    merchantId: string;
    stateHash: string;
  }>;
  conflictStateRefs: Array<{
    conflictId: string;
    stateHash: string;
    evidenceHash: string;
    candidateMerchantIds: string[];
    supportingEvidenceCount: number;
    conflictingEvidenceCount: number;
  }>;
  warnings: string[];
  blockingErrors: Array<{ code: string; message: string }>;
  rollbackSteps: Array<{
    recordType: 'MERCHANT' | 'ALIAS' | 'FINGERPRINT' | 'CONFLICT';
    recordId: string;
    restore: Record<string, string | null>;
  }>;
  previewOnly: true;
  readOnly: true;
  createsTransactionBooking: false;
  mutatesBankFacts: false;
  persistsMerchantKnowledge: false;
};

export const previewMerchantKnowledgePlan = async (
  request: MerchantKnowledgePreviewRequest,
): Promise<MerchantKnowledgePreviewResponse> =>
  readJson(await fetch(getApiUrl('/api/merchant-knowledge/plans/preview'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })));

export type MerchantAliasDeprecationConfirmationRequest = {
  action: 'DEPRECATE_ALIAS';
  planVersion: string;
  planHash: string;
  expectedEvidenceHash: string;
  reason: string;
  requestKey: string;
};

export type MerchantAliasDeprecationConfirmationResponse = {
  decisionId: string;
  auditEventId: string;
  aliasId: string;
  priorStatus: string;
  newStatus: 'DEPRECATED';
  deprecatedAt: string;
  planVersion: string;
  planHash: string;
  evidenceHash: string;
  rollbackReference: {
    decisionId: string;
    steps: MerchantKnowledgePreviewResponse['rollbackSteps'];
  };
  idempotent: boolean;
  confirmed: true;
  action: 'DEPRECATE_ALIAS';
  persistsMerchantKnowledge: true;
  writesMerchantIdentityDecision: true;
  writesMerchantAuditEvent: true;
  createsTransactionBooking: false;
  mutatesBankFacts: false;
  mutatesFinancialRecords: false;
};

export const confirmMerchantAliasDeprecation = async (
  aliasId: string,
  request: MerchantAliasDeprecationConfirmationRequest,
): Promise<MerchantAliasDeprecationConfirmationResponse> =>
  readJson(await fetch(
    getApiUrl(`/api/merchant-knowledge/aliases/${encodeApiPathSegment(aliasId)}/deprecate/confirm`),
    withUserHeader({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  ));

export type MerchantDeprecationConfirmationRequest = {
  action: 'DEPRECATE_MERCHANT';
  planVersion: string;
  planHash: string;
  expectedStateHash: string;
  reason: string;
  requestKey: string;
};

export type MerchantDeprecationConfirmationResponse = {
  decisionId: string;
  auditEventId: string;
  merchantId: string;
  priorStatus: string;
  newStatus: 'DEPRECATED';
  priorVersion: number;
  newVersion: number;
  deprecatedAt: string;
  planVersion: string;
  planHash: string;
  stateHash: string;
  evidenceHash: string;
  rollbackReference: {
    decisionId: string;
    steps: MerchantKnowledgePreviewResponse['rollbackSteps'];
  };
  idempotent: boolean;
  confirmed: true;
  action: 'DEPRECATE_MERCHANT';
  persistsMerchantKnowledge: true;
  writesMerchantIdentityDecision: true;
  writesMerchantAuditEvent: true;
  cascadesAliases: false;
  cascadesFingerprints: false;
  createsTransactionBooking: false;
  mutatesBankFacts: false;
  mutatesFinancialRecords: false;
};

export const confirmMerchantDeprecation = async (
  merchantId: string,
  request: MerchantDeprecationConfirmationRequest,
): Promise<MerchantDeprecationConfirmationResponse> =>
  readJson(await fetch(
    getApiUrl(`/api/merchant-knowledge/merchants/${encodeApiPathSegment(merchantId)}/deprecate/confirm`),
    withUserHeader({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  ));



export type MerchantConflictIntent = 'SELECT_MERCHANT' | 'ABSTAIN' | 'DISMISS';

export type MerchantConflictConfirmationRequest = {
  action: 'RESOLVE_CONFLICT';
  intent: MerchantConflictIntent;
  selectedMerchantId?: string;
  planVersion: string;
  planHash: string;
  conflictStateHash: string;
  conflictEvidenceHash: string;
  reason: string;
  requestKey: string;
};

export type MerchantConflictConfirmationResponse = {
  decisionId: string;
  auditEventId: string;
  resolutionId: string | null;
  conflictId: string;
  intent: MerchantConflictIntent;
  selectedMerchantId: string | null;
  priorStatus: 'OPEN';
  newStatus: 'RESOLVED' | 'DISMISSED';
  resolvedAt: string;
  planVersion: string;
  planHash: string;
  conflictStateHash: string;
  evidenceHash: string;
  idempotent: boolean;
  confirmed: true;
  action: 'RESOLVE_CONFLICT';
  persistsMerchantKnowledge: true;
  writesMerchantResolution: true;
  writesMerchantIdentityDecision: true;
  writesMerchantAuditEvent: true;
  trustsAliases: false;
  trustsFingerprints: false;
  mutatesMerchants: false;
  createsTransactionBooking: false;
  mutatesBankFacts: false;
  mutatesFinancialRecords: false;
};

export const confirmMerchantConflictResolution = async (
  conflictId: string,
  request: MerchantConflictConfirmationRequest,
): Promise<MerchantConflictConfirmationResponse> =>
  readJson(await fetch(
    getApiUrl(`/api/merchant-knowledge/conflicts/${encodeApiPathSegment(conflictId)}/resolve/confirm`),
    withUserHeader({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  ));

// ─── Reference data ─────────────────────────────────────────────────────────

export type ReferenceProjectItem = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isHistorical: boolean;
};

export type ReferenceCategoryItem = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number | null;
  isActive: boolean;
  isHistorical: boolean;
};

export type ReferenceTransactionTypeItem = {
  id: string;
  literalName: string;
  direction: 'credit' | 'debit' | null;
  sortOrder: number | null;
  isActive: boolean;
  isHistorical: boolean;
};

export const fetchReferenceProjects = async (): Promise<ReferenceProjectItem[]> => {
  const res = await fetch(getApiUrl('/api/reference-data/projects'), withUserHeader({ cache: 'no-store' }));
  if (!res.ok) throw new Error('Projecten konden niet worden geladen.');
  const data = await res.json() as { items: ReferenceProjectItem[] };
  return data.items;
};

export const createReferenceProject = async (payload: { code: string; name: string }): Promise<ReferenceProjectItem> =>
  readJson(await fetch(getApiUrl('/api/reference-data/projects'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

export const updateReferenceProject = async (id: string, payload: { name?: string; isActive?: boolean }): Promise<ReferenceProjectItem> =>
  readJson(await fetch(getApiUrl(`/api/reference-data/projects/${encodeApiPathSegment(id)}`), withUserHeader({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

export const fetchReferenceCategories = async (): Promise<ReferenceCategoryItem[]> => {
  const res = await fetch(getApiUrl('/api/reference-data/categories'), withUserHeader({ cache: 'no-store' }));
  if (!res.ok) throw new Error('Categorieën konden niet worden geladen.');
  const data = await res.json() as { items: ReferenceCategoryItem[] };
  return data.items;
};

export const createReferenceCategory = async (payload: { name: string; color?: string; sortOrder?: number }): Promise<ReferenceCategoryItem> =>
  readJson(await fetch(getApiUrl('/api/reference-data/categories'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

export const updateReferenceCategory = async (id: string, payload: { name?: string; color?: string; sortOrder?: number; isActive?: boolean }): Promise<ReferenceCategoryItem> =>
  readJson(await fetch(getApiUrl(`/api/reference-data/categories/${encodeApiPathSegment(id)}`), withUserHeader({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

export const fetchReferenceTransactionTypes = async (): Promise<ReferenceTransactionTypeItem[]> => {
  const res = await fetch(getApiUrl('/api/reference-data/transaction-types'), withUserHeader({ cache: 'no-store' }));
  if (!res.ok) throw new Error('Transactietypes konden niet worden geladen.');
  const data = await res.json() as { items: ReferenceTransactionTypeItem[] };
  return data.items;
};

export const createReferenceTransactionType = async (payload: { literalName: string; direction: 'credit' | 'debit' | null; sortOrder?: number }): Promise<ReferenceTransactionTypeItem> =>
  readJson(await fetch(getApiUrl('/api/reference-data/transaction-types'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

export const updateReferenceTransactionType = async (id: string, payload: { literalName?: string; direction?: 'credit' | 'debit'; sortOrder?: number; isActive?: boolean }): Promise<ReferenceTransactionTypeItem> =>
  readJson(await fetch(getApiUrl(`/api/reference-data/transaction-types/${encodeApiPathSegment(id)}`), withUserHeader({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

// ─── Operator tools ───────────────────────────────────────────────────────────

export type DirectionInferenceCounts = {
  unambiguous: number;
  conflicting: number;
  unknown: number;
  unused: number;
  total: number;
};

export type DirectionInferenceResponse = {
  status: 'DRY_RUN_COMPLETE' | 'APPLIED' | 'HASH_DRIFT' | 'EXECUTION_NOT_ALLOWED' | 'CONFIRMATION_REQUIRED';
  dryRun: boolean;
  writesPerformed: boolean;
  updatedCount?: number;
  skippedAlreadySetCount?: number;
  algorithmVersion: string;
  planHash: string;
  counts: DirectionInferenceCounts;
  sideEffects: { writesPerformed: false };
};

export type OwnerHistoryProposalCounts = {
  evidenceCandidates: number;
  disqualifiedIncomplete: number;
  disqualifiedCrossWorkspace: number;
  disqualifiedInactiveOrUnauthorizedTriple: number;
  disqualifiedMissingSourceDirection: number;
  eligibleEvidence: number;
  openTransactions: number;
  covered: number;
  uncovered: number;
  abstainedWeak: number;
  abstainedMissingTargetDirection: number;
  abstainedNoFactualDirectionMatch: number;
  abstainedNoRankedCandidate: number;
  abstained: number;
};

export type TransactionTypeDirectionUsageAuditResponse = {
  status: 'DRY_RUN_COMPLETE';
  dryRun: true;
  writesPerformed: false;
  algorithmVersion: string;
  scopeHash: string;
  reportHash: string;
  totals: { historicalEvidence: number; bucketUsageCount: number; debitCount: number; creditCount: number; unknownCount: number };
  buckets: Array<{ anonymousKey: string; historicalUsageCount: number; debitCount: number; creditCount: number; unknownCount: number; classification: 'single-direction' | 'mixed-direction' | 'unknown-only' | 'unused' }>;
};

export type OwnerHistoryProposalResponse = {
  status: 'DRY_RUN_COMPLETE' | 'CREATED' | 'HASH_DRIFT' | 'EXECUTION_NOT_ALLOWED' | 'CONFIRMATION_REQUIRED';
  dryRun: boolean;
  writesPerformed: boolean;
  expiredSuggestionCount?: number;
  createdSuggestionCount?: number;
  algorithmVersion: string;
  planHash: string;
  counts: OwnerHistoryProposalCounts;
  matcherDistribution: Record<string, number>;
  confidenceDistribution: Record<string, number>;
  persistence: {
    producerKey: 'owner-history';
    producerVersion: 'v2';
    rankPersistence: 'RANK_1_ONLY';
    existingOwnedSuggestionCount: number;
    plannedCreateCount: number;
    plannedExpirationCount: number;
    ownershipStateHash: string;
  };
  provenanceProof: {
    evidenceBookingsLoadedFromSource: string;
    reviewDecisionRequired: boolean;
    qualifiesUnderConfirmedHistoryEligibilityService: boolean;
    exclusionReason: string;
  };
};

export const postDirectionInferenceDryRun = async (): Promise<DirectionInferenceResponse> =>
  readJson(await fetch(getApiUrl('/api/operator/direction-inference'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execute: false }),
  })));

export const postDirectionInferenceExecute = async (confirmedPlanHash: string): Promise<DirectionInferenceResponse> =>
  readJson(await fetch(getApiUrl('/api/operator/direction-inference'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execute: true, confirmedPlanHash }),
  })));

export const postOwnerHistoryProposalDryRun = async (): Promise<OwnerHistoryProposalResponse> =>
  readJson(await fetch(getApiUrl('/api/operator/owner-history-proposals'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execute: false }),
  })));

export const postOwnerHistoryProposalExecute = async (confirmedPlanHash: string): Promise<OwnerHistoryProposalResponse> =>
  readJson(await fetch(getApiUrl('/api/operator/owner-history-proposals'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execute: true, confirmedPlanHash }),
  })));

export type CategoryNormalizationSummary = {
  categoryCount: number;
  categoryChangeCount: number;
  mergeCategoryCount: number;
  transactionCount: number;
  bookingCount: number;
  ruleCount: number;
  suggestionCount: number;
  retireCategoryCount: number;
  blockedTransactionCount: number;
  countByYear: Record<string, number>;
  incomeMinor: string;
  expenseMinor: string;
  netMinor: string;
  emptyCategories: Array<{ name: string; referenceCount: number; isActive: boolean; willDeactivate: boolean }>;
  labels: Array<{
    from: string;
    to: string;
    transactionCount: number;
    merge: boolean;
    countByYear: Record<string, number>;
    netByYearMinor: Record<string, string>;
    incomeMinor: string;
    expenseMinor: string;
    netMinor: string;
  }>;
};

export type CategoryNormalizationResponse = {
  status: string;
  dryRun?: boolean;
  writesPerformed: boolean;
  operationId?: string;
  planHash: string;
  summary: CategoryNormalizationSummary | {
    transactionCount: number;
    categoryCount: number;
    ruleCount: number;
    suggestionCount: number;
    writesPerformed: false;
  };
  blockers?: string[];
  decisionCount?: number;
  auditEntryCount?: number;
};

export const postCategoryNormalizationAction = async (payload: {
  action: 'dry-run' | 'apply' | 'rollback-dry-run' | 'rollback';
  confirmedPlanHash?: string;
  operationId?: string;
  mappings?: Array<{ sourceName: string; targetName: string }>;
}): Promise<CategoryNormalizationResponse> =>
  readJson(await fetch(getApiUrl('/api/operator/category-normalization'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })));

export const postTransactionTypeDirectionUsageAudit = async (): Promise<TransactionTypeDirectionUsageAuditResponse> =>
  readJson(await fetch(getApiUrl('/api/operator/transaction-type-direction-usage-audit'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })));

// ─── Reports — monthly send ───────────────────────────────────────────────────

export type MonthlySendReportRequest = {
  year: number;
  month: number;
  confirmed: true;
};

export type MonthlySendReportResponse = {
  status: 'SENT' | 'FAILED';
  month: string;
  recipientCount: number;
  snapshotId: string;
  dispatchId: string;
};

export const sendMonthlyReport = async (request: MonthlySendReportRequest): Promise<MonthlySendReportResponse> =>
  readJson(await fetch(getApiUrl('/api/reports/monthly/send'), withUserHeader({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })));
