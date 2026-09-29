import { describe, expect, it, vi } from 'vitest';
import { NotificationPreferencesService } from './notification-preferences.service.js';

describe('NotificationPreferencesService', () => {
  it('returns secure operational defaults when no preference row exists', async () => {
    const access = {
      requireMembership: vi.fn().mockResolvedValue({ role: 'member' }),
    };
    const service = new NotificationPreferencesService(
      {
        query: {
          workspaceNotificationPreferences: {
            findFirst: vi.fn().mockResolvedValue(undefined),
          },
        },
      } as never,
      access as never,
    );

    await expect(service.get(77, 10)).resolves.toEqual({
      workspaceId: 77,
      userId: 10,
      securityEvents: true,
      publishingFailures: true,
      automationFailures: true,
      weeklyDigest: false,
      updatedAt: null,
    });
    expect(access.requireMembership).toHaveBeenCalledWith(10, 77);
  });

  it('scopes persisted preferences to the requesting workspace member', async () => {
    const access = {
      requireMembership: vi.fn().mockResolvedValue({ role: 'member' }),
    };
    const current = {
      securityEvents: true,
      publishingFailures: true,
      automationFailures: true,
      weeklyDigest: false,
    };
    const returning = vi.fn().mockResolvedValue([
      {
        id: 1,
        workspaceId: 77,
        userId: 10,
        securityEvents: false,
        publishingFailures: true,
        automationFailures: false,
        weeklyDigest: true,
        updatedAt: new Date('2026-09-29T12:00:00.000Z'),
      },
    ]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const service = new NotificationPreferencesService(
      {
        query: {
          workspaceNotificationPreferences: {
            findFirst: vi.fn().mockResolvedValue(current),
          },
        },
        insert: vi.fn().mockReturnValue({ values }),
      } as never,
      access as never,
    );

    const result = await service.update(77, 10, {
      securityEvents: false,
      automationFailures: false,
      weeklyDigest: true,
    });

    expect(result).toMatchObject({
      workspaceId: 77,
      userId: 10,
      securityEvents: false,
      publishingFailures: true,
      automationFailures: false,
      weeklyDigest: true,
    });
    expect(access.requireMembership).toHaveBeenCalledWith(10, 77);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 77,
        userId: 10,
      }),
    );
  });
});
