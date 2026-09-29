import { describe, expect, it, vi } from 'vitest';
import { SessionService } from './session.service.js';

function insertChain() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  return {
    insert: vi.fn().mockReturnValue({ values }),
    values,
  };
}

describe('SessionService', () => {
  it('stores only a SHA-256 bearer fingerprint and never the raw token', async () => {
    const rawToken = 'header.payload.signature';
    const created = {
      id: 9,
      userId: 10,
      tokenHash: 'a'.repeat(64),
      authMethod: 'jwt',
      userAgent: 'test-agent',
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(created);
    const chain = insertChain();
    const service = new SessionService({
      query: { authSessions: { findFirst } },
      insert: chain.insert,
    } as never);

    await service.touchJwtSession({
      userId: 10,
      token: rawToken,
      expiresAt: created.expiresAt,
      userAgent: 'test-agent',
    });

    const persisted = chain.values.mock.calls[0]![0] as {
      tokenHash: string;
    };
    expect(persisted.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.tokenHash).not.toContain(rawToken);
    expect(JSON.stringify(persisted)).not.toContain(rawToken);
  });

  it('rejects a previously revoked bearer session', async () => {
    const service = new SessionService({
      query: {
        authSessions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 9,
            userId: 10,
            authMethod: 'jwt',
            lastSeenAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date(),
          }),
        },
      },
    } as never);

    await expect(
      service.touchJwtSession({
        userId: 10,
        token: 'header.payload.signature',
      }),
    ).rejects.toThrow('Session has been revoked');
  });

  it('does not allow the current session to be revoked from Settings', async () => {
    const service = new SessionService({} as never);

    await expect(
      service.revokeOtherSession(10, 9, 9),
    ).rejects.toThrow(
      'The current session cannot be revoked from this Settings surface',
    );
  });
});
