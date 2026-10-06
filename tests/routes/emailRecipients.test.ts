import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  transaction: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock('../../server/auth/requestContext', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('../../server/prismaClient', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('../../server/services/auditLogService', () => ({ createAuditLog: mocks.createAuditLog }));

import { activateEmailRecipient, isEmailRecipientAddress, removeEmailRecipient, serializeEmailRecipient } from '../../server/routes/emailRecipients';

const recipient = (isActive: boolean) => ({
  id: 'recipient-1',
  userId: 'user-1',
  email: 'finance@example.test',
  name: 'Finance team',
  isActive,
  createdAt: new Date('2026-05-15T10:00:00.000Z'),
  updatedAt: new Date('2026-05-16T11:30:00.000Z'),
});

const makeResponse = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});

const makeRequest = () => ({ params: { id: 'recipient-1' } });

describe('email recipient routes', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset().mockResolvedValue({ userId: 'user-1', actorId: 'admin-1', actorEmail: 'admin@example.test' });
    mocks.createAuditLog.mockReset().mockResolvedValue(undefined);
    mocks.transaction.mockReset();
  });

  it('accepts normal email recipient addresses', () => {
    expect(isEmailRecipientAddress('admin@example.org')).toBe(true);
    expect(isEmailRecipientAddress(' finance+monthly@yeshua.academy ')).toBe(true);
  });

  it('rejects missing or malformed email recipient addresses', () => {
    expect(isEmailRecipientAddress('')).toBe(false);
    expect(isEmailRecipientAddress('not-an-email')).toBe(false);
    expect(isEmailRecipientAddress('missing-domain@')).toBe(false);
    expect(isEmailRecipientAddress('@missing-local.test')).toBe(false);
    expect(isEmailRecipientAddress('space inside@example.org')).toBe(false);
  });

  it('serializes recipient timestamps for API responses', () => {
    expect(serializeEmailRecipient({
      id: 'recipient-1',
      email: 'finance@example.test',
      name: 'Finance team',
      isActive: true,
      createdAt: new Date('2026-05-15T10:00:00.000Z'),
      updatedAt: new Date('2026-05-16T11:30:00.000Z'),
    })).toEqual({
      id: 'recipient-1',
      email: 'finance@example.test',
      name: 'Finance team',
      isActive: true,
      createdAt: '2026-05-15T10:00:00.000Z',
      updatedAt: '2026-05-16T11:30:00.000Z',
    });
  });

  it('reactivates a disabled recipient and writes before/after audit state in the transaction', async () => {
    const before = recipient(false);
    const after = recipient(true);
    const tx = {
      emailRecipient: {
        findFirst: vi.fn().mockResolvedValue(before),
        update: vi.fn().mockResolvedValue(after),
      },
    };
    mocks.transaction.mockImplementation(async (callback: (transaction: any) => unknown) => callback(tx));
    const response = makeResponse();

    await activateEmailRecipient(makeRequest() as never, response as never);

    expect(response.statusCode).toBe(200);
    expect((response.body as { isActive: boolean }).isActive).toBe(true);
    expect(tx.emailRecipient.update).toHaveBeenCalledWith({ where: { id: 'recipient-1' }, data: { isActive: true } });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'emailRecipient.activated',
      before: { email: before.email, name: before.name, isActive: false },
      after: { email: after.email, name: after.name, isActive: true },
    }));
  });

  it('refuses to remove an active recipient and does not write or delete', async () => {
    const tx = {
      emailRecipient: {
        findFirst: vi.fn().mockResolvedValue(recipient(true)),
        delete: vi.fn(),
      },
    };
    mocks.transaction.mockImplementation(async (callback: (transaction: any) => unknown) => callback(tx));
    const response = makeResponse();

    await removeEmailRecipient(makeRequest() as never, response as never);

    expect(response.statusCode).toBe(409);
    expect(tx.emailRecipient.delete).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('audits the prior recipient state atomically before permanent removal', async () => {
    const before = recipient(false);
    const tx = {
      emailRecipient: {
        findFirst: vi.fn().mockResolvedValue(before),
        delete: vi.fn().mockResolvedValue(before),
      },
    };
    mocks.transaction.mockImplementation(async (callback: (transaction: any) => unknown) => callback(tx));
    const response = makeResponse();

    await removeEmailRecipient(makeRequest() as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ id: 'recipient-1', deleted: true });
    expect(tx.emailRecipient.delete).toHaveBeenCalledWith({ where: { id: 'recipient-1' } });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'emailRecipient.deleted',
      entityId: 'recipient-1',
      before: { email: before.email, name: before.name, isActive: false },
      after: null,
    }));
  });
});
