import { describe, expect, it, vi } from 'vitest';
import {
  AuditLogService,
  actorFromUser,
  sanitizeAuditMetadata,
} from './audit-log.service.js';

describe('audit metadata sanitization', () => {
  it('redacts secret-like fields recursively and preserves safe values', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');
    const sanitized = sanitizeAuditMetadata({
      provider: 'instagram',
      nested: {
        accessToken: 'do-not-store',
        authorization: 'Bearer secret',
        safe: true,
      },
      apiKeyHash: 'hash-value',
      when: now,
    });

    expect(sanitized).toEqual({
      provider: 'instagram',
      nested: {
        accessToken: '[REDACTED]',
        authorization: '[REDACTED]',
        safe: true,
      },
      apiKeyHash: '[REDACTED]',
      when: '2026-09-29T12:00:00.000Z',
    });
  });

  it('carries API key actor context without carrying the credential', () => {
    expect(
      actorFromUser({
        id: 10,
        subject: 'api-key-user:10',
        email: 'owner@example.com',
        name: 'Owner',
        authMethod: 'api_key',
        apiKey: {
          id: 55,
          workspaceId: 77,
          scopes: ['workspace:write'],
        },
      }),
    ).toEqual({
      userId: 10,
      email: 'owner@example.com',
      authMethod: 'api_key',
      apiKeyId: 55,
    });
  });
});

describe('AuditLogService', () => {
  it('requires owner authorization before listing workspace audit events', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const access = {
      requireOwner: vi.fn().mockResolvedValue({ role: 'owner' }),
    };
    const service = new AuditLogService(
      {
        query: {
          workspaceAuditEvents: { findMany },
        },
      } as never,
      access as never,
      {} as never,
    );

    await expect(service.listForWorkspace(77, 10)).resolves.toEqual([]);
    expect(access.requireOwner).toHaveBeenCalledWith(10, 77);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('sanitizes metadata before insertion', async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: 1,
        workspaceId: 77,
        action: 'api_key.created',
      },
    ]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const service = new AuditLogService(
      { insert } as never,
      {} as never,
      {} as never,
    );

    await service.record({
      workspaceId: 77,
      actor: {
        userId: 10,
        email: 'owner@example.com',
        authMethod: 'jwt',
      },
      action: 'api_key.created',
      targetType: 'workspace_api_key',
      targetId: 9,
      metadata: {
        token: 'never-store-me',
        publicId: 'safe-public-id',
      },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          token: '[REDACTED]',
          publicId: 'safe-public-id',
        },
      }),
    );
  });
});
