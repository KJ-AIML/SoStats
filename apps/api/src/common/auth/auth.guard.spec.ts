import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard.js';

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'controller',
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

describe('AuthGuard API key boundary', () => {
  const apiUser = {
    id: 10,
    subject: 'api-key-user:10',
    email: 'owner@example.com',
    name: 'Owner',
    authMethod: 'api_key' as const,
    apiKey: {
      id: 5,
      workspaceId: 77,
      scopes: ['workspace:read' as const],
    },
  };

  it('rejects API keys on non-workspace-scoped endpoints', async () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false),
    };
    const apiKeys = {
      authenticate: vi.fn().mockResolvedValue(apiUser),
    };
    const guard = new AuthGuard(
      reflector as never,
      {} as never,
      apiKeys as never,
      {} as never,
    );

    await expect(
      guard.canActivate(
        context({
          headers: {
            authorization: 'Bearer sostats_sk_public_secretsecretsecretsecretsecretsecretsecretsecret',
            'x-workspace-id': '77',
          },
        }),
      ),
    ).rejects.toThrow(
      'API keys are only valid for workspace-scoped API endpoints',
    );
  });

  it('rejects an API key when the requested workspace does not match the key', async () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
    };
    const apiKeys = {
      authenticate: vi.fn().mockResolvedValue(apiUser),
    };
    const guard = new AuthGuard(
      reflector as never,
      {} as never,
      apiKeys as never,
      {} as never,
    );

    await expect(
      guard.canActivate(
        context({
          headers: {
            authorization: 'Bearer sostats_sk_public_secretsecretsecretsecretsecretsecretsecretsecret',
            'x-workspace-id': '88',
          },
        }),
      ),
    ).rejects.toThrow('API key is not valid for this workspace');
  });
});
