import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../utils/encryption.util.js';
import { ChannelCredentialService } from './channel-credential.service.js';
import type { SocialPublisherPort } from './ports/SocialPublisherPort.js';

describe('ChannelCredentialService', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('classifies an unusable channel as an authentication failure', async () => {
    // The disconnected-channel guard throws before any database access.
    const service = new ChannelCredentialService({} as never);
    const error = await service
      .getValidAccessToken(
        { status: 'disconnected', accessToken: null } as never,
        {} as SocialPublisherPort,
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorClass: 'authentication',
      retryable: false,
    });
  });

  it('classifies an expired token without a refresh token as authentication', async () => {
    const where = vi.fn(async () => undefined);
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) };
    const service = new ChannelCredentialService(db as never);
    const error = await service
      .getValidAccessToken(
        {
          id: 1,
          status: 'expired',
          accessToken: encrypt('token'),
          refreshToken: null,
          expiresAt: null,
        } as never,
        {} as SocialPublisherPort,
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorClass: 'authentication',
      retryable: false,
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
