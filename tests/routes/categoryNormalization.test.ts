import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setRequestActor } from '../../server/auth/requestContext';

const service = vi.hoisted(() => ({
  dryRun: vi.fn(),
  apply: vi.fn(),
  rollbackDryRun: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('../../server/prismaClient', () => ({ prisma: {} }));
vi.mock('../../server/services/categoryNormalizationService', () => ({
  CategoryNormalizationError: class CategoryNormalizationError extends Error {
    constructor(message: string, public statusCode = 400) { super(message); }
  },
  getCategoryNormalizationDryRun: service.dryRun,
  executeCategoryNormalization: service.apply,
  getCategoryNormalizationRollbackDryRun: service.rollbackDryRun,
  executeCategoryNormalizationRollback: service.rollback,
}));

import { postCategoryNormalization } from '../../server/routes/categoryNormalization';

const makeRequest = (role: 'admin' | 'viewer', body: Record<string, unknown> = {}) => {
  const request = { body, params: {}, query: {}, header: () => undefined };
  setRequestActor(request, { userId: `${role}-1`, role, actorId: `${role}-1`, actorEmail: `${role}@example.test` });
  return request;
};

const makeResponse = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(payload: unknown) { this.body = payload; return this; },
});

describe('category normalization route', () => {
  beforeEach(() => {
    vi.stubEnv('DEFAULT_WORKSPACE_ID', 'workspace-1');
    service.dryRun.mockReset();
    service.apply.mockReset();
    service.rollbackDryRun.mockReset();
    service.rollback.mockReset();
  });

  it('rejects viewers before dry-run or production mutation services are invoked', async () => {
    const response = makeResponse();
    await postCategoryNormalization(makeRequest('viewer') as never, response as never);
    expect(response.statusCode).toBe(403);
    expect(service.dryRun).not.toHaveBeenCalled();
    expect(service.apply).not.toHaveBeenCalled();
  });

  it('defaults an authenticated administrator request to a read-only dry-run', async () => {
    const result = { status: 'DRY_RUN_COMPLETE', writesPerformed: false, planHash: 'a'.repeat(64) };
    service.dryRun.mockResolvedValue(result);
    const response = makeResponse();
    await postCategoryNormalization(makeRequest('admin') as never, response as never);
    expect(response.body).toEqual(result);
    expect(service.dryRun).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'workspace-1', userId: 'admin-1', mappings: [] });
    expect(service.apply).not.toHaveBeenCalled();
  });

  it('requires an exact supplied plan hash before delegating apply', async () => {
    const missingHashResponse = makeResponse();
    await postCategoryNormalization(makeRequest('admin', { action: 'apply' }) as never, missingHashResponse as never);
    expect(missingHashResponse.statusCode).toBe(422);
    expect(service.apply).not.toHaveBeenCalled();

    service.apply.mockResolvedValue({ status: 'HASH_DRIFT', writesPerformed: false });
    const driftResponse = makeResponse();
    await postCategoryNormalization(makeRequest('admin', { action: 'apply', confirmedPlanHash: 'b'.repeat(64) }) as never, driftResponse as never);
    expect(driftResponse.statusCode).toBe(409);
    expect(service.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: 'workspace-1',
      userId: 'admin-1',
      confirmedPlanHash: 'b'.repeat(64),
      actor: expect.objectContaining({ userId: 'admin-1', actorId: 'admin-1' }),
    }));
  });

  it('passes exact mappings to a read-only dry-run and rejects malformed mappings', async () => {
    service.dryRun.mockResolvedValue({ status: 'DRY_RUN_COMPLETE', writesPerformed: false, planHash: 'c'.repeat(64) });
    const response = makeResponse();
    await postCategoryNormalization(makeRequest('admin', {
      action: 'dry-run', mappings: [{ sourceName: 'Website kosten', targetName: 'Websitekosten' }],
    }) as never, response as never);
    expect(service.dryRun).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: 'workspace-1', userId: 'admin-1',
      mappings: [{ sourceName: 'Website kosten', targetName: 'Websitekosten' }],
    });

    const invalid = makeResponse();
    await postCategoryNormalization(makeRequest('admin', { action: 'dry-run', mappings: [{ sourceName: 'Website kosten' }] }) as never, invalid as never);
    expect(invalid.statusCode).toBe(422);

    const oversized = makeResponse();
    await postCategoryNormalization(makeRequest('admin', {
      action: 'dry-run', mappings: [{ sourceName: 's'.repeat(201), targetName: 'Websitekosten' }],
    }) as never, oversized as never);
    expect(oversized.statusCode).toBe(422);
  });

  it('requires an operation ID and hash for a rollback mutation', async () => {
    const missingOperation = makeResponse();
    await postCategoryNormalization(makeRequest('admin', { action: 'rollback' }) as never, missingOperation as never);
    expect(missingOperation.statusCode).toBe(400);
    expect(service.rollback).not.toHaveBeenCalled();

    const missingHash = makeResponse();
    await postCategoryNormalization(makeRequest('admin', { action: 'rollback', operationId: 'op-1' }) as never, missingHash as never);
    expect(missingHash.statusCode).toBe(422);
    expect(service.rollback).not.toHaveBeenCalled();
  });
});
