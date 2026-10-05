import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

const makePrismaUniqueError = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
    meta: { target: ['workspaceId', 'name'] },
  });

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireAuthenticatedRequest: vi.fn(),
  requireAdmin: vi.fn(),
  projectFindMany: vi.fn(),
  projectCreate: vi.fn(),
  projectFindUnique: vi.fn(),
  projectUpdate: vi.fn(),
  categoryFindMany: vi.fn(),
  categoryCreate: vi.fn(),
  categoryFindUnique: vi.fn(),
  categoryUpdate: vi.fn(),
  transactionTypeFindMany: vi.fn(),
  transactionTypeCreate: vi.fn(),
  transactionTypeFindUnique: vi.fn(),
  transactionTypeUpdate: vi.fn(),
  transactionBookingCount: vi.fn(),
}));

vi.mock('../../server/auth/requestContext', () => ({
  requireAuthenticatedRequest: mocks.requireAuthenticatedRequest,
  requireAdmin: mocks.requireAdmin,
}));

vi.mock('../../server/prismaClient', () => ({
  prisma: {
    project: {
      findMany: mocks.projectFindMany,
      create: mocks.projectCreate,
      findUnique: mocks.projectFindUnique,
      update: mocks.projectUpdate,
    },
    category: {
      findMany: mocks.categoryFindMany,
      create: mocks.categoryCreate,
      findUnique: mocks.categoryFindUnique,
      update: mocks.categoryUpdate,
    },
    transactionType: {
      findMany: mocks.transactionTypeFindMany,
      create: mocks.transactionTypeCreate,
      findUnique: mocks.transactionTypeFindUnique,
      update: mocks.transactionTypeUpdate,
    },
    transactionBooking: {
      count: mocks.transactionBookingCount,
    },
  },
}));

import {
  listProjects, createProject, updateProject,
  listCategories, createCategory, updateCategory,
  listTransactionTypes, createTransactionType, updateTransactionType,
} from '../../server/routes/referenceData';

const adminActor = { userId: 'u1', role: 'admin' as const, actorId: 'u1', actorEmail: 'admin@test.local' };
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const makeReq = (overrides: Partial<Request> = {}): Request => ({
  body: {},
  params: {},
  query: {},
  header: () => undefined,
  ...overrides,
} as unknown as Request);

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DEFAULT_WORKSPACE_ID', WORKSPACE_ID);
});

// ─── List endpoints accessible to viewers ────────────────────────────────

