import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';
import { requireAdmin, requireAuthenticatedRequest } from '../auth/requestContext';
import { readRouteParam } from './routeParams';

const isUniqueConstraintError = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const readString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

// Admin-created labels follow the UI convention. Historical/imported labels remain source-faithful.
export const capitalizeCategoryName = (name: string): string => {
  const [first, ...remaining] = Array.from(name);
  return first ? `${first.toLocaleUpperCase('nl-NL')}${remaining.join('')}` : name;
};

const readOptionalInt = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const readOptionalBool = (v: unknown): boolean | undefined =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined;

// ─── Projects ──────────────────────────────────────────────────────────────

export const listProjects = async (req: Request, res: Response) => {
  const actor = await requireAuthenticatedRequest(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  try {
    const items = await prisma.project.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, isActive: true, isHistorical: true },
    });
    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Projecten konden niet worden geladen.' });
  }
};

export const createProject = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  const body = req.body as Record<string, unknown>;
  const code = readString(body.code);
  const name = readString(body.name);
  if (!code) return res.status(400).json({ error: 'Project-code is verplicht.' });
  if (!name) return res.status(400).json({ error: 'Project-naam is verplicht.' });

  try {
    const item = await prisma.project.create({
      data: { workspaceId, code, name },
      select: { id: true, code: true, name: true, isActive: true, isHistorical: true },
    });
    return res.status(201).json(item);
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: `Project met code '${code}' bestaat al.` });
    }
    return res.status(500).json({ error: 'Project kon niet worden aangemaakt.' });
  }
};

export const updateProject = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  const id = readRouteParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'Project-id ontbreekt.' });

  const body = req.body as Record<string, unknown>;
  const name = readString(body.name);
  const isActive = readOptionalBool(body.isActive);

  if (!name && isActive === undefined) {
    return res.status(400).json({ error: 'Geen veld om bij te werken opgegeven.' });
  }

  try {
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== workspaceId) return res.status(404).json({ error: 'Project niet gevonden.' });

    if (isActive === false) {
      const bookingCount = await prisma.transactionBooking.count({ where: { projectId: id } });
      if (bookingCount > 0) {
        return res.status(409).json({
          error: `Project kan niet worden gedeactiveerd: het is gekoppeld aan ${bookingCount} boeking(en). Wijs ze eerst toe aan een ander project.`,
        });
      }
    }

    const item = await prisma.project.update({
      where: { id },
      data: { ...(name ? { name } : {}), ...(isActive !== undefined ? { isActive } : {}) },
      select: { id: true, code: true, name: true, isActive: true, isHistorical: true },
    });
    return res.json(item);
  } catch {
    return res.status(500).json({ error: 'Project kon niet worden bijgewerkt.' });
  }
};

// ─── Categories ────────────────────────────────────────────────────────────

export const listCategories = async (req: Request, res: Response) => {
  const actor = await requireAuthenticatedRequest(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  try {
    const items = await prisma.category.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true, sortOrder: true, isActive: true, isHistorical: true },
    });
    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Categorieën konden niet worden geladen.' });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  const body = req.body as Record<string, unknown>;
  const rawName = readString(body.name);
  const name = rawName ? capitalizeCategoryName(rawName) : null;
  const color = readString(body.color);
  const sortOrder = readOptionalInt(body.sortOrder);
  if (!name) return res.status(400).json({ error: 'Categorie-naam is verplicht.' });

  try {
    const item = await prisma.category.create({
      data: { workspaceId, name, ...(color ? { color } : {}), ...(sortOrder !== null ? { sortOrder } : {}) },
      select: { id: true, name: true, color: true, sortOrder: true, isActive: true, isHistorical: true },
    });
    return res.status(201).json(item);
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: `Categorie '${name}' bestaat al.` });
    }
    return res.status(500).json({ error: 'Categorie kon niet worden aangemaakt.' });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  const id = readRouteParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'Categorie-id ontbreekt.' });

  const body = req.body as Record<string, unknown>;
  const rawName = readString(body.name);
  const name = rawName ? capitalizeCategoryName(rawName) : null;
  const color = readString(body.color);
  const sortOrder = readOptionalInt(body.sortOrder);
  const isActive = readOptionalBool(body.isActive);

  const hasUpdate = name || color || sortOrder !== null || isActive !== undefined;
  if (!hasUpdate) return res.status(400).json({ error: 'Geen veld om bij te werken opgegeven.' });

  try {
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== workspaceId) return res.status(404).json({ error: 'Categorie niet gevonden.' });

    if (isActive === false) {
      const bookingCount = await prisma.transactionBooking.count({ where: { categoryId: id } });
      if (bookingCount > 0) {
        return res.status(409).json({
          error: `Categorie kan niet worden gedeactiveerd: gekoppeld aan ${bookingCount} boeking(en). Wijs ze eerst toe aan een andere categorie.`,
        });
      }
    }

    const item = await prisma.category.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(color !== null ? { color } : {}),
        ...(sortOrder !== null ? { sortOrder } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select: { id: true, name: true, color: true, sortOrder: true, isActive: true, isHistorical: true },
    });
    return res.json(item);
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: `Categorie '${name ?? 'de gekozen naam'}' bestaat al.` });
    }
    return res.status(500).json({ error: 'Categorie kon niet worden bijgewerkt.' });
  }
};

