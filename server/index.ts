import './loadEnv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { handleImportUpload, handleMonthlyImportPreviewUpload, handleStatementPackageImport } from './routes/upload';
import { getLedger } from './routes/ledger';
import {
  activateReviewRuleCreation,
  clearReviewQueue,
  getReviewTransactions,
  previewReviewRuleCreation,
  updateTransactionCategory,
} from './routes/review';
import { listAccounts, lockOpeningBalance, upsertOpeningBalance } from './routes/accounts';
import { getReconciliation } from './routes/reconciliation';
import { lockLedger, unlockLedger } from './routes/ledgers';
import { getReportSummary } from './routes/reports';
import { getAccountingAuditReport } from './routes/accountingAudit';
import { postOpeningBalanceRepair } from './routes/openingBalanceRepair';
import { postSuggestionBackfill } from './routes/suggestionBackfill';
import { getSuggestionEvaluation } from './routes/suggestionEvaluation';
import { listAuditLogs } from './routes/audit';
import { downloadImportBatchFile, listImportBatches } from './routes/importBatches';
import { activateEmailRecipient, deactivateEmailRecipient, listEmailRecipients, removeEmailRecipient, upsertEmailRecipient } from './routes/emailRecipients';
import {
  confirmMerchantAliasDeprecationRoute,
  confirmMerchantConflictResolutionRoute,
  confirmMerchantDeprecationRoute,
  getMerchantKnowledgeMerchantDetailRoute,
  getMerchantKnowledgeSummaryRoute,
  listMerchantKnowledgeMerchantsRoute,
  previewMerchantKnowledgePlanRoute,
} from './routes/merchantKnowledge';
import { getRules, postRule, patchRule, removeRule, previewRule, applyRule } from './routes/rules';
import { getStatementReconciliationPreview } from './routes/statementReconciliationPreview';
import { getMonthlyClosePreview } from './routes/monthlyClosePreview';
import { postStrictPeriodClose } from './routes/strictPeriodClose';
import { postAuditedPeriodReopen } from './routes/auditedPeriodReopen';
import {
  getMonthlyReportPreview,
  postMonthlyReportSnapshot,
  postYearlyReportSnapshot,
  postReportArtifacts,
  postApproveReportSnapshot,
  postPrepareReportDispatch,
} from './routes/reportSnapshots';
import { ensureCategorizationRuleConditionsColumn } from './db/ensureCategorizationRuleConditions';
import { authenticateExpressRequest } from './auth/requestContext';
import {
  listProjects, createProject, updateProject,
  listCategories, createCategory, updateCategory as updateCategoryRecord,
  listTransactionTypes, createTransactionType, updateTransactionType,
} from './routes/referenceData';
import { postDirectionInference, postOwnerHistoryProposals, postTransactionTypeDirectionUsageAudit } from './routes/operatorTools';
import { postCategoryNormalization } from './routes/categoryNormalization';
import { postMonthlySendReport } from './routes/monthlySendReport';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', authenticateExpressRequest);

