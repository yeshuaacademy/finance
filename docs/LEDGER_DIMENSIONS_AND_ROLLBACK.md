# Ledger dimensions and safe rollback

Status: operational release note  
Scope: transaction-list dimensions, category-entry capitalization, and production rollback

## What this release changes

- The transaction API returns customer (`Klant`) and transaction type from the confirmed booking, with transaction-level fields as a legacy fallback.
- The transaction table displays customer and transaction type alongside category.
- Customer and transaction-type filters use stable dimension IDs. Empty dimensions can be filtered separately, and text search includes the dimension labels.
- Category names created or renamed through the admin reference-data endpoints capitalize the first Unicode character using the `nl-NL` locale.
- Historical/imported category labels are not normalized by these endpoints. No existing transaction, booking, amount, ledger total, snapshot, or database schema is changed by this release.

The filters apply to the transaction rows only. Period KPIs and summaries continue to use the complete selected period, so filtering the table cannot change reported totals.

## Audit-count reconciliation

`Transaction.ledgerId` is nullable. A query that inner-joins `Transaction` to `Ledger` excludes imported historical rows that do not have a ledger record. Whole-administration audits must start from `Transaction` and use `Transaction.date` for year grouping; only ledger-specific checks should require a ledger join. Customer/category dimensions should be read from the transaction's current booking and compared with the corresponding transaction fields.

The production audit on 2026-10-05 reconciled the earlier counts:

- 1,018 transactions dated 2024–2026; 121 have a ledger link and 897 do not.
- The whole-ledger `Algemeen` set is 23 transactions: 15 in 2025 and 8 in 2026, net −€11,197.35.
- Two of those 23 are ledger-linked (July and August 2026, net −€69.43). The query that returned two rows was therefore a ledger-linked subset, not the full customer population.
- Transaction and booking project/category/type dimensions agreed for all 1,018 bookings at audit time.

The whole-administration capitalization scan found one case-only duplicate and six other used labels beginning with a lowercase character. Net amounts below are the signed sum of the unchanged transaction amounts:

| Existing label | Proposed canonical label | Transactions by transaction date | Net by year |
|---|---|---:|---:|
| `schenking FTK` | `Schenking FTK` (existing category) | 372 (88 / 178 / 106 in 2024 / 2025 / 2026) | +€12,287.20 / +€52,493.80 / +€51,315.17 |
| `Schenking FTK` | keep as canonical | 17 (2 / 0 / 15) | +€2,040.00 / €0.00 / +€5,207.30 |
| `kruispost in` | `Kruispost in` | 28 (0 / 18 / 10) | €0.00 / +€31,147.64 / +€16,203.56 |
| `kruispost uit` | `Kruispost uit` | 31 (0 / 18 / 13) | €0.00 / −€31,147.64 / −€24,203.55 |
| `schenking Algemeen` | `Schenking Algemeen` | 33 (0 / 11 / 22) | €0.00 / +€275.00 / −€4,547.12 |
| `schenking FR` | `Schenking FR` | 33 (33 / 0 / 0) | +€1,690.00 / €0.00 / €0.00 |
| `spaarrekening` | `Spaarrekening` | 1 (0 / 1 / 0) | €0.00 / −€10,000.00 / €0.00 |
| `br. Shahar` | `Br. Shahar` | 1 (1 / 0 / 0) | −€110.00 / €0.00 / €0.00 |

Thus the normalization concerns 499 transactions: reassign the 372 lowercase `schenking FTK` bookings to the existing canonical category, and normalize the six singleton category labels while preserving their category identity where safe. The 2024/2025 labels were concluded source data; changing their presentation is the owner's explicit requested exception to the normal historical-preservation rule.

The earlier differing figures were caused by using different scopes, not evidence that production data was changing. This is an aggregate checkpoint, not a durable transaction export or authorization to alter historical records.

## Category normalization and rollback

The category-normalization release adds an admin-only, hash-gated production operation at `/api/operator/category-normalization`, exposed in Settings → Operator Tools. The operation is separate from the earlier transaction-list UI release. It is designed to:

- capitalize the first Unicode lowercase character in every category label in the workspace;
- merge a lowercase label into an already-existing exact capitalized label (for example `schenking FTK` into `Schenking FTK`), preserving the canonical category ID;
- preserve category identity when no exact canonical label exists, while updating the current transaction/booking label;
- mark active categories with no current transaction, booking, rule, or suggestion references as inactive/historical unless the category is the receiving canonical target of a merge; retain retired categories in the collapsed archive rather than deleting them;
- build the Settings current-category overview from active reference-category IDs, so retained raw/import labels for retired categories do not reappear as current duplicates;
- preserve bank facts, booking source/rule/history/evidence fields, and frozen report snapshot rows and hashes;
- write before/after audit records and a compensating `CHANGE_BOOKING` decision for current bookings with valid decision provenance.