// ─── Transaction Types ──────────────────────────────────────────────────────

export const listTransactionTypes = async (req: Request, res: Response) => {
  const actor = await requireAuthenticatedRequest(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  try {
    const items = await prisma.transactionType.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { literalName: 'asc' }],
      select: { id: true, literalName: true, direction: true, sortOrder: true, isActive: true, isHistorical: true },
    });
    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Transactietypes konden niet worden geladen.' });
  }
};

export const createTransactionType = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  const body = req.body as Record<string, unknown>;
  const literalName = readString(body.literalName);
  const direction = body.direction === 'credit' ? 'credit' as const
    : body.direction === 'debit' ? 'debit' as const
    : null;
  const sortOrder = readOptionalInt(body.sortOrder);

  if (!literalName) return res.status(400).json({ error: 'Transactietype-naam is verplicht.' });
  if ('direction' in body && body.direction !== null && body.direction !== 'credit' && body.direction !== 'debit') {
    return res.status(400).json({ error: "Richting moet 'credit', 'debit' of null zijn." });
  }

  try {
    const item = await prisma.transactionType.create({
      data: { workspaceId, literalName, direction, ...(sortOrder !== null ? { sortOrder } : {}) },
      select: { id: true, literalName: true, direction: true, sortOrder: true, isActive: true, isHistorical: true },
    });
    return res.status(201).json(item);
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: `Transactietype '${literalName}' bestaat al.` });
    }
    return res.status(500).json({ error: 'Transactietype kon niet worden aangemaakt.' });
  }
};

export const updateTransactionType = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID?.trim();
  if (!workspaceId) return res.status(503).json({ error: 'Werkruimte niet geconfigureerd.' });

  const id = readRouteParam(req, 'id');
  if (!id) return res.status(400).json({ error: 'Transactietype-id ontbreekt.' });

  const body = req.body as Record<string, unknown>;
  const literalName = readString(body.literalName);
  const sortOrder = readOptionalInt(body.sortOrder);
  const isActive = readOptionalBool(body.isActive);
  const rawDirection = body.direction;
  const direction = rawDirection === 'credit' ? 'credit' as const
    : rawDirection === 'debit' ? 'debit' as const
    : undefined;

  const hasUpdate = literalName || sortOrder !== null || isActive !== undefined || direction !== undefined;
  if (!hasUpdate) return res.status(400).json({ error: 'Geen veld om bij te werken opgegeven.' });

  try {
    const existing = await prisma.transactionType.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== workspaceId) return res.status(404).json({ error: 'Transactietype niet gevonden.' });

    if (isActive === false) {
      const bookingCount = await prisma.transactionBooking.count({ where: { transactionTypeId: id } });
      if (bookingCount > 0) {
        return res.status(409).json({
          error: `Transactietype kan niet worden gedeactiveerd: gekoppeld aan ${bookingCount} boeking(en). Wijs ze eerst toe aan een ander type.`,
        });
      }
    }

    if (direction !== undefined && existing.direction !== null && existing.direction !== direction) {
      const bookingCount = await prisma.transactionBooking.count({ where: { transactionTypeId: id } });
      if (bookingCount > 0) {
        return res.status(409).json({
          error: `Richting kan niet worden gewijzigd: ${bookingCount} boeking(en) gebruiken dit type. Wijs ze eerst opnieuw toe.`,
        });
      }
    }

    const item = await prisma.transactionType.update({
      where: { id },
      data: {
        ...(literalName ? { literalName } : {}),
        ...(direction !== undefined ? { direction } : {}),
        ...(sortOrder !== null ? { sortOrder } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select: { id: true, literalName: true, direction: true, sortOrder: true, isActive: true, isHistorical: true },
    });
    return res.json(item);
  } catch {
    return res.status(500).json({ error: 'Transactietype kon niet worden bijgewerkt.' });
  }
};
