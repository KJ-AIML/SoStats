import { describe, expect, it, vi } from 'vitest';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';

function service() {
  const access = {
    requireOwner: vi.fn().mockResolvedValue({ role: 'owner' }),
  };
  return {
    access,
    invitations: new WorkspaceInvitationsService(
      {} as never,
      access as never,
      {} as never,
    ),
  };
}

describe('WorkspaceInvitationsService validation', () => {
  it('rejects malformed invitation email before touching persistence', async () => {
    const { invitations, access } = service();

    await expect(
      invitations.create(1, 10, {
        email: 'not-an-email',
        role: 'member',
      }),
    ).rejects.toThrow('A valid invitation email is required');

    expect(access.requireOwner).toHaveBeenCalledWith(10, 1);
  });

  it('only allows admin/member invitation roles', async () => {
    const { invitations } = service();

    await expect(
      invitations.create(1, 10, {
        email: 'person@example.com',
        role: 'owner',
      }),
    ).rejects.toThrow('Invitation role must be admin or member');
  });

  it('rejects obviously invalid bearer tokens without querying the database', async () => {
    const { invitations } = service();

    await expect(invitations.inspect('short')).rejects.toThrow(
      'Invitation not found',
    );
    await expect(invitations.accept('short')).rejects.toThrow(
      'Invitation not found',
    );
    await expect(invitations.reject('short')).rejects.toThrow(
      'Invitation not found',
    );
  });
});
