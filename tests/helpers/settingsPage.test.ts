import { describe, expect, it } from 'vitest';
import {
  formatFileSize,
  formatImportDate,
  isReviewPlaceholderCategory,
  normalizeCategoryLabel,
  shortHash,
  translateAuditAction,
  translateImportStatus,
} from '../../src/helpers/settings-page';

describe('settings page helpers', () => {
  it('normalizes category labels and hides internal review placeholders', () => {
    expect(normalizeCategoryLabel('  Review  ')).toBe('review');
    expect(normalizeCategoryLabel(null)).toBe('');
    expect(isReviewPlaceholderCategory({ id: 'cat-review', name: 'Administratief' })).toBe(true);
    expect(isReviewPlaceholderCategory({ id: 'sub-review-needs-category', name: 'Te doen' })).toBe(true);
    expect(isReviewPlaceholderCategory({ id: 'custom', name: 'Needs manual categorization' })).toBe(true);
    expect(isReviewPlaceholderCategory({ id: 'income', name: 'Inkomsten' })).toBe(false);
  });

  it('formats import dates and file sizes for Dutch settings UI', () => {
    expect(formatImportDate(null)).toBe('Nog niet afgerond');
    expect(formatImportDate('2026-05-15T12:30:00.000Z')).toContain('2026');
    expect(formatFileSize(null)).toBe('onbekende grootte');
    expect(formatFileSize(0)).toBe('onbekende grootte');
    expect(formatFileSize(512)).toBe('512 bytes');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('shortens retained file hashes safely', () => {
    expect(shortHash(null)).toBe('geen hash');
    expect(shortHash('1234567890abcdef')).toBe('1234567890…');
  });

  it('translates import statuses while preserving unknown values', () => {
    expect(translateImportStatus('completed')).toBe('voltooid');
    expect(translateImportStatus('pending')).toBe('bezig');
    expect(translateImportStatus('failed')).toBe('mislukt');
    expect(translateImportStatus('archived')).toBe('archived');
  });

  it('translates finance audit actions while preserving unknown values', () => {
    expect(translateAuditAction('transaction.category.updated')).toBe('Categorie van transactie aangepast');
    expect(translateAuditAction('categorizationRule.created')).toBe('Categorisatieregel aangemaakt');
    expect(translateAuditAction('ledger.locked')).toBe('Maand vergrendeld');
    expect(translateAuditAction('openingBalance.updated')).toBe('Beginbalans aangepast');
    expect(translateAuditAction('emailRecipient.deactivated')).toBe('E-mailontvanger uitgeschakeld');
    expect(translateAuditAction('emailRecipient.activated')).toBe('E-mailontvanger ingeschakeld');
    expect(translateAuditAction('emailRecipient.deleted')).toBe('E-mailontvanger verwijderd');
    expect(translateAuditAction('unknown.action')).toBe('unknown.action');
  });
});