describe('list endpoints', () => {
  it('listProjects returns items for authenticated viewers', async () => {
    mocks.requireAuthenticatedRequest.mockResolvedValue(adminActor);
    mocks.projectFindMany.mockResolvedValue([{ id: 'p1', code: 'YA', name: 'Yeshua Academy', isActive: true, isHistorical: false }]);
    const res = makeRes();
    await listProjects(makeReq(), res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it('listTransactionTypes includes direction field', async () => {
    mocks.requireAuthenticatedRequest.mockResolvedValue(adminActor);
    mocks.transactionTypeFindMany.mockResolvedValue([
      { id: 't1', literalName: 'Schenking', direction: 'credit', sortOrder: null, isActive: true, isHistorical: false },
    ]);
    const res = makeRes();
    await listTransactionTypes(makeReq(), res);
    const body = res.body as { items: Array<{ direction: string }> };
    expect(body.items[0].direction).toBe('credit');
  });
});

// ─── Admin-only create ────────────────────────────────────────────────────

describe('create endpoints', () => {
  it('createProject requires admin and creates record', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.projectCreate.mockResolvedValue({ id: 'p1', code: 'YA', name: 'Yeshua Academy', isActive: true, isHistorical: false });
    const res = makeRes();
    await createProject(makeReq({ body: { code: 'YA', name: 'Yeshua Academy' } }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { code: string };
    expect(body.code).toBe('YA');
  });

  it('createProject returns 400 when code is missing', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    const res = makeRes();
    await createProject(makeReq({ body: { name: 'Only name' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('createTransactionType allows null direction (both)', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeCreate.mockResolvedValue({ id: 't0', literalName: 'Schenking', direction: null, sortOrder: null, isActive: true, isHistorical: false });
    const res = makeRes();
    await createTransactionType(makeReq({ body: { literalName: 'Schenking' } }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { direction: null };
    expect(body.direction).toBeNull();
  });

  it('createTransactionType returns 400 for invalid direction', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    const res = makeRes();
    await createTransactionType(makeReq({ body: { literalName: 'X', direction: 'invalid' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('createTransactionType stores null direction for both directions', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeCreate.mockResolvedValue({ id: 't0b', literalName: 'Schenking', direction: null, sortOrder: null, isActive: true, isHistorical: false });
    const res = makeRes();
    await createTransactionType(makeReq({ body: { literalName: 'Schenking', direction: null } }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { direction: null };
    expect(body.direction).toBeNull();
  });

  it('createTransactionType stores credit direction', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeCreate.mockResolvedValue({ id: 't1', literalName: 'Schenking', direction: 'credit', sortOrder: null, isActive: true, isHistorical: false });
    const res = makeRes();
    await createTransactionType(makeReq({ body: { literalName: 'Schenking', direction: 'credit' } }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { direction: string };
    expect(body.direction).toBe('credit');
  });

  it('createTransactionType stores debit direction', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeCreate.mockResolvedValue({ id: 't2', literalName: 'Bankkosten', direction: 'debit', sortOrder: null, isActive: true, isHistorical: false });
    const res = makeRes();
    await createTransactionType(makeReq({ body: { literalName: 'Bankkosten', direction: 'debit' } }), res);
    expect(res.statusCode).toBe(201);
    const body = res.body as { direction: string };
    expect(body.direction).toBe('debit');
  });

  it('capitalizes the first character of admin-created category names', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.categoryCreate.mockResolvedValue({ id: 'c1', name: 'Schenking FTK' });
    const res = makeRes();
    await createCategory(makeReq({ body: { name: 'schenking FTK' } }), res);
    expect(res.statusCode).toBe(201);
    expect(mocks.categoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Schenking FTK' }),
    }));
  });

  it('capitalizes category renames at the server boundary', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.categoryFindUnique.mockResolvedValue({ id: 'c1', workspaceId: WORKSPACE_ID, name: 'oude naam', isActive: true });
    mocks.categoryUpdate.mockResolvedValue({ id: 'c1', name: 'Nieuwe naam' });
    const res = makeRes();
    await updateCategory(makeReq({ params: { id: 'c1' }, body: { name: 'nieuwe naam' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.categoryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Nieuwe naam' }),
    }));
  });
});

// ─── Deactivation safeguards ──────────────────────────────────────────────

describe('deactivation safeguards', () => {
  it('blocks project deactivation when bookings exist and returns Dutch error', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.projectFindUnique.mockResolvedValue({ id: 'p1', workspaceId: WORKSPACE_ID, isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(3);
    const res = makeRes();
    await updateProject(makeReq({ params: { id: 'p1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/3 boeking/);
  });

  it('allows project deactivation when no bookings exist', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.projectFindUnique.mockResolvedValue({ id: 'p1', workspaceId: WORKSPACE_ID, isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(0);
    mocks.projectUpdate.mockResolvedValue({ id: 'p1', code: 'YA', name: 'YA', isActive: false, isHistorical: false });
    const res = makeRes();
    await updateProject(makeReq({ params: { id: 'p1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { isActive: boolean };
    expect(body.isActive).toBe(false);
  });

  it('blocks category deactivation when bookings exist', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.categoryFindUnique.mockResolvedValue({ id: 'c1', workspaceId: WORKSPACE_ID, isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(7);
    const res = makeRes();
    await updateCategory(makeReq({ params: { id: 'c1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/7 boeking/);
  });

  it('blocks transaction type deactivation when bookings exist', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeFindUnique.mockResolvedValue({ id: 't1', workspaceId: WORKSPACE_ID, direction: 'credit', isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(2);
    const res = makeRes();
    await updateTransactionType(makeReq({ params: { id: 't1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/2 boeking/);
  });
});

// ─── Uniqueness conflicts ─────────────────────────────────────────────────

describe('uniqueness conflict handling', () => {
  it('returns 409 with project code in message when Prisma P2002 fires', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.projectCreate.mockRejectedValue(makePrismaUniqueError());
    const res = makeRes();
    await createProject(makeReq({ body: { code: 'YA', name: 'Dupe' } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/YA/);
  });

  it('returns 500 when a non-unique generic error fires for project', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.projectCreate.mockRejectedValue(new Error('Some other error'));
    const res = makeRes();
    await createProject(makeReq({ body: { code: 'YA', name: 'Dupe' } }), res);
    expect(res.statusCode).toBe(500);
  });

  it('returns 409 with category name in message when Prisma P2002 fires', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.categoryCreate.mockRejectedValue(makePrismaUniqueError());
    const res = makeRes();
    await createCategory(makeReq({ body: { name: 'Giften' } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/Giften/);
  });

  it('returns 409 with type name in message when Prisma P2002 fires', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeCreate.mockRejectedValue(makePrismaUniqueError());
    const res = makeRes();
    await createTransactionType(makeReq({ body: { literalName: 'Schenking', direction: 'credit' } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/Schenking/);
  });
});

// ─── Workspace isolation ──────────────────────────────────────────────────

describe('workspace isolation', () => {
  it('updateProject returns 404 when record belongs to a different workspace', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.projectFindUnique.mockResolvedValue({ id: 'p1', workspaceId: 'other-ws', isActive: true });
    const res = makeRes();
    await updateProject(makeReq({ params: { id: 'p1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('updateCategory returns 404 when record belongs to a different workspace', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.categoryFindUnique.mockResolvedValue({ id: 'c1', workspaceId: 'other-ws', isActive: true });
    const res = makeRes();
    await updateCategory(makeReq({ params: { id: 'c1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('updateTransactionType returns 404 when record belongs to a different workspace', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeFindUnique.mockResolvedValue({ id: 't1', workspaceId: 'other-ws', direction: 'credit', isActive: true });
    const res = makeRes();
    await updateTransactionType(makeReq({ params: { id: 't1' }, body: { isActive: false } }), res);
    expect(res.statusCode).toBe(404);
  });
});

// ─── Direction-change safeguard ────────────────────────────────────────────

describe('direction-change safeguard', () => {
  it('blocks direction flip when bookings exist', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeFindUnique.mockResolvedValue({ id: 't1', workspaceId: WORKSPACE_ID, direction: 'credit', isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(5);
    const res = makeRes();
    await updateTransactionType(makeReq({ params: { id: 't1' }, body: { direction: 'debit' } }), res);
    expect(res.statusCode).toBe(409);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/richting/i);
  });

  it('allows direction flip when no bookings exist', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeFindUnique.mockResolvedValue({ id: 't1', workspaceId: WORKSPACE_ID, direction: 'credit', isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(0);
    mocks.transactionTypeUpdate.mockResolvedValue({ id: 't1', literalName: 'Type', direction: 'debit', sortOrder: null, isActive: true, isHistorical: false });
    const res = makeRes();
    await updateTransactionType(makeReq({ params: { id: 't1' }, body: { direction: 'debit' } }), res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { direction: string };
    expect(body.direction).toBe('debit');
  });

  it('allows assigning direction when type currently has null direction', async () => {
    mocks.requireAdmin.mockResolvedValue(adminActor);
    mocks.transactionTypeFindUnique.mockResolvedValue({ id: 't2', workspaceId: WORKSPACE_ID, direction: null, isActive: true });
    mocks.transactionBookingCount.mockResolvedValue(99);
    mocks.transactionTypeUpdate.mockResolvedValue({ id: 't2', literalName: 'Historisch type', direction: 'debit', sortOrder: null, isActive: true, isHistorical: true });
    const res = makeRes();
    await updateTransactionType(makeReq({ params: { id: 't2' }, body: { direction: 'debit' } }), res);
    // First-time assignment (null → value) is allowed even with existing bookings
    expect(res.statusCode).toBe(200);
  });
});

// ─── Inferred proposal contract: no inferred confirmation ────────────────

describe('inferred proposal vs confirmation contract', () => {
  it('listTransactionTypes never returns direction=undefined — UI filter contract verified', async () => {
    mocks.requireAuthenticatedRequest.mockResolvedValue(adminActor);
    mocks.transactionTypeFindMany.mockResolvedValue([
      { id: 't1', literalName: 'Schenking', direction: 'credit', sortOrder: 1, isActive: true, isHistorical: false },
      { id: 't2', literalName: 'Bankkosten', direction: 'debit', sortOrder: 2, isActive: true, isHistorical: false },
    ]);
    const res = makeRes();
    await listTransactionTypes(makeReq(), res);
    const body = res.body as { items: Array<{ direction: string | null }> };
    // Every item must have an explicit direction or null — never undefined
    for (const item of body.items) {
      expect(item.direction === 'credit' || item.direction === 'debit' || item.direction === null).toBe(true);
    }
  });
});
