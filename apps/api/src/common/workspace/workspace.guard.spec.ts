import { describe, expect, it, vi } from 'vitest';
import { WorkspaceGuard } from './workspace.guard.js';

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'controller',
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

describe('WorkspaceGuard API key scopes', () => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(true),
  };
  const access = {
    requireMembership: vi.fn().mockResolvedValue({ role: 'member' }),
  };

  it('allows a read-scoped key on GET', async () => {
    const guard = new WorkspaceGuard(
      reflector as never,
      access as never,
    );
    const request = {
      method: 'GET',
      headers: { 'x-workspace-id': '77' },
      user: {
        id: 10,
        subject: 'api-key-user:10',
        email: 'owner@example.com',
        name: 'Owner',
        apiKey: {
          id: 5,
          workspaceId: 77,
          scopes: ['workspace:read'],
        },
      },
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toMatchObject({ workspaceId: 77 });
  });

  it('rejects a read-only key on a mutating request', async () => {
    const guard = new WorkspaceGuard(
      reflector as never,
      access as never,
    );

    await expect(
      guard.canActivate(
        context({
          method: 'POST',
          headers: { 'x-workspace-id': '77' },
          user: {
            id: 10,
            subject: 'api-key-user:10',
            email: 'owner@example.com',
            name: 'Owner',
            apiKey: {
              id: 5,
              workspaceId: 77,
              scopes: ['workspace:read'],
            },
          },
        }),
      ),
    ).rejects.toThrow(
      'API key is missing required scope: workspace:write',
    );
  });
});
