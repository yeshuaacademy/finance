import { prisma } from '../prismaClient';

/**
 * Ensures the CategorizationRule.conditions column exists for tenant_openfund.
 * Safe/idempotent for both dev and prod. Throws on failure.
 */
export async function ensureCategorizationRuleConditionsColumn() {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'tenant_openfund'
          AND table_name = 'CategorizationRule'
          AND column_name = 'conditions'
      ) AS "exists";
    `;

    const exists = rows[0]?.exists === true;

    if (exists) {
      console.log('[DB bootstrap] CategorizationRule.conditions already exists');
      return;
    }

    console.log('[DB bootstrap] Adding CategorizationRule.conditions column…');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tenant_openfund"."CategorizationRule"
      ADD COLUMN "conditions" JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    console.log('[DB bootstrap] CategorizationRule.conditions column added successfully');
  } catch (err) {
    console.error('[DB bootstrap] Failed to ensure CategorizationRule.conditions column', err);
    throw err;
  }
}
