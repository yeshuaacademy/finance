# Settings navigation and email recipient controls

Status: implementation reference  
Date: 2026-10-06

## Settings navigation

The Settings page groups its major areas into accessible, independently collapsible sections. The desktop app sidebar contains a Settings-only table of contents; small screens show the same links in a horizontally scrollable list above the page. Each link uses a stable fragment identifier. Opening a link to a collapsed section expands it and scrolls it into view, including when a fragment URL is opened directly.

The section disclosure button exposes its state with `aria-expanded` and `aria-controls`; its panel is hidden while collapsed. Settings content remains on one page, preserving the existing workflows and access rules.

Current section anchors:

| Anchor | Area |
|---|---|
| `#settings-projects` | Klanten en projecten |
| `#settings-categories` | Categorieën |
| `#settings-transaction-types` | Transactietypen |
| `#settings-category-overview` | Categorieoverzicht |
| `#settings-imports` | Importgeschiedenis |
| `#settings-email` | E-mailontvangers |
| `#settings-operator-tools` | Beheerhulpmiddelen |
| `#settings-audit-log` | Auditlog |
| `#settings-guardrails` | Veiligheid |

## Email recipients

- Adding an existing address continues to reactivate/update its existing row through the established upsert path.
- Active recipients can be disabled. Disabled recipients can be re-enabled by an administrator; activation is recorded in the audit log.
- State transitions lock the workspace-owned recipient row inside the write transaction, so concurrent activation, deactivation, or removal requests observe and audit the serialized state.
- Permanent removal is available only for disabled recipients. The UI asks for confirmation, and the server independently enforces the administrator role, recipient ownership, and inactive-state requirement.
- Removal and its before-state audit record are committed in one database transaction. Report-dispatch recipient snapshots are separate records and remain unchanged.

Removal is permanent, not a reversible soft-delete. The audit log retains the address and name needed to restore it manually by adding it again; that creates/reactivates a recipient record according to the unique user/email key. Reactivating is preferred when an address may be needed later.

## Rollback

- UI/API release rollback: revert the feature commit through the normal pull-request workflow and redeploy the previous healthy application build. No schema migration is introduced.
- Recipient state before deletion: use “Inschakelen” to restore a disabled row.
- After permanent removal: use the audit entry to recover the prior email/name, then add the address again. This restores delivery configuration, not the deleted row's original identifier or timestamps. Historical dispatch snapshots are not modified.
- Never delete or rewrite the audit entry to simulate rollback.

## Validation

The change is covered by the email-recipient and settings helper tests, the full Vitest suite, the server TypeScript build, and the Next.js production build. Production release evidence is recorded separately after the exact build SHA is verified live.
