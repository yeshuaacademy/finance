# Yeshua Academy Finance — Documentation Index

Status: CURRENT  
Owner: repository maintainers  
Canonical for: documentation navigation and reading order  
Last reviewed: 2026-07-17  
Governance: `docs/DOCUMENTATION_GOVERNANCE.md`

## Purpose

Repository documentation is the durable project memory for Yeshua Academy Finance. It defines product intent, architecture, roadmap, implementation sequencing, operational procedures, release evidence, and the exact current execution state. Chat history is not an authoritative source.

No documentation path migration has occurred yet. Existing root-level paths under `docs/` remain authoritative until a separately approved migration updates every script, test, workflow, cross-reference, and operational consumer.

## Mandatory reading order

Read these documents in order before changing product or accounting behavior:

1. `docs/PHILOSOPHY.md` — product philosophy and treatment of financial truth.
2. `docs/STRATEGY.md` — strategic goals, constraints, and success measures.
3. `docs/ROADMAP.md` — ordered phases, dependencies, exclusions, and current position.
4. `docs/IMPLEMENTATION_PLAN.md` — executable implementation tasks, acceptance criteria, and validation.
5. `docs/finance-rebuild-run.md` — current execution evidence, blockers, commits, and exact resume point.

For work that changes accounting, classification, review, or financial data contracts, also read:

- `docs/DOMAIN_MODEL.md`
- `docs/ACCOUNTING_INTEGRITY_AND_REVIEW_PREFILL.md`

## Current canonical documents

| Responsibility | Canonical path |
|---|---|
| Product philosophy and financial-truth principles | `docs/PHILOSOPHY.md` |
| Strategy, constraints, and outcomes | `docs/STRATEGY.md` |
| Roadmap and phase ordering | `docs/ROADMAP.md` |
| Executable implementation planning | `docs/IMPLEMENTATION_PLAN.md` |
| Approved financial domain model | `docs/DOMAIN_MODEL.md` |
| Accounting integrity, review prefill, and current review-intelligence architecture | `docs/ACCOUNTING_INTEGRITY_AND_REVIEW_PREFILL.md` |
| Durable finance-intelligence invariants | `docs/architecture/ARCHITECTURAL_INVARIANTS.md` |
| Long-term system boundaries and high-level data/event flow | `docs/architecture/SYSTEM_ARCHITECTURE.md` |
| Approved target merchant identity and matching architecture | `docs/architecture/MERCHANT_KNOWLEDGE_ARCHITECTURE.md` |
| Approved target decision orchestration and provenance architecture | `docs/architecture/DECISION_ENGINE_ARCHITECTURE.md` |
| Active run, handoff, validation evidence, and exact next task | `docs/finance-rebuild-run.md` |
| Documentation ownership, status, migration, and archival rules | `docs/DOCUMENTATION_GOVERNANCE.md` |
| Ledger customer/type dimensions, audit-count scope, and rollback contract | `docs/LEDGER_DIMENSIONS_AND_ROLLBACK.md` |

The current architecture entrypoint for implemented accounting integrity and transaction review remains `docs/ACCOUNTING_INTEGRITY_AND_REVIEW_PREFILL.md`. The approved documents under `docs/architecture/` define durable invariants and target Phase 3–7 boundaries; they do not claim those future capabilities are implemented and do not supersede the current accounting/review contract.

## Operational and owner-review document families

Operational procedures include the administrator guide, infrastructure readiness, backup and restore, monthly reconciliation, safe-command inventory, authentication readiness, production cutover, push readiness, and post-push verification documents under `docs/`.

The owner-review and release suite includes the `OWNER_*`, `FINAL_*`, `RELEASE_*`, `PUSH_*`, `POST_*`, `DECISION_BRIEF_*`, and production evidence documents. These files are path-sensitive and are validated as an interdependent family. They must never be partially migrated.

## Historical and superseded material

Older discovery documents, prototype briefs, dated handoffs, legacy roadmap and implementation files, model proposals, migration proposals, and completed production evidence remain available as historical context. Historical content is not authoritative unless a current canonical document explicitly references it.

Classified as `SUPERSEDED` and retained in place:

- `docs/yeshua-academy-finance-roadmap.md`
- `docs/yeshua-academy-finance-implementation-plan.md`
- `docs/yeshua-academy-finance-implementation-progress.md`
- `docs/yeshua-academy-finance-handoff-2026-05-15.md`
- `docs/yeshua-academy-finance-handoff-2026-05-16.md`

Classified as `ARCHIVED` and retained in place:

- `docs/yeshua-academy-finance-prototype-notes.md`
- `docs/yeshua-academy-finance-prototype-execution-brief.md`
- `docs/yeshua-academy-finance-bloat-map.md`

The discovery plan, requirements baseline, and UI design brief remain unchanged because current canonical documentation still references them. No historical file has been moved, renamed, deleted, or replaced by a compatibility stub.

## Onboarding reading order

A new engineer should read:

1. root `README.md`;
2. this documentation index;
3. `docs/DOCUMENTATION_GOVERNANCE.md`;
4. `docs/PHILOSOPHY.md`;
5. `docs/STRATEGY.md`;
6. `docs/DOMAIN_MODEL.md`;
7. `docs/architecture/ARCHITECTURAL_INVARIANTS.md`;
8. `docs/architecture/SYSTEM_ARCHITECTURE.md`;
9. `docs/ACCOUNTING_INTEGRITY_AND_REVIEW_PREFILL.md`;
10. the relevant target architecture document, including Merchant Knowledge or Decision Engine where applicable;
11. `docs/ROADMAP.md`;
12. `docs/IMPLEMENTATION_PLAN.md`;
13. `docs/finance-rebuild-run.md`;
14. the operational guide relevant to the task.

## Change rule

One fact has one canonical home. Other documents may summarize and link to that fact, but must not redefine it. See `docs/DOCUMENTATION_GOVERNANCE.md` before creating, splitting, moving, renaming, superseding, or archiving documentation.
