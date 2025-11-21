import { prisma } from '../prismaClient';

(async () => {
  try {
    const existing = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'tenant_openfund'
          AND table_name = 'CategorizationRule'
          AND column_name = 'conditions'
      ) AS exists;
    `;

    const hasColumn = existing?.[0]?.exists === true;

    if (hasColumn) {
      console.log('CategorizationRule.conditions already exists; nothing to do.');
      process.exit(0);
    }

    await prisma.$executeRawUnsafe(
      "ALTER TABLE \"tenant_openfund\".\"CategorizationRule\" ADD COLUMN \"conditions\" JSONB NOT NULL DEFAULT '[]'::jsonb;",
    );

    console.log('Added CategorizationRule.conditions column successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to add CategorizationRule.conditions column', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
