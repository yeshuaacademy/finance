import type { Request, Response } from 'express';
import { prisma } from '../prismaClient';
import { requireAdmin } from '../auth/requestContext';
import {
  CategoryNormalizationError,
  executeCategoryNormalization,
  executeCategoryNormalizationRollback,
  getCategoryNormalizationDryRun,
  getCategoryNormalizationRollbackDryRun,
} from '../services/categoryNormalizationService';
import type { CategoryMergeMapping } from '../services/categoryNormalizationService';

const resolveWorkspace = (res: Response): string | null => {
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });
    return null;
  }
  return workspaceId;
};

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const readMappings = (value: unknown): CategoryMergeMapping[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 25) return null;
  const mappings: CategoryMergeMapping[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const sourceName = readString(record.sourceName);
    const targetName = readString(record.targetName);
    if (!sourceName || !targetName || sourceName.length > 200 || targetName.length > 200) return null;
    mappings.push({ sourceName, targetName });
  }
  return mappings;
};

export const postCategoryNormalization = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = resolveWorkspace(res);
  if (!workspaceId) return;

  const body = (req.body ?? {}) as {
    action?: unknown;
    operationId?: unknown;
    confirmedPlanHash?: unknown;
    mappings?: unknown;
  };
  const action = readString(body.action) ?? 'dry-run';
  const operationId = readString(body.operationId);
  const mappings = readMappings(body.mappings);
  if (!mappings) return res.status(422).json({ error: 'Categorie-mappings zijn ongeldig (maximaal 25 exacte bron/doel-labels).'});

  try {
    if (action === 'dry-run') {
      return res.json(await getCategoryNormalizationDryRun(prisma, { workspaceId, userId: actor.userId, mappings }));
    }
    if (action === 'apply') {
      const confirmedPlanHash = readString(body.confirmedPlanHash);
      if (!confirmedPlanHash) return res.status(422).json({ error: 'Voer eerst een dry-run uit en bevestig de planhash.' });
      const result = await executeCategoryNormalization(prisma, {
        workspaceId,
        userId: actor.userId,
        actor: {
          userId: actor.userId,
          actorId: actor.actorId ?? actor.userId,
          actorEmail: actor.actorEmail,
        },
        confirmedPlanHash,
        mappings,
      });
      return res.status(result.status === 'BLOCKED' ? 409 : result.status === 'HASH_DRIFT' ? 409 : 200).json(result);
    }
    if (action === 'rollback-dry-run' || action === 'rollback') {
      if (!operationId) return res.status(400).json({ error: 'Normalisatie-operation-id ontbreekt.' });
      if (action === 'rollback-dry-run') {
        return res.json(await getCategoryNormalizationRollbackDryRun(prisma, { workspaceId, operationId }));
      }
      const confirmedPlanHash = readString(body.confirmedPlanHash);
      if (!confirmedPlanHash) return res.status(422).json({ error: 'Voer eerst een rollback-dry-run uit en bevestig de planhash.' });
      const result = await executeCategoryNormalizationRollback(prisma, {
        workspaceId,
        operationId,
        actor: {
          userId: actor.userId,
          actorId: actor.actorId ?? actor.userId,
          actorEmail: actor.actorEmail,
        },
        confirmedPlanHash,
      });
      return res.status(result.status === 'BLOCKED' || result.status === 'HASH_DRIFT' ? 409 : 200).json(result);
    }
    return res.status(400).json({ error: 'Ongeldige categorie-normalisatieactie.' });
  } catch (error) {
    if (error instanceof CategoryNormalizationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Category normalization operation failed', error);
    return res.status(500).json({ error: 'De categorie-normalisatie kon niet veilig worden afgerond.' });
  }
};
