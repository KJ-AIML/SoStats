import { describe, expect, it, vi } from 'vitest';
import {
  ApiKeyService,
  parseApiKeyToken,
  validateApiKeyScopes,
} from './api-key.service.js';

function insertChain(record: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([record]);
  const values = vi.fn().mockReturnValue({ returning });
  return { insert: vi.fn().mockReturnValue({ values }), values };
}

describe('ApiKeyService', () => {
  it('validates the supported workspace scopes', () => {
    expect(
      validateApiKeyScopes(['workspace:read', 'workspace:write']),
    ).toEqual(['workspace:read', 'workspace:write']);
    expect(() => validateApiKeyScopes(['workspace:admin'])).toThrow(
      'API key scopes must be one or more of',
    );
  });

  it('creates a generate-once token while persisting only its hash', async () => {
    const access = {
      requireOwner: vi.fn().mockResolvedValue({ role: 'owner' }),
    };
    const base = {
      id: 1,
      workspaceId: 77,
      createdByUserId: 10,
      name: 'Reporting',
      scopes: ['workspace:read'],
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: null,
      rotatedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const chain = insertChain(base);
    const tx = {
      insert: chain.insert,
    };
    const db = {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ApiKeyService(
      db as never,
      access as never,
      {} as never,
    );

    const result = await service.create(77, 10, {
      name: 'Reporting',
      scopes: ['workspace:read'],
      expiresInDays: 30,
    });

    const values = chain.values.mock.calls[0]![0] as {
      publicId: string;
      secretHash: string;
    };
    const parsed = parseApiKeyToken(result.token);

    expect(parsed).not.toBeNull();
    expect(parsed?.publicId).toBe(values.publicId);
    expect(values.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(values.secretHash).not.toContain(parsed?.secret || '');
    expect(JSON.stringify(values)).not.toContain(result.token);
  });

  it('rejects malformed API keys before persistence lookup', async () => {
    const service = new ApiKeyService(
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.authenticate('not-a-key')).rejects.toThrow(
      'Invalid API key',
    );
  });
});
