# Codex Tenant Cleanup

When Codex is asked to drop a tenant (e.g. “drop tenant <slug>”), it should perform the following SQL actions in sequence.  
Each step ensures that the tenant’s data, role, and registry entry are completely removed from the system.

Bash
codex "drop tenant <slug> using instructions from codex-tenant-cleanup.md"

---

## 1️⃣ Drop the tenant’s schema

Remove all tenant-specific tables and data safely.

```sql
DROP SCHEMA IF EXISTS tenant_<slug> CASCADE;