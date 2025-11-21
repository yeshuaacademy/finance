-- Add JSON conditions column for categorization rules (multi-field matching support)
ALTER TABLE "CategorizationRule"
ADD COLUMN "conditions" JSONB NOT NULL DEFAULT '[]';