The apply endpoint re-computes the complete plan, requires the exact hash from a fresh dry-run, repeats that check inside a serializable database transaction, and aborts on detected drift or inconsistent/cross-workspace rows. It also blocks target-name collisions without a canonical category and merges from an active, used category into an inactive target. It does not use the ordinary single-transaction manual-booking endpoint. No schema migration is required.

The production dry-run was compared against the whole-administration audit above before applying: 499 transactions across the seven lowercase labels, including 372 `schenking FTK` rows; per-label/per-year counts and net minor-unit totals matched exactly, with no blockers. Its plan hash was `2bc104151b9197160a2d530408578aee133daaf8275a4c24cd694d5de8fda0ac`. The guarded operation was applied as operation `b5063934-e5fb-4e6b-b531-eccf89a04778`. The apply summary preserved 499 transaction rows and the audited income €171,884.27, expenses €76,480.21, and net €95,404.06. The category corrections changed current category references/labels and category active/history status only; bank facts and frozen report snapshots were not rewritten.

The rollback dry-run for that operation completed without blockers (plan hash `833a71123ad4d7135f61d00a3e320d308892e78edefe4c48e441f8af171d276e`). Rollback was not executed. A subsequent production preview exposed an idempotence defect: it reported zero transaction rows but continued to list the already-inactive, now-unreferenced `schenking FTK` source as one merge/archive. The source is intentionally retained as a historical record. The planner fix excludes inactive lowercase sources with no live references; this prevents the completed merge from being proposed again without deleting the historical category row. Do not apply the false-positive plan.

After deploying build `7c6321c4f2e43cacf9852dbb8c9fc10e9146081c`, the fresh production preview completed as `DRY_RUN_COMPLETE` with no blockers and zero transactions, income, expenses, net, labels, merges, rules, suggestions, or categories to archive. Its plan hash was `4c1e50ac3c41eb40b7537b863abb85b4693a62301be8d44e667770de4027b326`. The Settings page showed 82 active categories and one retained historical category. The preview was read-only; no second normalization or rollback was run.

Rollback is a separate, admin-only compensating operation. Retain the returned operation ID outside transient browser state. Run a rollback dry-run and confirm its exact plan hash. Rollback is refused if transaction facts, category labels/status, rules, suggestions, or latest review-decision state have drifted since normalization; it never rewinds newer work. If it passes, it restores the prior category assignments/labels and reference statuses, appends reversal decisions/audit entries, and leaves the original normalization evidence intact. It does not delete records or rewrite report snapshots. Reconcile transaction count, bank facts, category totals, and income/expense/net minor-unit totals after both apply and any rollback.

The aggregate tables above remain the approved audit checkpoint, not an individual-row backup. The operation's immutable audit before-images are the rollback source. Do not restore a database dump over newer activity.

## Production release and code rollback

The `.github/workflows/dokploy.yml` workflow deploys pushes to `main`. It builds and publishes a Docker image tagged with the exact Git SHA, asks Dokploy to roll out that image, then waits for `/api/deployment-info` to report that SHA and `/api/health` to return HTTP 200. Dokploy/API acceptance alone is not proof of deployment.

This release contains no Prisma migration. If the application behavior must be rolled back:

1. Record the bad release SHA and the last known-good production SHA from `/api/deployment-info`.
2. Create a normal revert commit for the application-code commit(s) on `main`, newest first; retain the rollback documentation. Do not reset or force-push shared history.
3. Push the revert commit to `main` to run the same build/deploy workflow.
4. Confirm `/api/health` is healthy and `/api/deployment-info.buildSha` matches the revert commit. Inspect workflow and Dokploy logs if either check fails; HTTP 200 from the trigger is insufficient.

The application-code release itself has no schema migration and performs no automatic production backfill. The separate, explicitly approved category-normalization operation above did update historical category metadata/bookings. A code rollback does not reverse that operation; use its recorded operation ID and guarded rollback flow separately if reverting the data correction is necessary. No bank facts or report snapshot rows/hashes are changed by the category operation.

## Verification evidence

For each release, retain the source commit, GitHub Actions run, exact production build SHA, health result, and any rollback commit. Treat the live deployment-info and health endpoints as current runtime evidence; older deployment status documents are historical checkpoints.
