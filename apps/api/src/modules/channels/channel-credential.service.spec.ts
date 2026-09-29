import { describe, expect, it } from 'vitest';
import { ChannelCredentialService } from './channel-credential.service.js';
import type { SocialPublisherPort } from './ports/SocialPublisherPort.js';

describe('ChannelCredentialService', () => {
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
});
