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

Thus the proposed normalization concerns 499 transactions: reassign the 372 lowercase `schenking FTK` bookings to the existing canonical category, and normalize the six singleton category labels while preserving their category identity where safe. This is an audit inventory and proposal, not evidence that these changes have run. The 2024/2025 labels were concluded source data; changing their presentation is the owner's explicit requested exception to the normal historical-preservation rule.

The earlier differing figures were caused by using different scopes, not evidence that production data was changing. This is an aggregate checkpoint, not a durable transaction export or authorization to alter historical records.

## Financial-data correction boundary

This release performs no financial-data correction. In particular, it does not move `Algemeen` bookings to `YA`, consolidate category IDs, rename existing historical categories, or deactivate/delete reference records.

Any later correction must be a separately reviewed, explicitly approved operation. Before applying it, capture a protected transaction-level before-image containing transaction/booking IDs, exact date and amount, all three dimension IDs and literal labels, booking source/rule/history links, evidence/hash, and relevant review-decision and report-snapshot references. Keep that evidence outside Git and redact it from logs.

The ordinary one-transaction booking-assignment path is not a safe bulk historical-normalization mechanism: it converts the booking to manual and clears rule/history provenance. Do not use it for category/customer normalization unless a purpose-built correction path first proves that it preserves provenance and records an auditable before/after correction.

Frozen report snapshots are immutable evidence. A correction must not rewrite their stored lines, literal labels, or hashes. Roll back a data correction by applying a new audited reverse correction from the protected before-image—not by restoring a database dump over newer activity. Verify transaction count, source bank facts, and income/expense/net totals to the cent before and after both correction and reversal. Stop if the exact target set or any invariant differs from the approved plan.

## Production release and code rollback

The `.github/workflows/dokploy.yml` workflow deploys pushes to `main`. It builds and publishes a Docker image tagged with the exact Git SHA, asks Dokploy to roll out that image, then waits for `/api/deployment-info` to report that SHA and `/api/health` to return HTTP 200. Dokploy/API acceptance alone is not proof of deployment.

This release contains no Prisma migration. If the application behavior must be rolled back:

1. Record the bad release SHA and the last known-good production SHA from `/api/deployment-info`.
2. Create a normal revert commit for the release on `main`; do not reset or force-push shared history.
3. Push the revert commit to `main` to run the same build/deploy workflow.
4. Confirm `/api/health` is healthy and `/api/deployment-info.buildSha` matches the revert commit. Inspect workflow and Dokploy logs if either check fails; HTTP 200 from the trigger is insufficient.

Because this release does not migrate or mutate the database, a code rollback requires no schema/data restore. Reverting code does not reverse category edits or creations performed by an administrator while the release was live; record and reverse any such reference-data actions separately. No historical financial-data changes are included in this release.

## Verification evidence

For each release, retain the source commit, GitHub Actions run, exact production build SHA, health result, and any rollback commit. Treat the live deployment-info and health endpoints as current runtime evidence; older deployment status documents are historical checkpoints.
