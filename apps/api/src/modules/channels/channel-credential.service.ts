import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { decrypt, encrypt } from '../../utils/encryption.util.js';
import {
  ProviderPublishError,
  type SocialPublisherPort,
} from './ports/SocialPublisherPort.js';

@Injectable()
export class ChannelCredentialService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getValidAccessToken(
    account: typeof schema.socialAccounts.$inferSelect,
    adapter: SocialPublisherPort,
  ) {
    if (account.status !== 'active' || !account.accessToken) {
      throw new ProviderPublishError(
        'Connected channel is unavailable or has no usable access token',
        { retryable: false },
      );
    }

    let accessToken = decrypt(account.accessToken);

    if (!account.expiresAt || account.expiresAt.getTime() > Date.now()) {
      return accessToken;
    }

    if (!account.refreshToken) {
      await this.db
        .update(schema.socialAccounts)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(schema.socialAccounts.id, account.id));

      throw new ProviderPublishError(
        'Connected channel access token is expired and no refresh token is available',
        { retryable: false },
      );
    }

    try {
      const refreshed = await adapter.refreshAccessToken(
        decrypt(account.refreshToken),
      );
      accessToken = refreshed.accessToken;

      await this.db
        .update(schema.socialAccounts)
        .set({
          accessToken: encrypt(refreshed.accessToken),
          refreshToken: refreshed.refreshToken
            ? encrypt(refreshed.refreshToken)
            : account.refreshToken,
          expiresAt: refreshed.expiresAt,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(schema.socialAccounts.id, account.id));

      return accessToken;
    } catch (error) {
      if (error instanceof ProviderPublishError && !error.retryable) {
        await this.db
          .update(schema.socialAccounts)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schema.socialAccounts.id, account.id));
      }
      throw error;
    }
  }
}
