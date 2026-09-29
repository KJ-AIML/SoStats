import { describe, expect, it, vi } from 'vitest';
import { WorkspaceAccessService } from './workspace-access.service.js';

function makeService(membership: { role: string } | undefined) {
  const findFirst = vi.fn().mockResolvedValue(membership);
  const db = {
    query: {
      workspaceMembers: {
        findFirst,
      },
    },
  };
  return {
    findFirst,
    service: new WorkspaceAccessService(db as never),
  };
}

describe('WorkspaceAccessService RBAC', () => {
  it('hides workspaces when the user has no membership', async () => {
    const { service } = makeService(undefined);

    await expect(service.requireMembership(10, 77)).rejects.toThrow(
      'Workspace not found',
    );
  });

  it('rejects persisted roles outside the supported RBAC model', async () => {
    const { service } = makeService({ role: 'superadmin' });

    await expect(service.requireMembership(10, 77)).rejects.toThrow(
      'Insufficient workspace permissions',
    );
  });

  it('enforces owner-only and owner/admin manager boundaries', async () => {
    const admin = makeService({ role: 'admin' }).service;
    await expect(admin.requireOwner(10, 77)).rejects.toThrow(
      'Insufficient workspace permissions',
    );
    await expect(admin.requireManager(10, 77)).resolves.toMatchObject({
      role: 'admin',
    });

    const owner = makeService({ role: 'owner' }).service;
    await expect(owner.requireOwner(10, 77)).resolves.toMatchObject({
      role: 'owner',
    });
  });
});
