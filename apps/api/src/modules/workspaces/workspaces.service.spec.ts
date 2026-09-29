import { describe, expect, it, vi } from 'vitest';
import { WorkspacesService } from './workspaces.service.js';

function updateChain(result: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([result]),
      }),
    }),
  };
}

function makeService(options?: { targetMissing?: boolean }) {
  const requireOwner = vi.fn().mockResolvedValue({
    id: 1,
    userId: 10,
    role: 'owner',
  });
  const access = {
    requireOwner,
    requireManager: vi.fn(),
    requireMembership: vi.fn(),
  };

  const owner = {
    id: 1,
    workspaceId: 77,
    userId: 10,
    role: 'owner',
  };
  const target = {
    id: 2,
    workspaceId: 77,
    userId: 20,
    role: 'member',
  };
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(owner)
    .mockResolvedValueOnce(options?.targetMissing ? undefined : target);

  const previousOwner = { ...owner, role: 'admin' };
  const newOwner = { ...target, role: 'owner' };
  const update = vi
    .fn()
    .mockReturnValueOnce(updateChain(previousOwner))
    .mockReturnValueOnce(updateChain(newOwner));

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      workspaceMembers: { findFirst },
    },
    update,
  };
  const db = {
    transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  return {
    access,
    tx,
    service: new WorkspacesService(
      db as never,
      access as never,
      {} as never,
    ),
  };
}

describe('WorkspacesService.transferOwnership', () => {
  it('transfers ownership atomically while demoting the previous owner', async () => {
    const { service, access, tx } = makeService();

    await expect(
      service.transferOwnership(77, 10, 2, 'admin'),
    ).resolves.toMatchObject({
      workspaceId: 77,
      previousOwner: { id: 1, userId: 10, role: 'admin' },
      owner: { id: 2, userId: 20, role: 'owner' },
    });

    expect(access.requireOwner).toHaveBeenCalledWith(10, 77);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(2);
  });

  it('cannot transfer ownership to a member outside the scoped workspace', async () => {
    const { service, tx } = makeService({ targetMissing: true });

    await expect(
      service.transferOwnership(77, 10, 999, 'admin'),
    ).rejects.toThrow('Workspace member not found');

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rejects invalid transfer targets before opening a transaction', async () => {
    const { service, access } = makeService();

    await expect(
      service.transferOwnership(77, 10, 0, 'admin'),
    ).rejects.toThrow('A valid target member id is required');

    expect(access.requireOwner).toHaveBeenCalledWith(10, 77);
  });
});
