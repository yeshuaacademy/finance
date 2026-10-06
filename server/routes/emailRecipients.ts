import type { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../prismaClient';
import { requireAuthenticatedRequest, requireAdmin } from '../auth/requestContext';
import { createAuditLog } from '../services/auditLogService';
import { readRouteParam } from './routeParams';

export const isEmailRecipientAddress = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export type EmailRecipientResponseInput = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const serializeEmailRecipient = (recipient: EmailRecipientResponseInput) => ({
  id: recipient.id,
  email: recipient.email,
  name: recipient.name,
  isActive: recipient.isActive,
  createdAt: recipient.createdAt.toISOString(),
  updatedAt: recipient.updatedAt.toISOString(),
});

const lockEmailRecipient = async (tx: Prisma.TransactionClient, userId: string, recipientId: string) => {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "EmailRecipient"
    WHERE "id" = ${recipientId} AND "userId" = ${userId}
    FOR UPDATE
  `;
  return tx.emailRecipient.findFirst({ where: { id: recipientId, userId } });
};

export const listEmailRecipients = async (req: Request, res: Response) => {
  const actor = await requireAuthenticatedRequest(req, res);
  if (!actor) return;
  const { userId } = actor;

  try {
    const recipients = await prisma.emailRecipient.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { email: 'asc' }],
    });

    return res.json(recipients.map(serializeEmailRecipient));
  } catch (error) {
    console.error('E-mailontvangers konden niet worden geladen', error);
    return res.status(500).json({ error: 'E-mailontvangers konden niet worden geladen.' });
  }
};

export const upsertEmailRecipient = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const { userId, actorId, actorEmail } = actor;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;

  if (!email || !isEmailRecipientAddress(email)) {
    return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
  }

  try {
    const recipient = await prisma.$transaction(async (tx) => {
      const existing = await tx.emailRecipient.findUnique({
        where: {
          userId_email: {
            userId,
            email,
          },
        },
      });

      const updated = await tx.emailRecipient.upsert({
        where: {
          userId_email: {
            userId,
            email,
          },
        },
        update: {
          name,
          isActive: true,
        },
        create: {
          userId,
          email,
          name,
        },
      });

      await createAuditLog(tx, {
        userId,
        actorId,
        actorEmail,
        action: existing ? 'emailRecipient.updated' : 'emailRecipient.created',
        entityType: 'emailRecipient',
        entityId: updated.id,
        before: existing
          ? {
              email: existing.email,
              name: existing.name,
              isActive: existing.isActive,
            }
          : null,
        after: {
          email: updated.email,
          name: updated.name,
          isActive: updated.isActive,
        },
      });

      return updated;
    });

    return res.status(200).json(serializeEmailRecipient(recipient));
  } catch (error) {
    console.error('E-mailontvanger kon niet worden opgeslagen', error);
    return res.status(500).json({ error: 'E-mailontvanger kon niet worden opgeslagen.' });
  }
};

export const deactivateEmailRecipient = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const { userId, actorId, actorEmail } = actor;
  const recipientId = readRouteParam(req, 'id');

  if (!recipientId) {
    return res.status(400).json({ error: 'E-mailontvanger id ontbreekt.' });
  }

  try {
    const response = await prisma.$transaction(async (tx) => {
      const existing = await lockEmailRecipient(tx, userId, recipientId);

      if (!existing) {
        return { status: 404 as const, body: { error: 'E-mailontvanger niet gevonden.' } };
      }

      if (!existing.isActive) {
        return { status: 200 as const, body: serializeEmailRecipient(existing) };
      }

      const updated = await tx.emailRecipient.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      await createAuditLog(tx, {
        userId,
        actorId,
        actorEmail,
        action: 'emailRecipient.deactivated',
        entityType: 'emailRecipient',
        entityId: updated.id,
        before: {
          email: existing.email,
          name: existing.name,
          isActive: existing.isActive,
        },
        after: {
          email: updated.email,
          name: updated.name,
          isActive: updated.isActive,
        },
      });

      return {
        status: 200 as const,
        body: serializeEmailRecipient(updated),
      };
    });

    return res.status(response.status).json(response.body);
  } catch (error) {
    console.error('E-mailontvanger kon niet worden gedeactiveerd', error);
    return res.status(500).json({ error: 'E-mailontvanger kon niet worden gedeactiveerd.' });
  }
};

export const activateEmailRecipient = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const { userId, actorId, actorEmail } = actor;
  const recipientId = readRouteParam(req, 'id');
  if (!recipientId) return res.status(400).json({ error: 'E-mailontvanger id ontbreekt.' });

  try {
    const response = await prisma.$transaction(async (tx) => {
      const existing = await lockEmailRecipient(tx, userId, recipientId);
      if (!existing) return { status: 404 as const, body: { error: 'E-mailontvanger niet gevonden.' } };

      const updated = existing.isActive
        ? existing
        : await tx.emailRecipient.update({ where: { id: existing.id }, data: { isActive: true } });

      if (!existing.isActive) {
        await createAuditLog(tx, {
          userId,
          actorId,
          actorEmail,
          action: 'emailRecipient.activated',
          entityType: 'emailRecipient',
          entityId: updated.id,
          before: { email: existing.email, name: existing.name, isActive: existing.isActive },
          after: { email: updated.email, name: updated.name, isActive: updated.isActive },
        });
      }

      return { status: 200 as const, body: serializeEmailRecipient(updated) };
    });
    return res.status(response.status).json(response.body);
  } catch (error) {
    console.error('E-mailontvanger kon niet worden ingeschakeld', error);
    return res.status(500).json({ error: 'E-mailontvanger kon niet worden ingeschakeld.' });
  }
};

export const removeEmailRecipient = async (req: Request, res: Response) => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const { userId, actorId, actorEmail } = actor;
  const recipientId = readRouteParam(req, 'id');
  if (!recipientId) return res.status(400).json({ error: 'E-mailontvanger id ontbreekt.' });

  try {
    const response = await prisma.$transaction(async (tx) => {
      const existing = await lockEmailRecipient(tx, userId, recipientId);
      if (!existing) return { status: 404 as const, body: { error: 'E-mailontvanger niet gevonden.' } };
      if (existing.isActive) {
        return { status: 409 as const, body: { error: 'Schakel de e-mailontvanger eerst uit voordat je deze verwijdert.' } };
      }

      await createAuditLog(tx, {
        userId,
        actorId,
        actorEmail,
        action: 'emailRecipient.deleted',
        entityType: 'emailRecipient',
        entityId: existing.id,
        before: { email: existing.email, name: existing.name, isActive: existing.isActive },
        after: null,
      });
      await tx.emailRecipient.delete({ where: { id: existing.id } });
      return { status: 200 as const, body: { id: existing.id, deleted: true } };
    });
    return res.status(response.status).json(response.body);
  } catch (error) {
    console.error('E-mailontvanger kon niet worden verwijderd', error);
    return res.status(500).json({ error: 'E-mailontvanger kon niet worden verwijderd.' });
  }
};
