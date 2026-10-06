import type { ImportBatchSummary } from '@/libs/api';

export const normalizeCategoryLabel = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

export const isReviewPlaceholderCategory = (category: { id: string; name: string }) => {
  const normalized = normalizeCategoryLabel(category.name);
  return (
    category.id === 'cat-review' ||
    category.id === 'sub-review-needs-category' ||
    normalized === 'review' ||
    normalized === 'needs review' ||
    normalized === 'needs manual categorization'
  );
};

export const formatImportDate = (value: string | null) => {
  if (!value) return 'Nog niet afgerond';
  return new Date(value).toLocaleString('nl-NL');
};

export const formatFileSize = (bytes: number | null) => {
  if (!bytes || bytes <= 0) return 'onbekende grootte';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const shortHash = (value: string | null) => (value ? `${value.slice(0, 10)}…` : 'geen hash');

export const translateImportStatus = (status: ImportBatchSummary['status'] | string) => {
  switch (status) {
    case 'completed':
      return 'voltooid';
    case 'pending':
      return 'bezig';
    case 'failed':
      return 'mislukt';
    default:
      return status;
  }
};

export const translateAuditAction = (action: string) => {
  switch (action) {
    case 'transaction.category.updated':
      return 'Categorie van transactie aangepast';
    case 'categorizationRule.created':
      return 'Categorisatieregel aangemaakt';
    case 'categorizationRule.updated':
      return 'Categorisatieregel aangepast';
    case 'categorizationRule.applied':
      return 'Categorisatieregel toegepast';
    case 'categorizationRule.deleted':
      return 'Categorisatieregel verwijderd';
    case 'ledger.locked':
      return 'Maand vergrendeld';
    case 'ledger.unlocked':
      return 'Maand ontgrendeld';
    case 'openingBalance.created':
      return 'Beginbalans aangemaakt';
    case 'openingBalance.updated':
      return 'Beginbalans aangepast';
    case 'openingBalance.locked':
      return 'Beginbalans vergrendeld';
    case 'emailRecipient.created':
      return 'E-mailontvanger toegevoegd';
    case 'emailRecipient.updated':
      return 'E-mailontvanger aangepast';
    case 'emailRecipient.deactivated':
      return 'E-mailontvanger uitgeschakeld';
    case 'emailRecipient.activated':
      return 'E-mailontvanger ingeschakeld';
    case 'emailRecipient.deleted':
      return 'E-mailontvanger verwijderd';
    default:
      return action;
  }
};