app.post('/api/upload', upload.single('file'), handleImportUpload);
app.post('/api/upload/preview', upload.single('file'), handleMonthlyImportPreviewUpload);
app.post('/api/statements/import', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
]), handleStatementPackageImport);
app.get('/api/ledger', getLedger);
app.get('/api/review', getReviewTransactions);
app.post('/api/review/clear', clearReviewQueue);
app.post('/api/review/:id/rule/preview', previewReviewRuleCreation);
app.post('/api/review/:id/rule/activate', activateReviewRuleCreation);
app.patch('/api/transactions/:id/category', updateTransactionCategory);
app.get('/api/accounts', listAccounts);
app.post('/api/accounts/:accountId/opening-balance', upsertOpeningBalance);
app.post('/api/opening-balances/:balanceId/lock', lockOpeningBalance);
app.get('/api/reconciliation', getReconciliation);
app.get('/api/reports/summary', getReportSummary);
app.get('/api/accounting/audit', getAccountingAuditReport);
app.post('/api/accounting/opening-balance/repair', postOpeningBalanceRepair);
app.post('/api/categorization/suggestions/backfill', postSuggestionBackfill);
app.get('/api/categorization/suggestions/evaluation', getSuggestionEvaluation);
app.get('/api/audit-log', listAuditLogs);
app.get('/api/import-batches', listImportBatches);
app.get('/api/import-batches/:id/download', downloadImportBatchFile);
app.get('/api/email-recipients', listEmailRecipients);
app.get('/api/merchant-knowledge/summary', getMerchantKnowledgeSummaryRoute);
app.get('/api/merchant-knowledge/merchants', listMerchantKnowledgeMerchantsRoute);
app.get('/api/merchant-knowledge/merchants/:id', getMerchantKnowledgeMerchantDetailRoute);
app.post('/api/merchant-knowledge/plans/preview', previewMerchantKnowledgePlanRoute);
app.post('/api/merchant-knowledge/aliases/:aliasId/deprecate/confirm', confirmMerchantAliasDeprecationRoute);
app.post('/api/merchant-knowledge/merchants/:merchantId/deprecate/confirm', confirmMerchantDeprecationRoute);
app.post('/api/merchant-knowledge/conflicts/:conflictId/resolve/confirm', confirmMerchantConflictResolutionRoute);
app.post('/api/email-recipients', upsertEmailRecipient);
app.delete('/api/email-recipients/:id', deactivateEmailRecipient);
app.post('/api/email-recipients/:id/activate', activateEmailRecipient);
app.post('/api/email-recipients/:id/remove', removeEmailRecipient);
app.post('/api/ledger/:ledgerId/lock', lockLedger);
app.post('/api/ledger/:ledgerId/unlock', unlockLedger);
app.get('/api/rules', getRules);
app.post('/api/rules', postRule);
app.patch('/api/rules/:id', patchRule);
app.delete('/api/rules/:id', removeRule);
app.post('/api/rules/:id/preview', previewRule);
app.post('/api/rules/:id/apply', applyRule);
app.get('/api/reconciliation/statement-periods/:id/preview', getStatementReconciliationPreview);
app.get('/api/reconciliation/statement-periods/close-preview', getMonthlyClosePreview);
app.post('/api/reconciliation/statement-periods/:id/close', postStrictPeriodClose);
app.post('/api/reconciliation/period-closes/:id/reopen', postAuditedPeriodReopen);

// Operator tools — direction inference and owner-history proposal seeding (admin-only)
app.post('/api/operator/direction-inference', postDirectionInference);
app.post('/api/operator/owner-history-proposals', postOwnerHistoryProposals);
app.post('/api/operator/transaction-type-direction-usage-audit', postTransactionTypeDirectionUsageAudit);
app.post('/api/operator/category-normalization', postCategoryNormalization);

// Reference data — projects, categories, transaction types
app.get('/api/reference-data/projects', listProjects);
app.post('/api/reference-data/projects', createProject);
app.patch('/api/reference-data/projects/:id', updateProject);

app.get('/api/reference-data/categories', listCategories);
app.post('/api/reference-data/categories', createCategory);
app.patch('/api/reference-data/categories/:id', updateCategoryRecord);

app.get('/api/reference-data/transaction-types', listTransactionTypes);
app.post('/api/reference-data/transaction-types', createTransactionType);
app.patch('/api/reference-data/transaction-types/:id', updateTransactionType);

// Phase 6 — Reports and distribution (REPORT-001 through REPORT-005)
app.get('/api/reports/monthly/:year/:month/preview', getMonthlyReportPreview);
app.post('/api/reports/monthly/:year/:month/snapshot', postMonthlyReportSnapshot);
app.post('/api/reports/yearly/:year/snapshot', postYearlyReportSnapshot);
app.post('/api/reports/:snapshotId/artifacts', postReportArtifacts);
app.post('/api/reports/:snapshotId/approve', postApproveReportSnapshot);
app.post('/api/reports/:snapshotId/dispatch/prepare', postPrepareReportDispatch);
app.post('/api/reports/monthly/send', postMonthlySendReport);

async function start() {
  try {
    await ensureCategorizationRuleConditionsColumn();
  } catch (err) {
    console.error('[Startup] Continuing without conditions column (rules may fail)', err);
  }

  const port = Number(process.env.API_PORT ?? 4000);
  app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
}

void start();
