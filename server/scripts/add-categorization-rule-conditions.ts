import { prisma } from '../prismaClient';
import { ensureCategorizationRuleConditionsColumn } from '../db/ensureCategorizationRuleConditions';

(async () => {
  try {
    await ensureCategorizationRuleConditionsColumn();
    process.exit(0);
  } catch (error) {
    console.error('Failed to add CategorizationRule.conditions column', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
